-- Comuna: points rules (run once in Supabase > SQL Editor; safe to re-run).
--  Save it:  Interested or RSVP +10. Only your first 5 saves each day earn points.
--  Go:       verified check-in +100 (the app confirmed you were within 600 m)
--              +50 the first time you check in at that place
--              +25 if you saved the event before you went
--              +10 for rating it afterward
--  Share it: approved event you added +25 (first 3 each week),
--              plus +25 for each other person who checks in to it (max 500 per event).
--  Duplicates: set status = 'duplicate' (or 'rejected') instead of 'approved'; they earn nothing.
--  Gift cards: 3+ verified check-ins this month (gift_card_eligible column), counted across all boards.
--  Boards: points count toward the home neighborhood you had when you earned them. Change it in Profile and
--          new points go to the new board; what you already earned stays where it was.

alter table checkins add column if not exists distance_m int;
alter table rsvps    add column if not exists kind text default 'interested';

-- board = the profile's home neighborhood when the row was saved (checkins.neighborhood is the event's, not yours).
-- Stamped by the database, so the app doesn't send it and can't pick a board.
alter table rsvps             add column if not exists board text;
alter table checkins          add column if not exists board text;
alter table feedback          add column if not exists board text;
alter table event_submissions add column if not exists board text;

create or replace function public.stamp_board() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.board := (select neighborhood from profiles where id = new.user_id);
  return new;
end $$;

drop trigger if exists stamp_board on rsvps;             create trigger stamp_board before insert on rsvps             for each row execute function stamp_board();
drop trigger if exists stamp_board on checkins;          create trigger stamp_board before insert on checkins          for each row execute function stamp_board();
drop trigger if exists stamp_board on feedback;          create trigger stamp_board before insert on feedback          for each row execute function stamp_board();
drop trigger if exists stamp_board on event_submissions; create trigger stamp_board before insert on event_submissions for each row execute function stamp_board();

-- rows from before boards existed: use the neighborhood the profile has now
update rsvps r             set board = p.neighborhood from profiles p where p.id = r.user_id and r.board is null;
update checkins c          set board = p.neighborhood from profiles p where p.id = c.user_id and c.board is null;
update feedback f          set board = p.neighborhood from profiles p where p.id = f.user_id and f.board is null;
update event_submissions s set board = p.neighborhood from profiles p where p.id = s.user_id and s.board is null;

create or replace view leaderboard_month as
with m as (select date_trunc('month', now()) as start),
saves as (
  select user_id, board,
         row_number() over (partition by user_id, (created_at at time zone 'America/Los_Angeles')::date order by created_at) as n
  from rsvps, m where created_at >= m.start
),
verified as (   -- all-time verified check-ins, numbered per place so we know your first visit
  select c.*, row_number() over (partition by c.user_id, coalesce(c.venue, c.event_id) order by c.created_at) as visit_n
  from checkins c where c.distance_m <= 600
),
goes as (
  select v.user_id, v.event_id, v.board,
         100
         + case when v.visit_n = 1 then 50 else 0 end
         + case when exists (select 1 from rsvps r where r.user_id = v.user_id and r.event_id = v.event_id and r.created_at < v.created_at) then 25 else 0 end
           as p
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
  select user_id, board, 10, 0 from rated
  union all
  select user_id, board, 25, 0 from subs where n <= 3
  union all
  select user_id, board, p, 0 from turnout where p > 0
),
boards as (     -- one row per person per board they earned on this month
  select pts.user_id, coalesce(pts.board, pr.neighborhood) as board, sum(pts.p)::int as points, sum(pts.ci)::int as ci
  from pts join profiles pr on pr.id = pts.user_id
  group by 1, 2
)
select pr.id as user_id,
       split_part(coalesce(pr.name,'Explorer'),' ',1)
         || coalesce(' ' || upper(left(nullif(split_part(pr.name,' ',array_length(string_to_array(pr.name,' '),1)),split_part(pr.name,' ',1)),1)) || '.', '') as display_name,
       b.board as neighborhood,
       b.points,
       (sum(b.ci) over (partition by b.user_id))::int as checkins,   -- all boards: you qualify by going out, wherever
       sum(b.ci) over (partition by b.user_id) >= 3   as gift_card_eligible
from boards b join profiles pr on pr.id = b.user_id;

grant select on leaderboard_month to anon, authenticated;
