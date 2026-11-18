-- Comuna: the map's search bar. What people search for, and where each event tap came from.
-- Run in Supabase > SQL Editor after event_actions.sql and before table_descriptions.sql; safe to re-run.
-- Until this runs, the app still works: searches just aren't saved and taps are saved without a placement.

-- [App users] One row per search someone ran (or per event they picked straight from the suggestions).
create table if not exists public.search_queries (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  query           text not null check (char_length(query) <= 200),
  result_count    integer,                -- events the search found; null when they picked an event from the suggestions
  picked_event_id text,                   -- the event they tapped in the suggestions, if any
  when_filter     text,                   -- the When filter the results were shown with (any / tonight / week / month)
  type_filter     text,                   -- the Type filter (All, a category, or a tier)
  neighborhood    text,                   -- their home neighborhood
  created_at      timestamptz not null default now()
);
create index if not exists search_queries_created_idx on public.search_queries (created_at);

-- Users can only add their own rows; nobody can read raw rows from the app.
alter table public.search_queries enable row level security;
drop policy if exists "insert own searches" on public.search_queries;
create policy "insert own searches" on public.search_queries
  for insert to authenticated with check (auth.uid() = user_id);

-- Where an event was opened from: map, list, search, search_suggestion, picks, plans...
-- and the search that was showing at the time. Lets us report what search and (later) sponsored slots bring a host.
alter table public.event_actions add column if not exists placement    text;
alter table public.event_actions add column if not exists search_query text;

-- The search_terms summary view is defined only in guests.sql, which adds the guest columns; run that file after
-- this one. Defining it here too would make a re-run of this file fail once guests.sql has run.

comment on table public.search_queries is '[App users] Every search run from the map''s search bar: the words, how many events it found, the filters shown.';
