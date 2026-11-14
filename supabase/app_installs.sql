-- Comuna: how many people use the iPhone app, the Android app and the website. Run in Supabase > SQL Editor; safe to
-- re-run. (The table, function and views were first made in the dashboard; this file is them as they are, so they're
-- kept with the rest.)
--
-- Every launch, index.html calls app_seen() with the install's random device_id (the same one as guests.sql, no name,
-- email or location) and its platform. Notifications only work in the phone apps, so this says how many people could
-- get them at all, and how many of those are guests.

-- [App users] One row per install (iPhone app, Android app or website): opens, first and last seen, the account on it.
create table if not exists public.app_installs (
  device_id  uuid primary key,
  platform   text not null check (platform in ('ios', 'android', 'web')),
  opens      integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  user_id    uuid references auth.users (id) on delete set null
);
create index if not exists app_installs_first_seen_idx on public.app_installs (first_seen);
-- No policies: the app can't read or write rows directly, only through app_seen()
alter table public.app_installs enable row level security;
revoke all on public.app_installs from anon, authenticated;

-- Called on every launch. Signed in, it also records the account (and keeps it after signing out).
create or replace function public.app_seen(p_device uuid, p_platform text)
returns void language sql security definer set search_path = public as $$
  insert into public.app_installs (device_id, platform, user_id)
  values (p_device, case when p_platform in ('ios','android') then p_platform else 'web' end, auth.uid())
  on conflict (device_id) do update
    set opens = app_installs.opens + 1, last_seen = now(),
        platform = excluded.platform,
        user_id = coalesce(auth.uid(), app_installs.user_id);
$$;
revoke all on function public.app_seen(uuid, text) from public;
grant execute on function public.app_seen(uuid, text) to anon, authenticated;

-- [App users] Installs by platform: total, new and active in the last 7 days, active in 30, came back, signed in
create or replace view public.app_installs_summary with (security_invoker = true) as
  select case when grouping(platform) = 1 then 'All'
              when platform = 'ios' then 'iPhone (App Store)'
              when platform = 'android' then 'Android (Google Play)'
              else 'Website' end as platform,
         count(*) as installs,
         count(*) filter (where first_seen > now() - interval '7 days') as new_last_7_days,
         count(*) filter (where last_seen > now() - interval '7 days') as active_last_7_days,
         count(*) filter (where last_seen > now() - interval '30 days') as active_last_30_days,
         count(*) filter (where opens > 1) as came_back,
         count(user_id) as signed_in,
         min(first_seen) as first_install
  from public.app_installs
  group by rollup (platform)
  order by grouping(platform), count(*) desc;

-- [App users] New installs per week, split into iPhone, Android and website
create or replace view public.app_installs_weekly with (security_invoker = true) as
  select date_trunc('week', first_seen)::date as week,
         count(*) as installs,
         count(*) filter (where platform = 'ios') as iphone,
         count(*) filter (where platform = 'android') as android,
         count(*) filter (where platform = 'web') as website,
         count(*) filter (where opens > 1) as came_back,
         count(user_id) as signed_in
  from public.app_installs
  group by date_trunc('week', first_seen)::date
  order by date_trunc('week', first_seen)::date desc;
revoke all on public.app_installs_summary, public.app_installs_weekly from anon, authenticated;

comment on table public.app_installs is
'[App users] One row per install (iPhone app, Android app or website): opens, first and last seen, the account on it.';
comment on view public.app_installs_summary is
'[App users] Installs by platform (iPhone, Android, website): total, new and active in the last 7 days, signed in.';
comment on view public.app_installs_weekly is
'[App users] New installs per week, split into iPhone, Android and website.';
