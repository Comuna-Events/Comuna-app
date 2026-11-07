-- Comuna: Ticketmaster, The Events Calendar (WordPress) and Localist as ingest platforms, for
-- supabase/functions/ingest-ticketmaster, ingest-events-calendar and ingest-localist. Run once in Supabase > SQL Editor
-- after deploying the three functions; safe to re-run. (The same platform and label changes are in event_ingest.sql,
-- price_detail.sql and ingest_schedule.sql, for fresh installs.)
--
-- None of the three uses AI: each maps the platform's own data onto candidates, so they run every night for free
-- (Ticketmaster needs a free API key, see step 4).

-- 1. Let event_sources take the new platforms.
alter table ingest.event_sources drop constraint if exists event_sources_platform_check;
alter table ingest.event_sources add constraint event_sources_platform_check check (platform in ('instagram','tiktok',
  'eventbrite','luma','partiful','meetup','handstamp','ticketmaster','events_calendar','localist',
  'city_calendar','venue_website','newsletter','other'));

-- 2. promote_candidate labels their events "Ticketmaster" / "Community calendar".
do $do$
declare def text := pg_get_functiondef('ingest.promote_candidate(bigint)'::regprocedure);
begin
  if def !~ 'ticketmaster' then
    execute replace(def, $r$when 'handstamp'     then 'Handstamp'$r$,
      $r$when 'handstamp'     then 'Handstamp'
      when 'ticketmaster'  then 'Ticketmaster'
      when 'events_calendar' then 'Community calendar'
      when 'localist'      then 'Community calendar'$r$);
  end if;
end $do$;

-- 3. Move the calendars that already publish these feeds onto the new readers. Each old city_calendar row (read by
--    ingest-web with AI, or by the nightly manual run) is switched off with a note; the new row keeps its name,
--    neighborhood and category. The handle becomes the site (or calendar) itself.
with old as (
  select * from ingest.event_sources
  where active and platform in ('city_calendar', 'venue_website')
    and (handle ~ '/wp-json/tribe/events/v1/events' or handle ~ '^https?://[^/]+/api/2/events')),
moved as (
  insert into ingest.event_sources (platform, handle, display_name, neighborhood, category, active, added_by, notes)
  select case when handle ~ '/api/2/events' then 'localist' else 'events_calendar' end,
         case when handle ~ '/api/2/events' then substring(handle from '^(https?://[^/]+)')
              else regexp_replace(handle, '/wp-json/tribe/events/v1/events.*$', '') end,
         display_name, neighborhood, category, true, 'structured readers',
         'Moved from ' || platform || ' source #' || id || ' (same feed, now read without AI)'
  from old
  on conflict (platform, lower(handle)) do nothing
  returning notes)
update ingest.event_sources s set active = false, updated_at = now(),
  notes = concat_ws(' | ', s.notes, 'Switched off: now read by ingest-' ||
    case when s.handle ~ '/api/2/events' then 'localist' else 'events-calendar' end || ' (structured, no AI)')
from old where s.id = old.id;

-- New calendars found while building these readers.
insert into ingest.event_sources (platform, handle, display_name, neighborhood, category, active, added_by, notes)
select * from (values
  ('localist', 'https://calendar.usc.edu', 'USC events calendar', 'University Park', null::text, true, 'structured readers',
   'Localist; only events whose audience includes the public are kept')
) v(platform, handle, display_name, neighborhood, category, active, added_by, notes)
where not exists (select 1 from ingest.event_sources s where s.platform = v.platform and lower(s.handle) = lower(v.handle));

-- 4. Ticketmaster searches around LA. They start switched off: add the TICKETMASTER_API_KEY Edge Function secret
--    (a free "Consumer Key" from developer.ticketmaster.com), then turn them on:
--      update ingest.event_sources set active = true where platform = 'ticketmaster';
--    Each search stops at 1,000 results, so music (the busiest) is split by area; the others cover the whole region.
insert into ingest.event_sources (platform, handle, display_name, neighborhood, category, active, added_by, notes)
select * from (values
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.08,-118.32&radius=8&segmentName=Music', 'Ticketmaster: music, Hollywood & central LA', 'Hollywood', 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.04,-118.25&radius=4&segmentName=Music', 'Ticketmaster: music, Downtown', 'Downtown LA', 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.02,-118.45&radius=8&segmentName=Music', 'Ticketmaster: music, Westside', 'Santa Monica', 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.18,-118.40&radius=12&segmentName=Music', 'Ticketmaster: music, Valley & Burbank', 'Burbank', 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.10,-118.08&radius=14&segmentName=Music', 'Ticketmaster: music, Pasadena & SGV', 'Pasadena', 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=33.85,-118.25&radius=16&segmentName=Music', 'Ticketmaster: music, South Bay & Long Beach', 'Long Beach', 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.30&radius=40&segmentName=Arts%20%26%20Theatre', 'Ticketmaster: theater, comedy & arts', null, 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.30&radius=40&segmentName=Sports', 'Ticketmaster: sports', null, 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.30&radius=40&segmentName=Family', 'Ticketmaster: family shows', null, 'Arts & Entertainment'),
  ('ticketmaster', 'https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.30&radius=40&segmentName=Miscellaneous', 'Ticketmaster: festivals, fairs & more', null, null)
) v(platform, handle, display_name, neighborhood, category)
cross join (select false as active, 'structured readers' as added_by,
  'Discovery API search; music is split by area to stay under its 1,000-result cap' as notes) d
where not exists (select 1 from ingest.event_sources s where s.platform = v.platform and lower(s.handle) = lower(v.handle));

-- 5. Run them with the other no-AI platforms every night (the same job as in ingest_schedule.sql).
select cron.unschedule('nightly-structured-ingest') where exists (select 1 from cron.job where jobname = 'nightly-structured-ingest');
select cron.schedule('nightly-structured-ingest', '*/10 10-11 * * *',
  $$select ingest.run('ingest-eventbrite'); select ingest.run('ingest-luma'); select ingest.run('ingest-meetup');
    select ingest.run('ingest-partiful'); select ingest.run('ingest-handstamp');
    select ingest.run('ingest-ticketmaster'); select ingest.run('ingest-events-calendar'); select ingest.run('ingest-localist');$$);

-- Try one by hand (returns right away; check ingest.ingest_runs and ingest.event_candidates a minute later):
--   select ingest.run('ingest-events-calendar');
--   select ingest.run('ingest-localist');
--   select ingest.run('ingest-ticketmaster');
