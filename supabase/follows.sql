-- Comuna: follow a venue or a host. Run in Supabase > SQL Editor before push.sql (which reads this table); safe to
-- re-run.
--
-- The event page has a Follow button for its venue and, when it's someone else, its host. Following one:
--   - a "New from places you follow" notification (push.sql, due_push_extras(): at most one a day, 6-8 PM, not on
--     Mondays and Fridays, when the picks go out), with what they've added since the last one
--   - their events rank higher in the Monday / Friday picks (push_picks()) and in the app's daily picks
-- Names are matched case- and space-insensitively (key), the way the event lists them; a library system such as
-- "LA County Library" is one host across all its branches.

-- [App users] Who follows which venue or host. name is as the event shows it; key is what matching uses.
create table if not exists public.follows (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('venue', 'host')),
  name       text not null check (length(name) between 1 and 200),
  key        text generated always as (lower(btrim(name))) stored,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);
create index if not exists follows_key on public.follows (kind, key);

-- the app reads, adds and removes its own follows; nobody else's
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;
drop policy if exists "own follows" on public.follows;
create policy "own follows" on public.follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- at most 300 each, so a script can't follow every venue in LA
create or replace function public.follows_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from follows where user_id = new.user_id) >= 300 then
    raise exception 'You can follow up to 300 places.';
  end if;
  return new;
end $$;
drop trigger if exists follows_limit on public.follows;
create trigger follows_limit before insert on public.follows for each row execute function public.follows_limit();

comment on table public.follows is
'[App users] Venues and hosts someone follows (the event page''s Follow button). Feeds the new-from-places-you-follow notification and boosts picks.';
