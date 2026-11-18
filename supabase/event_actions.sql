-- Comuna: per-event view and tap tracking (for host stats).
-- Run once in Supabase > SQL Editor.

create table if not exists public.event_actions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  event_id     text not null,
  event_title  text,
  action       text not null check (action in
                 ('view','interested','rsvp','directions','calendar','link','invite','checkin')),
  neighborhood text,
  category     text,
  created_at   timestamptz not null default now()
);
create index if not exists event_actions_event_idx on public.event_actions (event_id, created_at);

-- Users can only add their own rows; nobody can read raw rows from the app.
alter table public.event_actions enable row level security;
drop policy if exists "insert own actions" on public.event_actions;
create policy "insert own actions" on public.event_actions
  for insert to authenticated with check (auth.uid() = user_id);

-- The per-event summary view (event_stats) is defined only in guests.sql, which adds the guest columns; run that
-- file after this one. Defining it here too would make a re-run of this file fail once guests.sql has run.
