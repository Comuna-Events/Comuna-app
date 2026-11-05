-- Comuna: notifications on the iPhone and Android apps. Run once in Supabase > SQL Editor; safe to re-run (re-run it
-- after changes).
--
-- How it works: the app asks about reminders on the "RSVP saved" card, and saves the phone's push token with
-- save_push_token(). Every 10 minutes the send-reminders Edge Function (scheduled below) reads what's due, sends each
-- through Apple's push service (iPhone) or Firebase Cloud Messaging (Android) and records it, so nobody gets the same
-- notification twice. Four kinds, each one a
-- switch in Profile > Reminders (push_prefs; all on until someone turns one off):
--   hour_before   "starts at 6:30 PM": an hour before each saved plan         due_push_reminders(), push_reminders_sent
--   plans_today   "2 plans today": 9-11 AM on a day with plans later on       due_push_extras(), push_sent
--   tickets       "Tomorrow: ..., grab tickets": 5-8 PM the evening before a saved plan that needs an RSVP or tickets
--   new_for_you   "New for you": Thursdays 4-7 PM, up to 3 events added that week in your interests (profiles.interests)
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
    if p_token !~ '^[A-Za-z0-9_:-]{100,4096}$' then raise exception 'Not an Android push token.'; end if;
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
  new_for_you boolean not null default true,
  updated_at  timestamptz not null default now()
);
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

-- What's due of the other three kinds, one row per phone. items holds the events the notification is about
-- (event_id, name, venue, starts_at or null, date); send-reminders writes the words.
create or replace function public.due_push_extras()
returns table (kind text, ref text, user_id uuid, token text, environment text, items jsonb)
language sql stable security definer set search_path = public as $$
  with clock as (
    select (now() at time zone 'America/Los_Angeles') as local, (now() at time zone 'America/Los_Angeles')::date as today
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
      and (e.start_time is null or (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles' > now() + interval '90 minutes')
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
  -- Thursdays 4-7 PM: up to 3 events added in the last week in your interests, still to come, that you haven't saved
  fresh as (
    select 'new_for_you'::text, to_char(c.today, 'IYYY-"W"IW'), pr.id,
           (select jsonb_agg(x.item) from (
              select jsonb_build_object('event_id', e.event_id, 'name', e.name, 'venue', e.venue, 'date', null, 'starts_at', null) as item
              from shown e
              where e.created_at > now() - interval '7 days' and e.category = any (pr.interests)
                and (coalesce(e.end_date, e.start_date) >= c.today
                     or (e.end_date is null and coalesce(e.recurrence, 'One-off') <> 'One-off'))
                and not exists (select 1 from rsvps r where r.user_id = pr.id and r.event_id = e.event_id)
              -- verified events and Headliners first, then the soonest
              order by e.verified desc, (e.tier = 'Headliner') desc, e.start_date nulls last, e.created_at desc limit 3) x)
    from clock c join profiles pr on cardinality(pr.interests) > 0
    where extract(isodow from c.local) = 4 and c.local::time >= '16:00' and c.local::time < '19:00'
      and coalesce((select p.new_for_you from push_prefs p where p.user_id = pr.id), true)
  ),
  due as (select * from today union all select * from tickets union all select * from fresh)
  select d.kind, d.ref, d.user_id, t.token, t.environment, d.items
  from due d join push_tokens t on t.user_id = d.user_id
  where d.items is not null and jsonb_array_length(d.items) > 0
    and not exists (select 1 from push_sent s where s.user_id = d.user_id and s.kind = d.kind and s.ref = d.ref);
$$;
revoke execute on function public.due_push_extras() from public, anon, authenticated;

comment on table public.push_tokens is
'[App users] One row per iPhone that allowed notifications, linked to the account signed in on it.';
comment on table public.push_reminders_sent is
'[Team] Reminders already sent, so each plan gets one. Written by the send-reminders Edge Function.';
comment on table public.push_prefs is
'[App users] Which notifications someone wants (Profile > Reminders). No row means all of them.';
comment on table public.push_sent is
'[Team] Plans-today, tickets and new-for-you notifications already sent. Written by the send-reminders Edge Function.';
comment on function public.due_push_extras() is
'[Team] Plans-today, tickets and new-for-you notifications due now, one row per phone. Read by send-reminders.';
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
