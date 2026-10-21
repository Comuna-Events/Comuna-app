-- Comuna: people who tap "Skip sign up" and explore as guests. How many there are, what they look at and search for,
-- and how many make an account later.
-- Run in Supabase > SQL Editor after event_actions.sql and search.sql; safe to re-run.
-- Until this runs, the app still works: guest activity just isn't saved.
--
-- Each install gets a random device_id (no name, email or exact location). Guests have no account, so their rows
-- have a device_id and no user_id. Signed-in rows carry both, which links a guest's activity to the account they make.

-- [App users] One row per guest install: where they said they are, what they're into, when they were last in the app,
-- and the account they made (or signed in to), if they did.
create table if not exists public.guest_sessions (
  device_id         uuid primary key,
  neighborhood      text,
  interests         text[] not null default '{}',
  opens             integer not null default 1,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  converted_user_id uuid references auth.users(id) on delete set null,
  converted_at      timestamptz
);
create index if not exists guest_sessions_created_idx on public.guest_sessions (created_at);

-- No policies: the app can't read or write rows directly, only through the two functions below.
alter table public.guest_sessions enable row level security;

-- Called when a guest starts and on each launch after.
create or replace function public.guest_seen(p_device uuid, p_neighborhood text, p_interests text[])
returns void language sql security definer set search_path = public as $$
  insert into public.guest_sessions (device_id, neighborhood, interests)
  values (p_device, left(p_neighborhood, 100), coalesce(p_interests[1:30], '{}'))
  on conflict (device_id) do update
    set neighborhood = excluded.neighborhood, interests = excluded.interests,
        opens = guest_sessions.opens + 1, last_seen_at = now();
$$;

-- Called when a guest makes an account or signs in to one. The first account a device joins is the one that counts.
create or replace function public.guest_converted(p_device uuid)
returns void language sql security definer set search_path = public as $$
  update public.guest_sessions
     set converted_user_id = coalesce(converted_user_id, auth.uid()), converted_at = coalesce(converted_at, now())
   where device_id = p_device and auth.uid() is not null;
$$;

revoke all on function public.guest_seen(uuid, text, text[]) from public;
revoke all on function public.guest_converted(uuid) from public, anon;   -- Supabase grants anon by default
grant execute on function public.guest_seen(uuid, text, text[]) to anon, authenticated;
grant execute on function public.guest_converted(uuid) to authenticated;

-- Guest views, taps and searches: user_id becomes optional, device_id says whose they are.
alter table public.event_actions  add column if not exists device_id uuid;
alter table public.search_queries add column if not exists device_id uuid;
alter table public.event_actions  alter column user_id drop not null;
alter table public.search_queries alter column user_id drop not null;

-- Guests (no account) can add rows with a device_id and no user_id; nobody can read raw rows from the app.
drop policy if exists "insert guest actions" on public.event_actions;
create policy "insert guest actions" on public.event_actions
  for insert to anon, authenticated with check (user_id is null and device_id is not null);
drop policy if exists "insert guest searches" on public.search_queries;
create policy "insert guest searches" on public.search_queries
  for insert to anon, authenticated with check (user_id is null and device_id is not null);

-- Per-event totals now count guests too. Unique viewers are counted per phone, so a guest who signs up isn't counted twice
-- (rows from before this ran have no device_id and fall back to the account).
create or replace view public.event_stats with (security_invoker = true) as
select event_id,
       max(event_title)                                                          as event_title,
       count(*) filter (where action = 'view')                                   as views,
       count(distinct coalesce(device_id::text, user_id::text)) filter (where action = 'view') as unique_viewers,
       count(*) filter (where action in ('interested','rsvp'))                   as interested,
       count(*) filter (where action = 'directions')                             as directions,
       count(*) filter (where action = 'calendar')                               as calendar_adds,
       count(*) filter (where action = 'link')                                   as link_clicks,
       count(*) filter (where action = 'invite')                                 as invites,
       count(*) filter (where action = 'checkin')                                as checkins,
       max(created_at)                                                           as last_activity,
       count(*) filter (where action = 'view' and user_id is null)               as guest_views
from public.event_actions
group by event_id;

create or replace view public.search_terms with (security_invoker = true) as
select lower(trim(query))                                  as query,
       count(*)                                            as searches,
       count(distinct coalesce(device_id::text, user_id::text)) as people,
       count(*) filter (where result_count = 0)            as found_nothing,
       count(*) filter (where picked_event_id is not null) as picked_from_suggestions,
       max(created_at)                                     as last_searched,
       count(*) filter (where user_id is null)             as guest_searches
from public.search_queries
where created_at > now() - interval '30 days'
group by 1
order by searches desc;

-- Summary: guests per week, how many came back, and how many made an account.
create or replace view public.guest_funnel with (security_invoker = true) as
select date_trunc('week', created_at)::date                                   as week,
       count(*)                                                               as guests,
       count(*) filter (where opens > 1)                                      as came_back,
       count(converted_user_id)                                               as made_account,
       round(100.0 * count(converted_user_id) / count(*), 1)                  as made_account_pct,
       round(avg(extract(epoch from converted_at - created_at) / 86400)::numeric, 1) as avg_days_to_account
from public.guest_sessions
group by 1
order by 1 desc;

comment on table public.guest_sessions is '[App users] One row per guest install (skipped sign-up): neighborhood, interests, opens, and the account they made later, if any.';
comment on view  public.guest_funnel   is '[App users] Guests per week: how many came back and how many made an account.';
