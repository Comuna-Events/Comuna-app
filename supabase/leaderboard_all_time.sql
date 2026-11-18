-- Comuna: the neighborhood leaderboards stop resetting each month (run once in Supabase > SQL Editor; safe to re-run).
-- Points now count from leaderboard_start(), which is all time for now, so boards keep everyone who has earned
-- points. Nothing is deleted either way: points are always worked out from rsvps, checkins, feedback and submissions.
--
-- Going back to monthly boards later (e.g. once there are lots of monthly users) is one statement, no app release:
--   create or replace function public.leaderboard_start() returns timestamptz
--   language sql stable set search_path = pg_catalog as $$ select date_trunc('month', now()) $$;
--
-- The view keeps its name and columns, so leaderboard_top(), my_points_this_month() and achievements keep working.
-- OWNER of public.leaderboard_start() (supabase/README.md). points_rules.sql only creates it if it's missing.
-- Re-running this file sets the board to all time; if you've switched to monthly, don't re-run it.

create or replace function public.leaderboard_start() returns timestamptz
language sql stable set search_path = pg_catalog as $$
  select '-infinity'::timestamptz
$$;

-- The leaderboard_month view is defined only in points_rules.sql (it already reads leaderboard_start()), so it
-- isn't redefined here: change the setting above and the view follows. Re-running THIS file sets all time again.

revoke all on leaderboard_month from anon, authenticated;
comment on view leaderboard_month is '[App users] Points per person since leaderboard_start() (all time for now), built from rsvps, checkins, feedback and submissions. The app reads it through leaderboard_top() and my_points_this_month().';
comment on function public.leaderboard_start() is '[Team] When leaderboard points start counting from: -infinity (all time) for now; date_trunc(''month'', now()) for monthly boards.';
comment on function public.my_points_this_month() is '[App users] The signed-in person''s points since leaderboard_start() (all time for now), across all boards. Name kept so the app doesn''t change.';
