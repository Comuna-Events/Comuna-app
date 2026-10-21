-- Save one occurrence, not a subscription to every date in a recurring series.
-- Existing saves retain their user, event, creation time, kind, board and points.
alter table public.rsvps add column occurrence_date date;

-- Legacy saves did not record a selected day. Infer the first unfinished
-- occurrence on/after their creation time, using the app's recurrence rules.
update public.rsvps r set occurrence_date=coalesce((
  select min(day::date)
  from public.events e
  cross join lateral generate_series(
    greatest(e.start_date,(r.created_at at time zone 'America/Los_Angeles')::date - 1)::timestamp,
    least(coalesce(e.end_date,'infinity'::date), greatest(e.start_date,(r.created_at at time zone 'America/Los_Angeles')::date)+interval '367 days'),
    interval '1 day') day
  where e.event_id=r.event_id
    and day::date>=e.start_date
    and not (lower(e.recurrence) like '%one-off%' and e.end_time<=e.start_time
      and coalesce(e.end_date,e.start_date)<=e.start_date+1 and day::date<>e.start_date)
    and (day::date >= (r.created_at at time zone 'America/Los_Angeles')::date
      or (e.start_time is not null and e.end_time<=e.start_time))
    and (case
      when lower(e.recurrence) like '%daily%' then true
      when lower(e.recurrence) like '%biweekly%' then (day::date-e.start_date)%14=0
      when lower(e.recurrence) like '%weekly%' then (day::date-e.start_date)%7=0
      when lower(e.recurrence) like '%monthly%' then extract(dow from day)=extract(dow from e.start_date)
        and ceil(extract(day from day)/7)=ceil(extract(day from e.start_date)/7)
      else e.end_date is not null or day::date=e.start_date end)
    and (e.end_time is null or day::date+e.end_time+
      case when e.end_time<=e.start_time then interval '1 day' else interval '0 day' end
      > r.created_at at time zone 'America/Los_Angeles')
), (select start_date from public.events e where e.event_id=r.event_id),
   (r.created_at at time zone 'America/Los_Angeles')::date);

alter table public.rsvps alter column occurrence_date set not null;
-- Compatibility fallback for an older app still open during deployment.
alter table public.rsvps alter column occurrence_date set default ((now() at time zone 'America/Los_Angeles')::date);
alter table public.rsvps drop constraint rsvps_pkey;
alter table public.rsvps add primary key (user_id,event_id,occurrence_date);

-- One person saving two dates is still one interested person in the series total.
create or replace view public.event_going as
select event_id,count(distinct user_id)::integer as going
from public.rsvps group by event_id;

comment on column public.rsvps.occurrence_date is
'The specific local event day selected by the user. Legacy records were inferred once from creation time; this is not a recurring-series subscription.';
