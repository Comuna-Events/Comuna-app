-- Comuna: achievements and titles (run once in Supabase > SQL Editor; safe to re-run).
--
-- People earn achievements from verified check-ins (distance_m <= 600, the same rule as points), and each one
-- unlocks a title they can show after their name: "Joe P. · Bean Counter". Nothing here earns points.
--
--  achievements       the catalogue. The team can edit name, title, blurb, goal, hidden and active right here
--                     (Table Editor) without an app update. metric says which rule counts toward it; achievements
--                     sharing a metric are tiers of it (Explorer I/II/III all use 'neighborhoods').
--                     Seeding below only adds missing rows, so edits made in the dashboard survive a re-run.
--  user_achievements  what each person has earned, and when. Earned once, kept for good, even if a goal is raised later.
--  profiles.title_key the achievement whose title someone wears. A trigger only allows ones they've earned.
--
-- The app calls my_achievements(): it works out progress from the person's history, saves anything newly earned,
-- and returns the catalogue with their progress. Past check-ins count, so existing accounts unlock on first open.
-- leaderboard_top() now also returns each person's title.
--
-- To add an achievement: insert a row with an existing metric and a new goal. A new kind of rule needs a new
-- metric in achievement_progress() below.

create table if not exists public.achievements (
  key     text primary key,
  section text not null,              -- everyday | habits | explore | kinds | contributing | seasonal | hidden
  name    text not null,
  title   text not null,              -- shown after the name once earned
  blurb   text not null,              -- the rule, as the app shows it
  metric  text not null,
  goal    int  not null check (goal > 0),
  hidden  boolean not null default false,   -- not listed until earned
  active  boolean not null default true,    -- false: not shown and can't be earned (already earned ones stay)
  sort    int  not null default 0
);

insert into public.achievements (key, section, name, title, blurb, metric, goal, hidden, sort) values
  ('coffee_1',       'everyday',     'Bean Counter',        'Bean Counter',       'Check in to 3 coffee events',                         'coffee',          3, false, 100),
  ('coffee_2',       'everyday',     'Bean Counter II',     'Barista''s Favorite', 'Check in to 10 coffee events',                       'coffee',         10, false, 101),
  ('market_1',       'everyday',     'Market Day',          'Market Regular',     'Check in at 3 farmers markets',                       'farmers_market',  3, false, 110),
  ('market_2',       'everyday',     'Heirloom',            'Heirloom',           'Check in at 10 farmers markets',                      'farmers_market', 10, false, 111),
  ('market_seasons', 'everyday',     'Peak Season',         'In Season',          'A farmers market in spring, summer, fall and winter', 'market_seasons',  4, false, 112),
  ('flea',           'everyday',     'Treasure Hunter',     'Treasure Hunter',    'Check in at 3 flea, vintage or swap markets',         'flea',            3, false, 120),
  ('run_club',       'everyday',     'Will Run for Coffee', 'Pace Setter',        'Check in to 5 run clubs',                             'run_club',        5, false, 130),
  ('trivia',         'everyday',     'Know-It-All',         'Know-It-All',        'Check in to 5 trivia or quiz nights',                 'trivia',          5, false, 140),
  ('mic',            'everyday',     'Mic Drop',            'Mic Hog',            'Check in to 3 open mics or karaoke nights',           'mic',             3, false, 150),
  ('wellness',       'everyday',     'Namaste Local',       'Zen Local',          'Check in to 5 yoga, meditation or sound baths',       'wellness',        5, false, 160),
  ('books',          'everyday',     'Bookworm',            'Bookworm',           'Check in to 3 book clubs, readings or author talks',  'books',           3, false, 170),
  ('tasting',        'everyday',     'Tasting Notes',       'Tasting Notes',      'Check in to 3 wine, beer or brewery tastings',        'tasting',         3, false, 180),
  ('outdoor_movie',  'everyday',     'Blanket Claimer',     'Front Row Picnic',   'Check in to 3 outdoor movies',                        'outdoor_movie',   3, false, 190),
  ('dog',            'everyday',     'Good Boy',            'Dog''s Best Friend', 'Check in to 5 dog-friendly events',                   'dog',             5, false, 200),
  ('free',           'everyday',     'Free Spirit',         'Free Spirit',        'Check in to 10 free events',                          'free',           10, false, 210),
  ('volunteer',      'everyday',     'Good Neighbor',       'Good Neighbor',      'Check in to 3 cleanups or volunteer events',          'volunteer',       3, false, 220),
  ('early',          'habits',       'Early Bird',          'Early Bird',         '5 events that start before 9am',                      'early',           5, false, 300),
  ('late',           'habits',       'Night Owl',           'Night Owl',          '5 events that start at 9pm or later',                 'late',            5, false, 310),
  ('norm',           'habits',       'Norm!',               'Norm!',              'Go to the same event 4 times',                        'same_event',      4, false, 320),
  ('double',         'habits',       'Double Booked',       'Double Booked',      '2 events in one day',                                 'per_day',         2, false, 330),
  ('hat_trick',      'habits',       'Hat Trick',           'Hat Trick',          '3 events in one day',                                 'per_day',         3, false, 331),
  ('weekend',        'habits',       'Weekend Warrior',     'Weekend Warrior',    'Out on Saturday and Sunday of the same weekend, 3 times', 'weekends',    3, false, 340),
  ('midweek',        'habits',       'Midweek Mischief',    'Midweek Menace',     '5 check-ins on a Tuesday or Wednesday',               'midweek',         5, false, 350),
  ('streak_4',       'habits',       'On a Roll',           'On a Roll',          'A check-in every week for 4 weeks in a row',          'week_streak',     4, false, 360),
  ('streak_12',      'habits',       'Creature of Habit',   'Creature of Habit',  'A check-in every week for 12 weeks in a row',         'week_streak',    12, false, 361),
  ('explorer_1',     'explore',      'Explorer I',          'Wanderer',           'Events in 5 different neighborhoods or cities',       'neighborhoods',   5, false, 400),
  ('explorer_2',     'explore',      'Explorer II',         'Explorer',           'Events in 15 different neighborhoods or cities',      'neighborhoods',  15, false, 401),
  ('explorer_3',     'explore',      'Explorer III',        'Cartographer',       'Events in 30 different neighborhoods or cities',      'neighborhoods',  30, false, 402),
  ('home',           'explore',      'Home Turf',           'Local',              '10 check-ins in your home neighborhood',              'home',           10, false, 410),
  ('gem',            'kinds',        'Gem Hunter',          'Gem Hunter',         'Check in to 5 Hidden Gems',                           'hidden_gem',      5, false, 500),
  ('popup',          'kinds',        'I Was There',         'I Was There',        'Check in to 3 one-time Pop-ups',                      'popup',           3, false, 510),
  ('headliner',      'kinds',        'Big Ticket',          'Big Ticket',         'Check in to 3 Headliners',                            'headliner',       3, false, 520),
  ('all_kinds',      'kinds',        'Well-Rounded',        'Renaissance Local',  'A check-in in each of the 6 categories',              'categories',      6, false, 530),
  ('scout',          'contributing', 'Scout',               'Scout',              'Someone checks in to an event you shared',            'scout',           1, false, 600),
  ('tastemaker',     'contributing', 'Tastemaker',          'Tastemaker',         '10 check-ins by others at events you shared',         'tastemaker',     10, false, 610),
  ('critic',         'contributing', 'Local Critic',        'Local Critic',       'Review 10 events you checked in to',                  'reviews',        10, false, 620),
  ('founding',       'contributing', 'Founding Local',      'OG',                 'Joined Comuna in its first days',                     'founding',        1, false, 630),
  ('spooky',         'seasonal',     'Boo Crew',            'Boo Crew',           '3 spooky events in October',                          'spooky_oct',      3, false, 700),
  ('festive',        'seasonal',     'Holiday Hopper',      'Holiday Hopper',     '3 festive events in December',                        'festive_dec',     3, false, 710),
  ('summer',         'seasonal',     'Summer Nights',       'Summer Local',       '5 evening events, June to August',                    'summer_nights',   5, false, 720),
  ('plot_twist',     'hidden',       'Plot Twist',          'Plot Twist',         'Events in 3 different categories in one week',        'week_categories', 3, true,  800),
  ('full_send',      'hidden',       'Full Send',           'Full Send',          '4 events in one day',                                 'per_day',         4, true,  810),
  ('comeback',       'hidden',       'Comeback Kid',        'Comeback Kid',       'Back out after 60+ days away',                        'comeback',        1, true,  820)
on conflict (key) do nothing;

create table if not exists public.user_achievements (
  user_id   uuid not null references auth.users (id) on delete cascade,
  key       text not null references public.achievements (key) on update cascade on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.profiles add column if not exists title_key text;
alter table public.profiles drop constraint if exists profiles_title_key_fkey;
alter table public.profiles add constraint profiles_title_key_fkey
  foreign key (title_key) references public.achievements (key) on update cascade on delete set null;

-- The catalogue is public (it's what the app lists). What people earned is only reachable through my_achievements().
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
drop policy if exists "achievements are public" on public.achievements;
create policy "achievements are public" on public.achievements for select to anon, authenticated using (active);
revoke insert, update, delete, truncate on public.achievements, public.user_achievements from anon, authenticated;
revoke select on public.user_achievements from anon, authenticated;

-- A title can only be one you've earned. The app sets it with an ordinary profile update.
create or replace function public.check_title() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.title_key is not null and not exists (
    select 1 from user_achievements where user_id = new.id and key = new.title_key) then
    raise exception 'You haven''t earned that title yet.';
  end if;
  return new;
end $$;
drop trigger if exists check_title on public.profiles;
create trigger check_title before insert or update of title_key on public.profiles
  for each row execute function public.check_title();
revoke execute on function public.check_title() from public, anon, authenticated;

-- Progress on every metric for one person. Events are matched on words in their name, tags and venue,
-- so a few will be counted wrongly until tags are cleaned up.
create or replace function public.achievement_progress(p_uid uuid)
returns table (metric text, progress int)
language sql stable security definer set search_path = public as $$
  with v as (     -- verified visits, with what we know about each event
    select c.event_id, c.checkin_date as d, c.neighborhood as hood, c.category as cat,
           lower(concat_ws(' ', coalesce(e.name, s.title, c.event_title), array_to_string(e.tags, ' '), coalesce(e.venue, s.venue, c.venue))) as txt,
           e.tier, coalesce(e.recurrence, s.recurrence) as rec, coalesce(e.start_time, s.start_time) as t0,
           coalesce(e.price_type, s.price) as price, coalesce(e.vibes, '{}') as vibes
    from checkins c
    left join events e on e.event_id = c.event_id
    left join event_submissions s on c.event_id ~ '^SUB-\d+$' and s.id = substring(c.event_id from 5)::bigint
    where c.user_id = p_uid and c.distance_m <= 600
  ),
  k as (
    select v.*,
      txt ~ 'farmers?.{0,2}market' as is_market,
      date_trunc('week', d)::date as wk
    from v
  ),
  days as (select distinct d from v),
  weeks as (select distinct date_trunc('week', d)::date as wk from v),
  runs as (       -- consecutive weeks: each run of weeks shares the same (week - its position)
    select count(*) as n from (select wk, wk - (row_number() over (order by wk))::int * 7 as grp from weeks) w group by grp
  ),
  gaps as (select d - lag(d) over (order by d) as gap from days),
  mine as (select id from event_submissions where user_id = p_uid and status = 'approved'),
  others as (     -- other people's verified check-ins at events this person shared
    select c.event_id from checkins c join mine m on c.event_id = 'SUB-' || m.id
    where c.user_id <> p_uid and c.distance_m <= 600
  )
  select m, coalesce(p, 0)::int from (values
    ('coffee',          (select count(*) from k where txt ~ '\mcoffee|café|\mcafe\M|espresso|latte|roaster')),
    ('farmers_market',  (select count(*) from k where is_market)),
    ('market_seasons',  (select count(distinct (extract(month from d)::int % 12) / 3) from k where is_market)),
    ('flea',            (select count(*) from k where txt ~ 'flea|vintage|swap meet|thrift|antique')),
    ('run_club',        (select count(*) from k where txt ~ 'run club|running club|\m5k\M|\m10k\M')),
    ('trivia',          (select count(*) from k where txt ~ 'trivia|quiz')),
    ('mic',             (select count(*) from k where txt ~ 'open mic|karaoke')),
    ('wellness',        (select count(*) from k where txt ~ 'yoga|meditat|sound bath|breathwork')),
    ('books',           (select count(*) from k where txt ~ 'book club|bookstore|book store|author|reading|poetry')),
    ('tasting',         (select count(*) from k where txt ~ '\mwine|\mbeer|brewer|tasting')),
    ('outdoor_movie',   (select count(*) from k where txt ~ 'outdoor (movie|cinema|screening|film)|movies? (in|on) the|rooftop cinema|cinespia|street food cinema')),
    ('dog',             (select count(*) from k where 'dog-friendly' = any(vibes) or txt ~ '\mdogs?\M|\mpup(s|py)?\M')),
    ('free',            (select count(*) from k where price ~* 'free')),
    ('volunteer',       (select count(*) from k where txt ~ 'clean ?up|volunteer')),
    ('early',           (select count(*) from k where t0 < '09:00')),
    ('late',            (select count(*) from k where t0 >= '21:00')),
    ('same_event',      (select max(n) from (select count(*) n from k group by event_id) x)),
    ('per_day',         (select max(n) from (select count(*) n from k group by d) x)),
    ('weekends',        (select count(*) from (select wk from k group by wk
                           having bool_or(extract(isodow from d) = 6) and bool_or(extract(isodow from d) = 7)) x)),
    ('midweek',         (select count(*) from k where extract(isodow from d) in (2, 3))),
    ('week_streak',     (select max(n) from runs)),
    ('neighborhoods',   (select count(distinct hood) from k)),
    ('home',            (select count(*) from k join profiles p on p.id = p_uid where k.hood = p.neighborhood)),
    ('hidden_gem',      (select count(*) from k where tier ~* 'hidden|gem|niche')),
    ('popup',           (select count(*) from k where tier ~* 'pop' or (tier is null and rec ~* 'one'))),
    ('headliner',       (select count(*) from k where tier ~* 'headlin|corner')),
    ('categories',      (select count(distinct cat) from k)),
    ('scout',           (select count(distinct event_id) from others)),
    ('tastemaker',      (select count(*) from others)),
    ('reviews',         (select count(distinct f.event_id) from feedback f
                           where f.user_id = p_uid and f.kind = 'event' and exists (select 1 from k where k.event_id = f.event_id))),
    -- placeholder cutoff until the team picks one
    ('founding',        (select count(*) from profiles where id = p_uid and created_at < '2027-01-01')),
    ('spooky_oct',      (select count(*) from k where extract(month from d) = 10
                           and ('spooky' = any(vibes) or txt ~ 'halloween|haunt|spooky|muertos'))),
    ('festive_dec',     (select count(*) from k where extract(month from d) = 12
                           and ('festive' = any(vibes) or txt ~ 'holiday|christmas|hanukkah|chanukah|kwanzaa|tree lighting'))),
    ('summer_nights',   (select count(*) from k where extract(month from d) in (6, 7, 8) and t0 >= '18:00')),
    ('week_categories', (select max(n) from (select count(distinct cat) n from k group by wk) x)),
    ('comeback',        (select count(*) from gaps where gap >= 60))
  ) as x(m, p)
$$;
revoke execute on function public.achievement_progress(uuid) from public, anon, authenticated;

-- The signed-in person's achievements: saves anything newly earned, then returns the catalogue with progress.
-- is_new marks ones earned by this call, so the app can celebrate them once.
create or replace function public.my_achievements()
returns table (key text, section text, name text, title text, blurb text, goal int, hidden boolean,
               progress int, earned_at timestamptz, is_new boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare uid uuid := auth.uid(); started timestamptz := clock_timestamp();
begin
  if uid is null then raise exception 'Sign in to see your achievements.'; end if;
  insert into user_achievements (user_id, key, earned_at)
  select uid, a.key, clock_timestamp() from achievements a join achievement_progress(uid) p on p.metric = a.metric
  where a.active and p.progress >= a.goal
  on conflict do nothing;
  return query
    select a.key, a.section, a.name, a.title, a.blurb, a.goal, a.hidden,
           least(coalesce(p.progress, 0), a.goal), u.earned_at, coalesce(u.earned_at >= started, false)
    from achievements a
    left join achievement_progress(uid) p on p.metric = a.metric
    left join user_achievements u on u.user_id = uid and u.key = a.key
    where a.active or u.key is not null
    order by a.sort;
end $$;
revoke execute on function public.my_achievements() from public, anon;
grant execute on function public.my_achievements() to authenticated;

-- the leaderboard, now with each person's title (the return type changed, so it's dropped and made again)
drop function if exists public.leaderboard_top(text, int);
create function public.leaderboard_top(p_board text, p_limit int default 5)
returns table (display_name text, points int, is_me boolean, title text)
language sql stable security definer set search_path = public as $$
  select l.display_name, l.points, l.user_id = auth.uid(), a.title
  from leaderboard_month l
  left join profiles p on p.id = l.user_id
  left join achievements a on a.key = p.title_key
  where l.neighborhood = p_board
  order by l.points desc
  limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;
revoke execute on function public.leaderboard_top(text, int) from public;
grant execute on function public.leaderboard_top(text, int) to anon, authenticated;

comment on table public.achievements is '[Team] The achievement catalogue. Edit name, title, blurb, goal, hidden or active here; the app picks it up.';
comment on table public.user_achievements is '[App users] Achievements each person has earned. Written only by my_achievements().';
comment on column public.profiles.title_key is 'The achievement whose title the person shows after their name. Must be one they earned.';
comment on function public.achievement_progress(uuid) is '[Internal] One person''s progress on every achievement metric, from verified check-ins.';
comment on function public.my_achievements() is '[App users] The signed-in person''s achievements and progress; saves newly earned ones.';
comment on function public.leaderboard_top(text, int) is '[App users] A neighborhood''s monthly top list with titles, without user ids.';
