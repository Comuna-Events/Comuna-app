-- Comuna: notifications on the iPhone and Android apps. Run once in Supabase > SQL Editor; safe to re-run (re-run it
-- after changes). Run follows.sql first: the picks and the follows notification read its table.
--
-- How it works: the app asks about reminders on the "RSVP saved" card, and saves the phone's push token with
-- save_push_token(). Every 10 minutes the send-reminders Edge Function (scheduled below) reads what's due, sends each
-- through Apple's push service (iPhone) or Firebase Cloud Messaging (Android) and records it, so nobody gets the same
-- notification twice. Four kinds, each one a
-- switch in Profile > Reminders (push_prefs; all on until someone turns one off):
--   hour_before   "starts at 6:30 PM": an hour before each saved plan         due_push_reminders(), push_reminders_sent
--   plans_today   "2 plans today": 9-11 AM on a day with plans later on       due_push_extras(), push_sent
--   tickets       "Tomorrow: ..., grab tickets": 5-8 PM the evening before a saved plan that needs an RSVP or tickets
--   week_picks    "Your week, picked for you": Mondays 9-11 AM, up to 4 events Monday to Sunday
--   weekend_picks "Your weekend, picked for you": Fridays noon-2 PM, up to 4 events Friday evening to Sunday,
--                 favoring events added that week (this replaced Thursday's "New for you")
--   follows       "New from Hollywood Improv": 6-8 PM, not Mondays or Fridays, up to 3 events that venues and hosts you
--                 follow (follows.sql) added since your last one (at most 3 days back); one a day at most
--   Picks (push_pick_window(), push_picks()) are scored per person: their interests, kinds of things they've saved or
--   checked in to, how close (profiles.lat/lng), verified and Headliner events, what others are saving, a photo;
--   spread across categories and days, nothing they've already saved or been to, and at least 2 or nothing is sent.
-- Times are Los Angeles time.
--
-- The schedule at the bottom only does anything once the APNS_* secrets (iPhone) or the FCM_SERVICE_ACCOUNT secret
-- (Android) are set (see supabase/functions/send-reminders/index.ts); until then each call returns "not configured".

-- one row per phone; a phone that signs in to another account moves to that account
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null default 'ios' check (platform in ('ios', 'android')),
  -- iPhone only: Apple has two push services, 'sandbox' for builds run from Xcode, 'production' for TestFlight and
  -- the App Store. Null until the first send works out which one the token belongs to. Android tokens leave it null.
  environment text check (environment in ('sandbox', 'production')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_id on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- no policies: the app goes through the two functions below, and only they and the Edge Function touch the table
revoke all on public.push_tokens from anon, authenticated;
-- tables made before Android: let the platform column take 'android'
alter table public.push_tokens drop constraint if exists push_tokens_platform_check;
alter table public.push_tokens add constraint push_tokens_platform_check check (platform in ('ios', 'android'));

-- iPhone tokens are hex; Firebase (Android) tokens are longer, with letters, digits, - _ and :. The iPhone app 1.0
-- sends no p_platform, so it defaults to 'ios'. The one-argument version from before Android goes, so calls aren't
-- ambiguous.
drop function if exists public.save_push_token(text);
create or replace function public.save_push_token(p_token text, p_platform text default 'ios')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to get reminders.'; end if;
  if p_platform = 'ios' then
    if p_token !~ '^[0-9a-f]{64,200}$' then raise exception 'Not an iPhone push token.'; end if;
  elsif p_platform = 'android' then
    -- Postgres regexes repeat at most 255 times, so the length is checked separately
    if p_token !~ '^[A-Za-z0-9_:-]+$' or length(p_token) not between 100 and 4096 then raise exception 'Not an Android push token.'; end if;
  else
    raise exception 'Unknown platform %', p_platform;
  end if;
  insert into push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now(),
    environment = case when push_tokens.user_id = excluded.user_id then push_tokens.environment end;
end $$;

-- signing out stops this phone's reminders for that account
create or replace function public.forget_push_token(p_token text)
returns void
language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.save_push_token(text, text), public.forget_push_token(text) from public, anon;
grant execute on function public.save_push_token(text, text), public.forget_push_token(text) to authenticated;

-- which kinds of notification someone wants; no row means all of them. The app reads and writes its own row.
create table if not exists public.push_prefs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  hour_before boolean not null default true,
  plans_today boolean not null default true,
  tickets     boolean not null default true,
  new_for_you boolean not null default true,   -- retired (Thursday "New for you" became weekend_picks); kept for old apps
  updated_at  timestamptz not null default now()
);
alter table public.push_prefs add column if not exists week_picks boolean not null default true;
alter table public.push_prefs add column if not exists weekend_picks boolean not null default true;
alter table public.push_prefs add column if not exists follows boolean not null default true;
alter table public.push_prefs enable row level security;
revoke all on public.push_prefs from anon, authenticated;
-- (update covers user_id too: an upsert from the app sets it again, and the policy keeps it your own)
grant select, insert, update on public.push_prefs to authenticated;
drop policy if exists "own push prefs" on public.push_prefs;
create policy "own push prefs" on public.push_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.push_reminders_sent (
  user_id         uuid not null references auth.users (id) on delete cascade,
  event_id        text not null,
  occurrence_date date not null,
  sent_at         timestamptz not null default now(),
  primary key (user_id, event_id, occurrence_date)
);
alter table public.push_reminders_sent enable row level security;
revoke all on public.push_reminders_sent from anon, authenticated;

-- Plans starting 30 to 60 minutes from now, one row per phone, skipping events the person has already checked in to,
-- events with no start time, and archived ones. The 30-minute margin means a late or missed run still sends.
create or replace function public.due_push_reminders()
returns table (user_id uuid, event_id text, occurrence_date date, title text, venue text, starts_at timestamptz,
               token text, environment text)
language sql stable security definer set search_path = public as $$
  select r.user_id, r.event_id, r.occurrence_date, e.name, e.venue,
         (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles', t.token, t.environment
  from rsvps r
  join events e on e.event_id = r.event_id
  join push_tokens t on t.user_id = r.user_id
  where e.start_time is not null
    and e.status is distinct from 'Past / archived'
    and (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles'
        between now() + interval '30 minutes' and now() + interval '60 minutes'
    and not exists (select 1 from push_reminders_sent s
                    where s.user_id = r.user_id and s.event_id = r.event_id and s.occurrence_date = r.occurrence_date)
    and not exists (select 1 from checkins c
                    where c.user_id = r.user_id and c.event_id = r.event_id and c.checkin_date = r.occurrence_date)
    and coalesce((select p.hour_before from push_prefs p where p.user_id = r.user_id), true);
$$;
revoke execute on function public.due_push_reminders() from public, anon, authenticated;

-- the other three kinds: one record per person, kind and ref (the day, the plan or the week), whatever phones they have
create table if not exists public.push_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null check (kind in ('plans_today', 'tickets', 'new_for_you')),
  ref     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;
-- every kind, including invites.sql's (keep the two lists the same)
alter table public.push_sent drop constraint if exists push_sent_kind_check;
alter table public.push_sent add constraint push_sent_kind_check check (kind in
  ('plans_today', 'tickets', 'new_for_you', 'week_picks', 'weekend_picks', 'follows', 'invite', 'nudge', 'still_in', 'dropped', 'cancelled'));

-- Events the app shows that happen between p_from and p_to, each with its first day in that range (event_occurs_on(),
-- checkin_verify.sql). On p_from itself, only events starting at p_first_from or later (or with no time). Does the
-- work only when p_active, so due_push_extras() pays for it (~2-3 s for a week) only inside the Monday and Friday
-- windows, and once per run for everyone.
create or replace function public.push_pick_window(p_active boolean, p_from date, p_to date, p_first_from time)
returns table (event_id text, day date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not p_active then return; end if;
  return query
  select e.event_id, min(g::date)
  from events e cross join generate_series(p_from, p_to, interval '1 day') g
  where e.street_address is not null and e.status not in ('Cancelled', 'Past / archived')
    -- cheap filters first: the schedule check below runs a regex
    and (e.start_date is null or e.start_date <= p_to)
    and (coalesce(e.end_date, e.start_date) >= p_from or e.start_date is null or coalesce(e.recurrence, '') ~* '(daily|weekly|monthly)')
    and (g::date > p_from or e.start_time is null or e.start_time >= p_first_from)
    and event_occurs_on(e.recurrence, e.start_date, e.end_date, e.recurrence_detail, g::date)
  group by e.event_id;
end $$;
revoke execute on function public.push_pick_window(boolean, date, date, time) from public, anon, authenticated;

-- Up to 4 picks for one person from the window's events (push_pick_window(): [{event_id, day}]), best first.
-- Score: a venue or host they follow +4; in their interests +3; a kind of thing they've saved or checked in to +1; within 3 miles +2, within 7 +1,
-- further than 15 left out; verified +1; Headliner +1; 3+ people saved it in the last 30 days +1; a photo +0.5; on
-- Fridays, added in the last week +2 (what Thursday's "New for you" used to send). Nothing they've saved or checked
-- in to, one event per name, and spread out: a new category on a new day first. Listed in date order.
create or replace function public.push_picks(p_user uuid, p_fresh boolean, p_window jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select lat, lng, coalesce(interests, '{}') as interests from profiles where id = p_user),
  liked as (
    select e.category from rsvps r join events e on e.event_id = r.event_id where r.user_id = p_user
    union select e.category from checkins k join events e on e.event_id = k.event_id where k.user_id = p_user
  ),
  popular as (select event_id from rsvps where created_at > now() - interval '30 days' group by event_id having count(*) >= 3),
  followed as (select kind, key from follows where user_id = p_user),
  cand as (
    select e.event_id, e.name, e.venue, e.category, (w->>'day')::date as day, e.start_time,
      case when me.lat is null or e.lat is null then null
           else 7917.6 * asin(sqrt(power(sin(radians(e.lat - me.lat) / 2), 2)
                 + cos(radians(me.lat)) * cos(radians(e.lat)) * power(sin(radians(e.lng - me.lng) / 2), 2))) end as mi,
      exists (select 1 from followed f where (f.kind = 'venue' and f.key = lower(btrim(e.venue)))
                                       or (f.kind = 'host' and f.key = lower(btrim(e.host))))::int * 4
      + coalesce(e.category = any (me.interests), false)::int * 3
      + coalesce(e.category in (select category from liked where category is not null), false)::int
      + coalesce(e.verified, false)::int + coalesce(e.tier = 'Headliner', false)::int
      + (e.event_id in (select event_id from popular))::int
      + (e.image_url is not null and e.image_url <> '')::int * 0.5
      + (p_fresh and e.created_at > now() - interval '7 days')::int * 2 as base
    from me cross join jsonb_array_elements(coalesce(p_window, '[]')) w
    join events e on e.event_id = w->>'event_id'
    where not exists (select 1 from rsvps r where r.user_id = p_user and r.event_id = e.event_id)
      and not exists (select 1 from checkins k where k.user_id = p_user and k.event_id = e.event_id)
  ),
  scored as (
    select *, base + case when mi is null then 0 when mi <= 3 then 2 when mi <= 7 then 1 else 0 end as score
    from cand where mi is null or mi <= 15
  ),
  one_each as (   -- the best of each name, then each one's rank within its category and within its day
    select *, row_number() over (partition by category order by score desc, mi nulls last, day) as cat_rank,
              row_number() over (partition by day order by score desc, mi nulls last) as day_rank
    from (select distinct on (lower(name)) * from scored order by lower(name), score desc, mi nulls last) d
  )
  -- a new category on a new day first, so four picks aren't four of a kind or all on Saturday
  select jsonb_agg(jsonb_build_object('event_id', event_id, 'name', name, 'venue', venue, 'date', day,
           'starts_at', (day + start_time) at time zone 'America/Los_Angeles') order by day, start_time nulls last)
  from (select *, row_number() over (order by greatest(cat_rank, day_rank), score desc, mi nulls last, day) as n from one_each) x
  where n <= 4;
$$;
revoke execute on function public.push_picks(uuid, boolean, jsonb) from public, anon, authenticated;

-- What's due of the other three kinds, one row per phone. items holds the events the notification is about
-- (event_id, name, venue, starts_at or null, date); send-reminders writes the words.
-- p_now: when to pretend it is, for trying it out (select * from due_push_extras('2026-11-16 09:30 America/Los_Angeles'));
-- send-reminders calls it with none. The version without it goes, so the call isn't ambiguous.
drop function if exists public.due_push_extras();
create or replace function public.due_push_extras(p_now timestamptz default now())
returns table (kind text, ref text, user_id uuid, token text, environment text, items jsonb)
language sql stable security definer set search_path = public as $$
  with clock as (
    select (p_now at time zone 'America/Los_Angeles') as local, (p_now at time zone 'America/Los_Angeles')::date as today
  ),
  shown as (   -- events the app shows (events.sql)
    select e.* from events e where e.street_address is not null and e.status not in ('Cancelled', 'Past / archived')
  ),
  -- 9-11 AM: today's plans not checked in to that start more than 90 minutes from now (the hour reminder covers sooner)
  today as (
    select 'plans_today'::text as kind, c.today::text as ref, r.user_id,
           jsonb_agg(jsonb_build_object('event_id', e.event_id, 'name', e.name, 'venue', e.venue, 'date', r.occurrence_date,
             'starts_at', (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles')
             order by e.start_time nulls last) as items
    from clock c join rsvps r on r.occurrence_date = c.today join shown e on e.event_id = r.event_id
    where c.local::time >= '09:00' and c.local::time < '11:00'
      and (e.start_time is null or (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles' > p_now + interval '90 minutes')
      and not exists (select 1 from checkins k where k.user_id = r.user_id and k.event_id = r.event_id and k.checkin_date = r.occurrence_date)
      and coalesce((select p.plans_today from push_prefs p where p.user_id = r.user_id), true)
    group by c.today, r.user_id
  ),
  -- 5-8 PM: tomorrow's plans that need an RSVP or a paid ticket on the host's page
  tickets as (
    select 'tickets'::text, r.event_id || '|' || r.occurrence_date, r.user_id,
           jsonb_build_array(jsonb_build_object('event_id', e.event_id, 'name', e.name, 'venue', e.venue, 'date', r.occurrence_date,
             'starts_at', (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles'))
    from clock c join rsvps r on r.occurrence_date = c.today + 1 join shown e on e.event_id = r.event_id
    where c.local::time >= '17:00' and c.local::time < '20:00'
      and (e.rsvp_required or e.price_type = 'Paid') and coalesce(e.ticket_url, e.source_url) is not null
      and coalesce((select p.tickets from push_prefs p where p.user_id = r.user_id), true)
  ),
  -- Mondays 9-11 AM: picks for Monday to Sunday. Fridays noon-2 PM: picks for Friday 5 PM to Sunday.
  slot as (
    select case when extract(isodow from c.local) = 1 and c.local::time >= '09:00' and c.local::time < '11:00' then 'week_picks'
                when extract(isodow from c.local) = 5 and c.local::time >= '12:00' and c.local::time < '14:00' then 'weekend_picks'
           end as kind, c.today, c.local, to_char(c.today, 'IYYY-"W"IW') as ref
    from clock c
  ),
  -- who gets one: a phone, the switch on, and not sent yet this week (so the window isn't worked out for nobody)
  pickers as (
    select s.kind, s.ref, pr.id as user_id
    from slot s join profiles pr on exists (select 1 from push_tokens t where t.user_id = pr.id)
    where s.kind is not null
      and coalesce((select case s.kind when 'week_picks' then p.week_picks else p.weekend_picks end
                    from push_prefs p where p.user_id = pr.id), true)
      and not exists (select 1 from push_sent x where x.user_id = pr.id and x.kind = s.kind and x.ref = s.ref)
  ),
  -- the window's events, worked out once for everyone (materialized: never once per person)
  win as materialized (
    select jsonb_agg(to_jsonb(w)) as events from slot s cross join lateral push_pick_window(
      s.kind is not null and exists (select 1 from pickers), s.today,
      s.today + case when s.kind = 'week_picks' then 6 else 2 end,
      case when s.kind = 'week_picks' then (s.local + interval '1 hour')::time else greatest('17:00'::time, (s.local + interval '1 hour')::time) end) w
  ),
  picks as (
    select k.kind, k.ref, k.user_id, push_picks(k.user_id, k.kind = 'weekend_picks', (select events from win)) as items
    from pickers k
  ),
  -- 6-8 PM, not Mondays or Fridays (the picks go out then): what the venues and hosts you follow added since your last
  -- one of these (at most 3 days back, a day the first time), still to come, not saved; up to 3, soonest first
  fusers as (
    select distinct f.user_id from clock c join follows f on true
    where extract(isodow from c.local) not in (1, 5) and c.local::time >= '18:00' and c.local::time < '20:00'
      and exists (select 1 from push_tokens t where t.user_id = f.user_id)
      and coalesce((select p.follows from push_prefs p where p.user_id = f.user_id), true)
  ),
  followed as (
    select 'follows'::text, c.today::text, u.user_id,
      (select jsonb_agg(z.item order by z.sd nulls last, z.st nulls last) from (
         select y.* from (
           select distinct on (e.event_id) e.event_id, e.start_date as sd, e.start_time as st,
             jsonb_build_object('event_id', e.event_id, 'name', e.name, 'venue', e.venue, 'from', f.name,
               'date', case when e.start_date >= c.today then e.start_date end,
               'starts_at', case when e.start_date >= c.today then (e.start_date + e.start_time) at time zone 'America/Los_Angeles' end) as item
           from follows f join shown e on (f.kind = 'venue' and lower(btrim(e.venue)) = f.key)
                                       or (f.kind = 'host' and lower(btrim(e.host)) = f.key)
           where f.user_id = u.user_id and e.created_at <= p_now
             and e.created_at > greatest(p_now - interval '3 days', coalesce(
                   (select max(s.sent_at) from push_sent s where s.user_id = u.user_id and s.kind = 'follows'), p_now - interval '1 day'))
             and (coalesce(e.end_date, e.start_date) >= c.today or e.start_date is null
                  or coalesce(e.recurrence, '') ~* '(daily|weekly|monthly)')
             and not exists (select 1 from rsvps r where r.user_id = u.user_id and r.event_id = e.event_id)
             and not (e.start_date = c.today and e.start_time is not null and e.start_time < c.local::time)   -- already started
           order by e.event_id, f.kind desc) y   -- 'venue' before 'host' names where it's from
         order by y.sd nulls last, y.st nulls last limit 3) z)
    from clock c cross join fusers u
  ),
  due as (select * from today union all select * from tickets union all select * from picks union all select * from followed)
  select d.kind, d.ref, d.user_id, t.token, t.environment, d.items
  from due d join push_tokens t on t.user_id = d.user_id
  where d.items is not null and jsonb_array_length(d.items) > case when d.kind in ('week_picks', 'weekend_picks') then 1 else 0 end
    and not exists (select 1 from push_sent s where s.user_id = d.user_id and s.kind = d.kind and s.ref = d.ref);
$$;
revoke execute on function public.due_push_extras(timestamptz) from public, anon, authenticated;

comment on table public.push_tokens is
'[App users] One row per iPhone that allowed notifications, linked to the account signed in on it.';
comment on table public.push_reminders_sent is
'[Team] Reminders already sent, so each plan gets one. Written by the send-reminders Edge Function.';
comment on table public.push_prefs is
'[App users] Which notifications someone wants (Profile > Reminders). No row means all of them.';
comment on table public.push_sent is
'[Team] Plans-today, tickets, week and weekend picks notifications already sent (and invites). Written by the send-reminders Edge Function.';
comment on function public.due_push_extras(timestamptz) is
'[Team] Plans-today, tickets, week and weekend picks notifications due now, one row per phone. Read by send-reminders.';
comment on function public.due_push_reminders() is
'[Team] Plans starting in 30-60 minutes that still need a reminder, one row per phone. Read by send-reminders.';

-- Every 10 minutes, call send-reminders. It uses the same Vault secret as the nightly ingest
-- (ingest_schedule.sql), sent as the x-ingest-secret header.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('push-reminders', '*/10 * * * *', $cron$
  select net.http_post(
    url     := 'https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('content-type', 'application/json', 'x-ingest-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
-- To pause reminders: select cron.unschedule('push-reminders');
