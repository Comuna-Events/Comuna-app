-- Comuna: the price as the event states it ("$15", "$20–40", "$10 suggested"), next to price_type (Free / Paid /
-- Donation). Run once in Supabase > SQL Editor; safe to re-run.
--
-- Run this BEFORE deploying the ingest-* functions that return price_detail (supabase/functions/_shared/extract.ts):
-- they save it to ingest.event_candidates, which needs the column first. The app reads it as soon as it exists and
-- shows "Paid" until an event has one.

alter table public.events add column if not exists price_detail text;
alter table ingest.event_candidates add column if not exists price_detail text;

comment on column public.events.price_detail is
'The price as the listing states it, short: "$15", "$20–40", "$10 suggested donation". Empty when the listing doesn''t say. price_type stays the Free / Paid / Donation label.';

-- events are readable column by column (events.sql); add this one
grant select (price_detail) on public.events to anon, authenticated;

-- Copy a reviewed candidate into events with the next EVT id. Returns that id. Same as event_ingest.sql, plus price_detail.
create or replace function ingest.promote_candidate(p_candidate_id bigint) returns text
language plpgsql set search_path = '' as $$
declare
  c      ingest.event_candidates;
  new_id text;
begin
  select * into c from ingest.event_candidates where id = p_candidate_id for update;
  if not found then raise exception 'No candidate with id %', p_candidate_id; end if;
  if c.status = 'promoted' then return c.promoted_event_id; end if;
  if c.name is null then raise exception 'Candidate % has no name yet', p_candidate_id; end if;

  perform pg_advisory_xact_lock(hashtext('events.event_id'));   -- two promotes at once can't take the same id
  select 'EVT-' || lpad((coalesce(max(substring(event_id from 5)::int), 0) + 1)::text, 4, '0')
    into new_id from public.events;

  insert into public.events (event_id, name, category, tags, vibes, description, start_date, end_date, start_time,
    end_time, recurrence, recurrence_detail, venue, street_address, city, zip, neighborhood, setting,
    price_type, price_detail, rsvp_required, ticket_url, age, host, source, source_url, image_url, lat, lng,
    status, added_by, notes, vibes_checked_at)
  values (new_id, c.name, c.category, c.tags, c.vibes, c.description, c.start_date, c.end_date, c.start_time,
    c.end_time, c.recurrence, c.recurrence_detail, c.venue, c.street_address, c.city, c.zip, c.neighborhood,
    c.setting, c.price_type, c.price_detail, c.rsvp_required, c.ticket_url, c.age, c.host,
    case c.platform
      when 'instagram'     then 'Instagram'
      when 'tiktok'        then 'TikTok'
      when 'eventbrite'    then 'Eventbrite'
      when 'luma'          then 'Luma'
      when 'partiful'      then 'Partiful'
      when 'meetup'        then 'Meetup'
      when 'city_calendar' then 'City / library calendar'
      when 'venue_website' then 'Venue website'
      when 'newsletter'    then 'Newsletter'
      else 'Other' end,
    c.source_url, c.image_url, c.lat, c.lng,
    'Needs verification', 'nightly ingest', 'From event_candidates #' || c.id,
    case when cardinality(c.vibes) > 0 then now() end);   -- vibes picked while reading the post; none: ingest-vibes takes a look

  update ingest.event_candidates set status = 'promoted', promoted_event_id = new_id where id = c.id;
  return new_id;
end $$;
revoke execute on function ingest.promote_candidate(bigint) from public, anon, authenticated;
