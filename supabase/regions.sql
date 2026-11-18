-- Comuna: regions. The first step toward running in more than Los Angeles (design note: supabase/REGIONS.md).
-- Run once in Supabase > SQL Editor, after events.sql and event_ingest.sql; safe to re-run (it never changes a region
-- row you have edited).
--
-- Nothing in the app or the nightly ingest reads this yet, and nothing changes for people using the app:
-- every existing event, source and candidate becomes region 'la'.
--
-- - public.regions: one row per region (Los Angeles, then Ventura County, ...). Add a region by adding a row.
-- - events, ingest.event_sources and ingest.event_candidates get a region column (default 'la').
-- - public.region_for_zip(): which region a zip code belongs to, for the ingest to use next.
-- This file owns public.regions and public.region_for_zip() (supabase/README.md).

create table if not exists public.regions (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),   -- short and stable: 'la', 'ventura'
  name        text not null,
  state       text not null default 'CA',
  status      text not null default 'planned' check (status in ('planned', 'pilot', 'live')),
  timezone    text not null default 'America/Los_Angeles',   -- stored for later; the rest of the code is still Pacific-only
  center_lat  numeric(8, 5) not null,                         -- where the map opens
  center_lng  numeric(8, 5) not null,
  zip_ranges  int4range[] not null default '{}',              -- zip codes this region claims, e.g. [90001,91899]
  zip_exclude int4range[] not null default '{}',              -- zip codes inside those ranges that belong elsewhere
  created_at  timestamptz not null default now()
);

-- Seed rows. "on conflict do nothing": re-running this file never undoes a change made to a region since.
-- Los Angeles copies the rule the ingest uses today (inLaCounty in supabase/functions/_shared/structured.ts):
-- LA County zips 90001-91899 and the Antelope Valley's 93510-93599, minus the Orange County ones in that range.
insert into public.regions (id, name, status, center_lat, center_lng, zip_ranges, zip_exclude) values
  ('la', 'Los Angeles', 'live', 34.0869, -118.2702,
   array[int4range(90001, 91899, '[]'), int4range(93510, 93599, '[]')],
   array[int4range(90620, 90633, '[]'), int4range(90680, 90680, '[]'), int4range(90720, 90721, '[]'),
         int4range(90740, 90740, '[]'), int4range(90742, 90743, '[]')])
on conflict (id) do nothing;
-- Ventura County: planned, no zip codes yet. Its zips are filled in (and checked against Los Angeles's range, which
-- overlaps some Thousand Oaks / Newbury Park / Oak Park zips) when the ingest starts reading regions.
insert into public.regions (id, name, status, center_lat, center_lng) values
  ('ventura', 'Ventura County', 'planned', 34.2746, -119.2290)
on conflict (id) do nothing;

-- Public configuration: the app may read launched regions. Nobody but the team can change them.
alter table public.regions enable row level security;
drop policy if exists "anyone can read launched regions" on public.regions;
create policy "anyone can read launched regions" on public.regions
  for select to anon, authenticated using (status in ('pilot', 'live'));
revoke all on public.regions from anon, authenticated;
grant select on public.regions to anon, authenticated;

-- Which region each event, source and candidate belongs to. A constant default, so every existing row becomes 'la'.
alter table public.events          add column if not exists region text not null default 'la' references public.regions (id);
alter table ingest.event_sources    add column if not exists region text not null default 'la' references public.regions (id);
alter table ingest.event_candidates add column if not exists region text not null default 'la' references public.regions (id);
create index if not exists events_region_idx on public.events (region);

-- events are readable column by column (events.sql); add this one
grant select (region) on public.events to anon, authenticated;

-- The one launched region that claims a zip code, or null: no region claims it, or more than one does (zip codes
-- can straddle a county line, so an overlap is left for the caller to settle by location). Only pilot and live
-- regions claim zips. Accepts "93001" or "93001-1234"; anything else is null.
create or replace function public.region_for_zip(p_zip text) returns text
language sql stable set search_path = '' as $$
  with z as (
    select case when left(btrim(p_zip), 5) ~ '^[0-9]{5}$' then left(btrim(p_zip), 5)::int end as n
  )
  select case when count(*) = 1 then min(r.id) end
  from z, public.regions r
  where z.n is not null
    and r.status in ('pilot', 'live')
    and exists (select 1 from unnest(r.zip_ranges) a where a @> z.n)
    and not exists (select 1 from unnest(r.zip_exclude) x where x @> z.n)
$$;
revoke execute on function public.region_for_zip(text) from public, anon, authenticated;

comment on table public.regions is '[Team] One row per region (Los Angeles, Ventura County, ...). status: planned (not launched), pilot (being tried), live. The app reads launched regions.';
comment on column public.regions.zip_ranges is 'Zip codes this region claims, as ranges like [90001,91899]. Used by region_for_zip().';
comment on column public.regions.zip_exclude is 'Zip codes inside zip_ranges that belong to another region.';
comment on column public.events.region is 'Which region the event is in (regions.id). Existing events are ''la''.';
comment on column ingest.event_sources.region is 'The region this source''s events belong to (regions.id).';
comment on column ingest.event_candidates.region is 'The region this candidate belongs to (regions.id).';
comment on function public.region_for_zip(text) is '[Internal] The launched region that claims a zip code, or null when none or several do.';
