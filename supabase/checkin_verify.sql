-- Comuna: check-ins are verified by the database, not the phone.
-- The app sends where the phone is; Supabase looks up the event's own location and schedule,
-- measures the distance itself, and saves at most one check-in per person, event and day.
-- Run in two steps (Supabase > SQL Editor). Both are safe to re-run.

-- ============ Step 1: run any time (additive; the current app keeps working) ============

-- the Los Angeles day the person was there; one check-in per person, event and day
alter table public.checkins add column if not exists checkin_date date;
update public.checkins set checkin_date = (created_at at time zone 'America/Los_Angeles')::date where checkin_date is null;
alter table public.checkins alter column checkin_date set default ((now() at time zone 'America/Los_Angeles')::date);
alter table public.checkins alter column checkin_date set not null;
create unique index if not exists checkins_one_per_day on public.checkins (user_id, event_id, checkin_date);

-- Does an event happen on this day? Same rules as occursOn() in index.html.
create or replace function public.event_occurs_on(rec text, start_day date, end_day date, detail text, d date)
returns boolean language sql immutable set search_path = public as $$
  select case
    when start_day is null then   -- no start date: "Every Thursday"-style weekly events land on that weekday
      lower(coalesce(rec,'')) ~ '(weekly|daily)' and (lower(rec) like '%daily%' or lower(coalesce(detail,'')) like
        '%' || (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[extract(dow from d)::int + 1] || '%')
    when d < start_day or (end_day is not null and d > end_day) then false
    when lower(coalesce(rec,'')) like '%daily%' then true
    when lower(coalesce(rec,'')) like '%biweekly%' then (d - start_day) % 14 = 0
    when lower(coalesce(rec,'')) like '%weekly%' then (d - start_day) % 7 = 0
    when lower(coalesce(rec,'')) like '%monthly%' then extract(dow from d) = extract(dow from start_day)
      and ceil(extract(day from d) / 7) = ceil(extract(day from start_day) / 7)
    else end_day is not null or d = start_day   -- one-off or seasonal: its date, or every day of its run
  end
$$;

-- The only way to check in. Errors are friendly sentences the app shows as-is.
-- p_at: when a guest checked in, for check-ins saved on the phone before they made an account.
-- Unverified stamps (distance_m null) show on the passport but earn no points: the leaderboard only counts verified visits.
-- A guest's stamp becomes one when it can't be checked: saved before check-ins kept a location (no location, no p_at),
-- or more than 7 days old, too late to trust. Points can't be backdated either way.
create or replace function public.check_in(p_event_id text, p_lat double precision, p_lng double precision,
  p_accuracy double precision default null, p_at timestamptz default null)
returns table (distance_m int, checkin_date date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  at_ts timestamptz := coalesce(p_at, now());
  visit_day date := (coalesce(p_at, now()) at time zone 'America/Los_Angeles')::date;
  e record;
  dist int;
  unverified boolean := (p_lat is null and p_lng is null and p_at is null) or coalesce(p_at < now() - interval '7 days', false);
begin
  if uid is null then raise exception 'Sign in to check in.'; end if;
  if at_ts > now() + interval '5 minutes' then raise exception 'That check-in time isn''t valid.'; end if;
  if not unverified and (p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180) then
    raise exception 'Turn on location for Comuna to check in. It''s only used to confirm you''re there.'; end if;

  if p_event_id ~ '^SUB-\d+$' then   -- an approved event shared by a neighbor
    select s.title as name, s.venue, null::text as neighborhood, s.category, s.lat, s.lng, s.event_date as start_date,
           null::date as end_date, case when s.recurrence = 'One-time' then 'One-off' else s.recurrence end as recurrence,
           null::text as recurrence_detail, s.status
      into e from event_submissions s where s.id = substring(p_event_id from 5)::bigint and s.status = 'approved';
  else
    select ev.name, ev.venue, ev.neighborhood, ev.category, ev.lat, ev.lng, ev.start_date, ev.end_date,
           ev.recurrence, ev.recurrence_detail, ev.status
      into e from events ev where ev.event_id = p_event_id;
  end if;
  if not found or coalesce(e.status,'') ~* '(cancel|past|archiv)' then raise exception 'We couldn''t find this event.'; end if;
  if not unverified then
    if e.lat is null or e.lng is null then raise exception 'We can''t find this event on the map, so check-in isn''t available.'; end if;
    if not event_occurs_on(e.recurrence, e.start_date, e.end_date, e.recurrence_detail, visit_day) then
      raise exception 'This event isn''t happening today, so check-in isn''t open.'; end if;

    -- same rule as the app: within 400 m, allowing up to 200 m of fuzzy GPS
    dist := round(2 * 6371000 * asin(sqrt(
      sin(radians(e.lat - p_lat) / 2) ^ 2 + cos(radians(p_lat)) * cos(radians(e.lat)) * sin(radians(e.lng - p_lng) / 2) ^ 2)));
    if dist - least(greatest(coalesce(p_accuracy, 0), 0), 200) > 400 then
      raise exception 'Looks like you''re about % mi away. Check in once you''re at %.', round(dist / 1609.0, 1), coalesce(e.venue, 'the event'); end if;
  end if;

  insert into checkins (user_id, event_id, event_title, venue, neighborhood, category, distance_m, checkin_date)
  values (uid, p_event_id, e.name, e.venue, e.neighborhood, e.category, dist, visit_day)
  on conflict (user_id, event_id, checkin_date) do nothing;
  if not found then raise exception 'You''ve already checked in here today.'; end if;
  return query select dist, visit_day;
end $$;

revoke execute on function public.check_in(text, double precision, double precision, double precision, timestamptz) from public, anon;
grant execute on function public.check_in(text, double precision, double precision, double precision, timestamptz) to authenticated;

comment on function public.check_in(text, double precision, double precision, double precision, timestamptz) is
'[App users] Verified check-in: the database measures the distance to the event and checks its schedule. One per person, event and day.';
comment on column public.checkins.checkin_date is 'The Los Angeles day of the visit. One check-in per person, event and day.';

-- ============ Step 2: run once the app that calls check_in() is live ============
-- People can read their own check-ins but no longer write them directly, so distances and dates can't be made up.

revoke insert, update, delete, truncate on public.checkins from anon, authenticated;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'checkins' loop
    execute format('drop policy %I on public.checkins', p.policyname);
  end loop;
end $$;
create policy "checkins_read_own" on public.checkins for select to authenticated using (auth.uid() = user_id);
