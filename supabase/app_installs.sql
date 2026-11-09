-- Comuna: how many phones and browsers have the app, split by where it runs: the iPhone app (App Store), the Android
-- app (Google Play) or the website. Open the app_installs_summary view in Supabase > Table Editor for the totals and
-- app_installs_weekly for new installs per week.
-- Run in Supabase > SQL Editor after guests.sql; safe to re-run.
--
-- Every install already has a random device_id (index.html, no name or email). On each launch the app calls
-- app_seen() with that id and its platform, for guests and signed-in people alike, so this counts everyone, not
-- only guests. The iPhone and Android apps carry their own copy of index.html, so phones start showing up here once
-- they update to a build that has this; installs from before that aren't counted.
--
-- These are installs that opened the app, not store downloads: someone who downloads and never opens it isn't here,
-- and reinstalling (or clearing the browser) counts again. App Store Connect > Analytics and the Play Console have
-- the stores' own download numbers.

-- [App users] One row per install: platform, first and last time it opened, how many opens, and the account
-- signed in on it (the latest one), if any.
create table if not exists public.app_installs (
  device_id    uuid primary key,
  platform     text not null check (platform in ('ios','android','web')),
  opens        integer not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  user_id      uuid references auth.users(id) on delete set null
);
create index if not exists app_installs_first_seen_idx on public.app_installs (first_seen);

-- No policies: the app can't read or write rows directly, only through app_seen().
alter table public.app_installs enable row level security;

-- Called once per launch. Anything that isn't 'ios' or 'android' counts as the website.
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

-- The tab to check: one row per platform plus a total.
create or replace view public.app_installs_summary with (security_invoker = true) as
select case when grouping(platform) = 1 then 'All' when platform = 'ios' then 'iPhone (App Store)'
            when platform = 'android' then 'Android (Google Play)' else 'Website' end as platform,
       count(*)                                                             as installs,
       count(*) filter (where first_seen > now() - interval '7 days')       as new_last_7_days,
       count(*) filter (where last_seen  > now() - interval '7 days')       as active_last_7_days,
       count(*) filter (where last_seen  > now() - interval '30 days')      as active_last_30_days,
       count(*) filter (where opens > 1)                                    as came_back,
       count(user_id)                                                       as signed_in,
       min(first_seen)                                                      as first_install
from public.app_installs
group by rollup (platform)
order by grouping(platform), installs desc;

-- New installs per week, by platform.
create or replace view public.app_installs_weekly with (security_invoker = true) as
select date_trunc('week', first_seen)::date                   as week,
       count(*)                                               as installs,
       count(*) filter (where platform = 'ios')               as iphone,
       count(*) filter (where platform = 'android')           as android,
       count(*) filter (where platform = 'web')               as website,
       count(*) filter (where opens > 1)                      as came_back,
       count(user_id)                                         as signed_in
from public.app_installs
group by 1
order by 1 desc;

comment on table public.app_installs         is '[App users] One row per install (iPhone app, Android app or website): opens, first and last seen, the account on it.';
comment on view  public.app_installs_summary is '[App users] Installs by platform (iPhone, Android, website): total, new and active in the last 7 days, signed in.';
comment on view  public.app_installs_weekly  is '[App users] New installs per week, split into iPhone, Android and website.';
