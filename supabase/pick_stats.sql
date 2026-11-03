-- Comuna: how today's picks ("Tonight in <neighborhood>") are doing, by the reason each pick was shown for.
-- Run in Supabase > SQL Editor after event_actions.sql, search.sql and guests.sql; safe to re-run.
-- The app works before and after: until this runs, it sends its usual views and taps and leaves the pick rows out.
--
-- What the app records (in event_actions, like every other view and tap):
--   pick_shown  each pick on the card when it's shown, with its reason (Last chance, Just dropped, New stamp for you...),
--               its slot (1-4) and the mood button that was on (null = Anything)
--   pick_nope   "Not for me" on a pick
--   view, rsvp, directions... from the card: placement = 'picks', and the pick's reason in pick_reason
-- Check-ins happen later, from anywhere, so pick_stats counts a check-in for a pick when the same person checks in to
-- that event within 7 days of it being shown.
--
-- Read the results in Table Editor > pick_stats (last 30 days, one row per reason) and pick_days (one row per day).

alter table public.event_actions add column if not exists pick_reason text;
alter table public.event_actions add column if not exists pick_slot   smallint;
alter table public.event_actions add column if not exists pick_mood   text;

alter table public.event_actions drop constraint if exists event_actions_action_check;
alter table public.event_actions add constraint event_actions_action_check check (action in
  ('view','interested','rsvp','directions','calendar','link','invite','checkin','pick_shown','pick_nope'));

comment on column public.event_actions.pick_reason is 'Today''s picks: why the event was picked (Last chance, Just dropped, New stamp for you, Worth the drive...). Set on pick_shown, pick_nope and on taps from the card.';
comment on column public.event_actions.pick_slot   is 'Today''s picks: its place on the card, 1 to 4.';
comment on column public.event_actions.pick_mood   is 'Today''s picks: the mood button that was on (chill, social, late, cheap); empty for Anything.';

create index if not exists event_actions_picks_idx on public.event_actions (action, created_at) where action in ('pick_shown','pick_nope');

-- One row per person, event and reason: the first time it was shown in the last 30 days, and what happened next.
create or replace view public.pick_outcomes with (security_invoker = true) as
with shown as (
  select coalesce(device_id::text, user_id::text) as who, event_id, pick_reason,
         min(created_at) as shown_at, max(event_title) as event_title
  from public.event_actions
  where action = 'pick_shown' and created_at > now() - interval '30 days'
  group by 1, 2, 3
), acts as (
  select coalesce(device_id::text, user_id::text) as who, event_id, action, placement, created_at
  from public.event_actions
  where created_at > now() - interval '37 days'
)
select s.who, s.event_id, s.event_title, s.pick_reason, s.shown_at,
  exists (select 1 from acts a where a.who = s.who and a.event_id = s.event_id and a.action = 'view'
          and a.placement = 'picks' and a.created_at >= s.shown_at)                                 as tapped,
  exists (select 1 from acts a where a.who = s.who and a.event_id = s.event_id and a.action = 'pick_nope'
          and a.created_at >= s.shown_at)                                                           as noped,
  exists (select 1 from acts a where a.who = s.who and a.event_id = s.event_id and a.action in ('rsvp','interested')
          and a.created_at between s.shown_at and s.shown_at + interval '7 days')                   as saved,
  exists (select 1 from acts a where a.who = s.who and a.event_id = s.event_id and a.action = 'checkin'
          and a.created_at between s.shown_at and s.shown_at + interval '7 days')                   as checked_in
from shown s;

-- Per reason, last 30 days: how often each kind of pick gets tapped, dismissed, saved and gone to.
create or replace view public.pick_stats with (security_invoker = true) as
select pick_reason,
       count(*)                                              as shown,
       count(distinct who)                                   as people,
       count(*) filter (where tapped)                        as tapped,
       round(100.0 * count(*) filter (where tapped) / nullif(count(*), 0), 1)     as tap_pct,
       count(*) filter (where noped)                         as not_for_me,
       round(100.0 * count(*) filter (where noped) / nullif(count(*), 0), 1)      as not_for_me_pct,
       count(*) filter (where saved)                         as saved,
       count(*) filter (where checked_in)                    as checked_in,
       round(100.0 * count(*) filter (where checked_in) / nullif(count(*), 0), 1) as checkin_pct
from public.pick_outcomes
group by pick_reason
order by shown desc;

-- Per day (Los Angeles time): how many people saw the card and what they did with it.
create or replace view public.pick_days with (security_invoker = true) as
select (shown_at at time zone 'America/Los_Angeles')::date as day,
       count(distinct who)                                  as people,
       count(*)                                             as picks_shown,
       count(*) filter (where tapped)                       as tapped,
       count(*) filter (where noped)                        as not_for_me,
       count(*) filter (where saved)                        as saved,
       count(*) filter (where checked_in)                   as checked_in
from public.pick_outcomes
group by 1
order by 1 desc;

-- dashboard only, like event_stats: nobody can read these from the app
revoke all on public.pick_outcomes, public.pick_stats, public.pick_days from anon, authenticated;

comment on view public.pick_outcomes is '[App users] Today''s picks, one row per person, event and reason shown in the last 30 days: tapped, Not for me, saved, checked in within 7 days.';
comment on view public.pick_stats    is '[App users] Today''s picks by reason, last 30 days: shown, tapped, Not for me, saved, checked in (and the % of each).';
comment on view public.pick_days     is '[App users] Today''s picks by day: people who saw the card, picks shown, tapped, Not for me, saved, checked in.';
