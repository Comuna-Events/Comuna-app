-- Comuna: event inventory (moved here from the "Comuna — LA Event Inventory (LIVE)" Google Sheet).
-- Run once in Supabase > SQL Editor; safe to re-run.
-- Add and edit events in Supabase > Table Editor > events. The app reads this table directly.
--  Allowed values match the old sheet's Lists tab; category and neighborhood are free text.
--  Rows with no street_address, or a status of Cancelled / Past / archived, don't show in the app.
--  lat/lng are optional: fill them in to place the pin exactly; otherwise the app looks the address up.

create table if not exists public.events (
  event_id          text primary key check (event_id ~ '^EVT-\d+$'),   -- e.g. EVT-0001; the app keys RSVPs and check-ins on it
  name              text not null,
  category          text,
  tier              text check (tier in ('Headliner','Staple','Hidden Gem','Pop-Up')),
  tags              text[] not null default '{}',
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
grant select (event_id, name, category, tier, tags, description, start_date, end_date, start_time, end_time,
              recurrence, recurrence_detail, venue, street_address, city, zip, neighborhood, setting,
              parking_transit, price_type, rsvp_required, ticket_url, capacity, age, host, source, source_url,
              image_url, status, verified, lat, lng, updated_at)
  on public.events to anon, authenticated;
