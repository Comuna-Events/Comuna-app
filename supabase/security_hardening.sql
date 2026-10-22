-- Comuna: clears Supabase Security Advisor's errors and the warnings that point at real gaps.
-- Run in Supabase > SQL Editor in two steps. Both are safe to re-run.
--
-- What's left on purpose after this (Security Advisor will still list them):
--   * check_in, delete_my_account, guest_seen, guest_converted, going_counts, leaderboard_top and
--     my_points_this_month are SECURITY DEFINER functions the app calls on purpose. Each does one narrow thing.
--   * ingest.*, guest_sessions and blocked_submitters have row-level security on and no policies:
--     only the team (dashboard, service role) can reach them, which is the point.
--   * "Leaked password protection": the app has no passwords (email codes only).

-- ============ Step 1: run any time (additive; the current app keeps working) ============

-- The app reads counts and the leaderboard through these instead of the views, so the views can stop
-- being public. They return only what the app shows: no other person's user id.

-- "N interested" on each event: how many people saved it, counted across everyone's plans
create or replace function public.going_counts()
returns table (event_id text, going int)
language sql stable security definer set search_path = public as $$
  select event_id, going from event_going
$$;

-- a neighborhood's monthly top list; is_me marks the signed-in person's own row
create or replace function public.leaderboard_top(p_board text, p_limit int default 5)
returns table (display_name text, points int, is_me boolean)
language sql stable security definer set search_path = public as $$
  select display_name, points, user_id = auth.uid()
  from leaderboard_month
  where neighborhood = p_board
  order by points desc
  limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;

-- your points this month, across every board you earned them on
create or replace function public.my_points_this_month()
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::int from leaderboard_month where user_id = auth.uid()
$$;

-- Supabase grants new functions to anon and authenticated directly, so revoke from them as well as public
revoke execute on function public.going_counts(), public.leaderboard_top(text, int), public.my_points_this_month() from public, anon, authenticated;
grant execute on function public.going_counts(), public.leaderboard_top(text, int) to anon, authenticated;
grant execute on function public.my_points_this_month() to authenticated;

comment on function public.going_counts() is '[App users] How many people saved each event. The app reads this instead of event_going.';
comment on function public.leaderboard_top(text, int) is '[App users] A neighborhood''s monthly top list, without user ids.';
comment on function public.my_points_this_month() is '[App users] The signed-in person''s points this month, across all boards.';

-- stamp_board only runs as a trigger; nobody should call it directly
revoke execute on function public.stamp_board() from public, anon, authenticated;

-- pin the search path on functions that didn't have one (they only use built-ins and schema-qualified names)
alter function public.comuna_category(text, text) set search_path = pg_catalog, public;
alter function public.comuna_category_key(text) set search_path = pg_catalog, public;
alter function public.events_category() set search_path = pg_catalog, public;
alter function ingest.manual_text(text, integer) set search_path = pg_catalog, ingest;
alter function ingest.manual_timerange(text) set search_path = pg_catalog, ingest;
alter function ingest.manual_decode(text) set search_path = pg_catalog, ingest;
alter function ingest.manual_visible(text) set search_path = pg_catalog, ingest;

-- ============ Step 2: run once the app that calls going_counts / leaderboard_top is live ============
-- The views stop running with their owner's access and stop being readable from the app's API.
-- The functions above still read them (they run as their owner), and the team still can in the dashboard.

alter view public.event_going set (security_invoker = true);
alter view public.leaderboard_month set (security_invoker = true);
revoke all on public.event_going, public.leaderboard_month from anon, authenticated;
