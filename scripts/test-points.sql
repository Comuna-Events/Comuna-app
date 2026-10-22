with rsvps as (select 'u'::text user_id,'EVT-1'::text event_id,'Test'::text board,date_trunc('month',now())+interval '1 day'+n*interval '1 minute' created_at from generate_series(1,6) n),
checkins(user_id,event_id,venue,board,created_at,distance_m) as (values
('u','EVT-1','Venue','Test',date_trunc('month',now())+interval '1 day 1 hour',20),
('u','EVT-2','Venue','Test',date_trunc('month',now())+interval '1 day 2 hours',20),
('u','EVT-3','Other','Test',date_trunc('month',now())+interval '1 day 3 hours',900),
('v','SUB-1','Community','Test',date_trunc('month',now())+interval '1 day 3 hours',20)),
feedback(user_id,event_id,board,created_at,kind) as (values
('u','EVT-1','Test',now(),'event'),('u','EVT-1','Test',now(),'event'),('u','EVT-3','Test',now(),'event'),('u','EVT-2','Test',now(),'app')),
event_submissions as (select n id,'u'::text user_id,'Test'::text board,date_trunc('month',now())+interval '1 day'+n*interval '1 minute' created_at,case when n<=4 then 'approved' else 'rejected' end status from generate_series(1,5) n),
profiles(id,name,neighborhood) as (values ('u','Test User','Test'),('v','Visitor','Test')),
m as (select date_trunc('month', now()) as start),
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
       (sum(b.ci) over (partition by b.user_id))::int as checkins   -- counted across all boards
from boards b join profiles pr on pr.id = b.user_id;