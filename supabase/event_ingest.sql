-- Comuna: nightly event ingest (Instagram, TikTok, Eventbrite, Luma, Partiful, city calendars, ...).
-- Run once in Supabase > SQL Editor; safe to re-run.
--
--  event_sources     the accounts / pages / calendars the 3am job checks. Add rows in Table Editor.
--  event_candidates  what the job found. Nothing here shows in the app until it's promoted.
--  ingest_runs       one row per platform per night, so you can see whether last night worked.
--
--  Review: Table Editor > event_candidates, filter status = 'new'. Fix any fields, then promote it:
--    select public.promote_candidate(123);   -- returns the new EVT id, lands in events as 'Needs verification'
--  Not an event / already listed: set status to 'rejected' / 'duplicate' instead.
--
--  The ingest functions write with the service role key, which skips RLS. The app (anon / signed-in users)
--  can't read or write any of these tables.

-- Platforms the ingest knows about. Add a value here when someone starts a new one.
--   instagram, tiktok, eventbrite, luma, partiful, meetup, city_calendar, venue_website, newsletter, other

create table if not exists public.event_sources (
  id               bigint generated always as identity primary key,
  platform         text not null check (platform in ('instagram','tiktok','eventbrite','luma','partiful',
                     'meetup','city_calendar','venue_website','newsletter','other')),
  handle           text not null,          -- @handle for social accounts, or the page / calendar / feed URL
  display_name     text,                   -- e.g. "Echo Park Rec Center"
  neighborhood     text,                   -- default neighborhood for events found here
  category         text,                   -- default category, if the account only does one kind of thing
  active           boolean not null default true,   -- false = the job skips it
  last_checked_at  timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  added_by         text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists event_sources_platform_handle_key on public.event_sources (platform, lower(handle));
create index if not exists event_sources_active_idx on public.event_sources (platform) where active;

create table if not exists public.ingest_runs (
  id                  bigint generated always as identity primary key,
  platform            text not null,
  status              text not null default 'running'
                        check (status in ('running','succeeded','partial','failed')),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  sources_checked     int not null default 0,
  posts_seen          int not null default 0,
  candidates_new      int not null default 0,
  candidates_updated  int not null default 0,
  error               text,
  details             jsonb                -- anything else worth keeping: per-source errors, cost, model used
);
create index if not exists ingest_runs_platform_idx on public.ingest_runs (platform, started_at desc);

-- Fields mirror public.events so promoting is a straight copy. No value checks here on purpose:
-- a bad AI guess (e.g. an unknown recurrence) shouldn't drop the row; promote_candidate catches it instead.
create table if not exists public.event_candidates (
  id                 bigint generated always as identity primary key,
  source_id          bigint references public.event_sources(id) on delete set null,
  run_id             bigint references public.ingest_runs(id) on delete set null,
  platform           text not null,
  external_id        text not null,        -- the post / event id on that platform; re-runs update instead of duplicating
  posted_at          timestamptz,          -- when the post went up
  raw                jsonb,                -- the original caption / page / API response the AI read

  name               text,
  category           text,
  tags               text[] not null default '{}',
  description        text,
  start_date         date,
  end_date           date,
  start_time         time,
  end_time           time,
  recurrence         text,
  recurrence_detail  text,
  venue              text,
  street_address     text,
  city               text,
  zip                text,
  neighborhood       text,
  setting            text,
  price_type         text,
  rsvp_required      boolean,
  ticket_url         text,
  age                text,
  host               text,
  source_url         text,                 -- link to the post / event page
  image_url          text,
  lat                double precision,
  lng                double precision,

  confidence         real check (confidence between 0 and 1),   -- how sure the AI is this is a real, upcoming, public event
  ai_notes           text,                 -- the AI's reasoning / anything it wasn't sure about
  status             text not null default 'new'
                       check (status in ('new','promoted','duplicate','rejected')),
  review_note        text,
  promoted_event_id  text references public.events(event_id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (platform, external_id)
);
create index if not exists event_candidates_review_idx on public.event_candidates (status, start_date);
create index if not exists event_candidates_source_idx on public.event_candidates (source_id);

-- updated_at (events_touch comes from events.sql)
drop trigger if exists events_touch on public.event_sources;
create trigger events_touch before update on public.event_sources
  for each row execute function public.events_touch();
drop trigger if exists events_touch on public.event_candidates;
create trigger events_touch before update on public.event_candidates
  for each row execute function public.events_touch();

-- Locked to the dashboard and the ingest functions (service role).
alter table public.event_sources    enable row level security;
alter table public.event_candidates enable row level security;
alter table public.ingest_runs      enable row level security;
revoke all on public.event_sources, public.event_candidates, public.ingest_runs from anon, authenticated;

-- Copy a reviewed candidate into events with the next EVT id. Returns that id.
create or replace function public.promote_candidate(p_candidate_id bigint) returns text
language plpgsql set search_path = '' as $$
declare
  c      public.event_candidates;
  new_id text;
begin
  select * into c from public.event_candidates where id = p_candidate_id for update;
  if not found then raise exception 'No candidate with id %', p_candidate_id; end if;
  if c.status = 'promoted' then return c.promoted_event_id; end if;
  if c.name is null then raise exception 'Candidate % has no name yet', p_candidate_id; end if;

  perform pg_advisory_xact_lock(hashtext('events.event_id'));   -- two promotes at once can't take the same id
  select 'EVT-' || lpad((coalesce(max(substring(event_id from 5)::int), 0) + 1)::text, 4, '0')
    into new_id from public.events;

  insert into public.events (event_id, name, category, tags, description, start_date, end_date, start_time,
    end_time, recurrence, recurrence_detail, venue, street_address, city, zip, neighborhood, setting,
    price_type, rsvp_required, ticket_url, age, host, source, source_url, image_url, lat, lng,
    status, added_by, notes)
  values (new_id, c.name, c.category, c.tags, c.description, c.start_date, c.end_date, c.start_time,
    c.end_time, c.recurrence, c.recurrence_detail, c.venue, c.street_address, c.city, c.zip, c.neighborhood,
    c.setting, c.price_type, c.rsvp_required, c.ticket_url, c.age, c.host,
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
    'Needs verification', 'nightly ingest', 'From event_candidates #' || c.id);

  update public.event_candidates set status = 'promoted', promoted_event_id = new_id where id = c.id;
  return new_id;
end $$;
revoke execute on function public.promote_candidate(bigint) from public, anon, authenticated;
