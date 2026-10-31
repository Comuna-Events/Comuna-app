-- Comuna: "8 checked in this month" on each event, so people can see others really go.
-- Run once in Supabase > SQL Editor; safe to re-run. The app works before and after: until this exists,
-- it shows only the "N RSVP'd" counts from going_counts().
--
-- Counts people, not visits: someone who checks in to a weekly event four times this month is one person.
-- Only verified check-ins count (distance_m is null for stamps the database couldn't verify), over the last
-- 30 days. Returns only event ids and totals: no user ids, names or locations reach the phone.

create or replace function public.checkin_counts()
returns table (event_id text, checked_in int)
language sql stable security definer set search_path = public as $$
  select event_id, count(distinct user_id)::int
  from checkins
  where distance_m is not null
    and checkin_date >= (now() at time zone 'America/Los_Angeles')::date - 30
  group by event_id
$$;

-- Supabase grants new functions to anon and authenticated directly, so revoke from them as well as public
revoke execute on function public.checkin_counts() from public, anon, authenticated;
grant execute on function public.checkin_counts() to anon, authenticated;

comment on function public.checkin_counts() is
'[App users] How many people made a verified check-in at each event in the last 30 days. Totals only, no user ids.';
