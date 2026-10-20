-- Comuna: event inventory (moved here from the "Comuna — LA Event Inventory (LIVE)" Google Sheet).
-- Run once in Supabase > SQL Editor; safe to re-run.
-- Add and edit events in Supabase > Table Editor > events. The app reads this table directly.
--  Allowed values match the old sheet's Lists tab; neighborhood is free text.
--  category is one of the app's six (see categories.sql, which maps anything else on save).
--  Rows with no street_address, or a status of Cancelled / Past / archived, don't show in the app.
--  lat/lng fill themselves in from the address (see geocode.sql); only type them to move a pin by hand.
--  Any still blank, the app looks up from the address on the phone.

create table if not exists public.events (
  event_id          text primary key check (event_id ~ '^EVT-\d+$'),   -- e.g. EVT-0001; the app keys RSVPs and check-ins on it
  name              text not null,
  category          text,
  tier              text check (tier in ('Headliner','Staple','Hidden Gem','Pop-Up')),
  tags              text[] not null default '{}',
  vibes             text[] not null default '{}',                     -- from the fixed list below; the AI fills these in
  description       text,
  start_date        date,
  end_date          date,
  start_time        time,
  end_time          time,
  recurrence        text check (recurrence in ('One-off','Daily','Weekly','Biweekly','Monthly','Seasonal / Annual')),
  recurrence_detail text,
  venue             text,
  street_address    text,
  city              text,
  zip               text,
  neighborhood      text,
  setting           text check (setting in ('Indoor','Outdoor','Both')),
  parking_transit   text,
  price_type        text check (price_type in ('Free','Paid','Donation / Pay-what-you-can')),
  rsvp_required     boolean,
  ticket_url        text,
  capacity          text check (capacity in ('Broad (100+)','Mid (25–100)','Intimate (<25)')),
  age               text check (age in ('All ages','18+','21+')),
  host              text,
  host_contact      text,                                              -- private: not readable from the app
  source            text,
  source_url        text,
  image_url         text,
  status            text not null default 'Needs verification'
                      check (status in ('Needs verification','Verified','Live in app','Cancelled','Past / archived')),
  date_added        date default current_date,                         -- private
  added_by          text,                                              -- private
  verified          boolean not null default false,
  notes             text,                                              -- private
  lat               double precision,
  lng               double precision,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists events_status_idx on public.events (status);

-- vibes: what an event feels like, from a fixed list so they stay consistent and searchable. The nightly ingest
-- picks them (supabase/functions/_shared/vibes.ts); ingest-vibes fills in events added by hand. Change the list
-- there, here and in the app's VIBE_WORDS together.
alter table public.events add column if not exists vibes text[] not null default '{}';   -- added after the first version
alter table public.events add column if not exists vibes_checked_at timestamptz;          -- private: when ingest-vibes last picked them
alter table public.events drop constraint if exists events_vibes_check;
alter table public.events add constraint events_vibes_check check (vibes <@ array['spooky','festive','date night','family-friendly','solo-friendly','late night','live music','dance','chill','creative','cultural','dog-friendly']::text[]);

create or replace function public.events_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.events_touch();

-- Anyone (signed in or not) can read events; nobody can write from the app.
alter table public.events enable row level security;
drop policy if exists "anyone can read events" on public.events;
create policy "anyone can read events" on public.events
  for select to anon, authenticated using (true);

-- Only the columns the app shows are readable; notes and contacts stay in the dashboard.
revoke all on public.events from anon, authenticated;
grant select (event_id, name, category, tier, tags, vibes, description, start_date, end_date, start_time, end_time,
              recurrence, recurrence_detail, venue, street_address, city, zip, neighborhood, setting,
              parking_transit, price_type, rsvp_required, ticket_url, capacity, age, host, source, source_url,
              image_url, status, verified, lat, lng, updated_at)
  on public.events to anon, authenticated;
