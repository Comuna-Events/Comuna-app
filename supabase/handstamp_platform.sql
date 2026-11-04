-- Comuna: Handstamp (handstamp.com) as an ingest platform, for supabase/functions/ingest-handstamp.
-- Run once in Supabase > SQL Editor, before adding handstamp rows to ingest.event_sources; safe to re-run.
-- Lets event_sources take platform 'handstamp' and labels the events promoted from it "Handstamp"
-- (the same change is made in event_ingest.sql and price_detail.sql, for fresh installs).

alter table ingest.event_sources drop constraint if exists event_sources_platform_check;
alter table ingest.event_sources add constraint event_sources_platform_check check (platform in ('instagram','tiktok',
  'eventbrite','luma','partiful','meetup','handstamp','city_calendar','venue_website','newsletter','other'));

-- promote_candidate (price_detail.sql) with Handstamp added to its source names
do $do$
declare def text := pg_get_functiondef('ingest.promote_candidate(bigint)'::regprocedure);
begin
  if def !~ 'handstamp' then
    execute replace(def, $r$when 'meetup'        then 'Meetup'$r$,
      $r$when 'meetup'        then 'Meetup'
      when 'handstamp'     then 'Handstamp'$r$);
  end if;
end $do$;
