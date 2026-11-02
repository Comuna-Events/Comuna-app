-- Comuna: the neighborhood leaderboards stop resetting each month (run once in Supabase > SQL Editor; safe to re-run).
-- Points now count from leaderboard_start(), which is all time for now, so boards keep everyone who has earned
-- points. Nothing is deleted either way: points are always worked out from rsvps, checkins, feedback and submissions.
--
-- Going back to monthly boards later (e.g. once there are lots of monthly users) is one statement, no app release:
--   create or replace function public.leaderboard_start() returns timestamptz
--   language sql stable set search_path = pg_catalog as $$ select date_trunc('month', now()) $$;
--
-- The view keeps its name and columns, so leaderboard_top(), my_points_this_month() and achievements keep working.
-- Same view as points_rules.sql, with the start date read from leaderboard_start().

create or replace function public.leaderboard_start() returns timestamptz
language sql stable set search_path = pg_catalog as $$
  select '-infinity'::timestamptz
$$;

create or replace view leaderboard_month with (security_invoker = true) as
with m as (select public.leaderboard_start() as start),
saves as (
  select user_id, board,
         row_number() over (partition by user_id, (created_at at time zone 'America/Los_Angeles')::date order by created_at) as n
  from rsvps, m where created_at >= m.start
),
verified as (   -- all-time verified check-ins establish attendance for reviews and turnout
  select c.*
  from checkins c where c.distance_m <= 600
),
goes as (
  select v.user_id, v.event_id, v.board,
         100 as p
  from verified v, m where v.created_at >= m.start
),
rated as (      -- one rating per event you actually went to
  select distinct on (f.user_id, f.event_id) f.user_id, f.event_id, f.board
  from feedback f, m
  where f.kind = 'event' and f.created_at >= m.start
    and exists (select 1 from verified v where v.user_id = f.user_id and v.event_id = f.event_id)
),
subs as (
  select id, user_id, board,
         row_number() over (partition by user_id, date_trunc('week', created_at) order by created_at) as n
  from event_submissions, m
  where status = 'approved' and created_at >= m.start
),
turnout as (    -- other people who went to events you added (app event ids look like SUB-123)
  select s.user_id, s.board,
         least(500, 25 * (select count(*) from verified v, m
                          where v.event_id = 'SUB-' || s.id and v.user_id <> s.user_id and v.created_at >= m.start)) as p
  from event_submissions s where s.status = 'approved'
),
pts as (
  select user_id, board, 10 as p, 0 as ci from saves where n <= 5
  union all
  select user_id, board, p, 1 from goes
  union all
  select user_id, board, 100, 0 from rated
  union all
  select user_id, board, 100, 0 from subs where n <= 3
  union all
  select user_id, board, p, 0 from turnout where p > 0
),
boards as (     -- one row per person per board they earned on since leaderboard_start()
  select pts.user_id, coalesce(pts.board, pr.neighborhood) as board, sum(pts.p)::int as points, sum(pts.ci)::int as ci
  from pts join profiles pr on pr.id = pts.user_id
  group by 1, 2
)
select pr.id as user_id,
       split_part(coalesce(pr.name,'Explorer'),' ',1)
         || coalesce(' ' || upper(left(nullif(split_part(pr.name,' ',array_length(string_to_array(pr.name,' '),1)),split_part(pr.name,' ',1)),1)) || '.', '') as display_name,
       b.board as neighborhood,
       b.points,
       (sum(b.ci) over (partition by b.user_id))::int as checkins   -- counted across all boards
from boards b join profiles pr on pr.id = b.user_id;

revoke all on leaderboard_month from anon, authenticated;
comment on view leaderboard_month is '[App users] Points per person since leaderboard_start() (all time for now), built from rsvps, checkins, feedback and submissions. The app reads it through leaderboard_top() and my_points_this_month().';
comment on function public.leaderboard_start() is '[Team] When leaderboard points start counting from: -infinity (all time) for now; date_trunc(''month'', now()) for monthly boards.';
comment on function public.leaderboard_top(text, int) is
'[App users] A neighborhood''s top list (points since leaderboard_start()), without user ids: first name + last initial, or a nickname the person chose; hidden people left out.';
comment on function public.my_points_this_month() is '[App users] The signed-in person''s points since leaderboard_start() (all time for now), across all boards. Name kept so the app doesn''t change.';
