-- Comuna: move nightly-ingest candidates into the app on their own (run once in Supabase > SQL Editor after
-- event_ingest.sql, ingest_schedule.sql and geocode.sql; safe to re-run).
--
-- Every night after the ingest, ingest.auto_promote() looks at the new rows in ingest.event_candidates and
-- promotes the ones that are clearly fine: an upcoming in-person event the AI is confident about, with a street
-- address (filled in from the venue's other events when the post only names the venue), and not the same event
-- as one already in the app. Everything else stays 'new' for a person to look at, and is looked at again the
-- next night (e.g. an event more than 60 days out gets its turn later). Duplicates are marked 'duplicate'
-- with a note naming the event they match.
--
-- Try it without changing anything:   select ingest.auto_promote(true);
-- Run it now:                          select ingest.auto_promote();
-- Undo one event: delete it from public.events, and set its candidate back to status 'new' (or 'rejected').
-- Everything it promoted has added_by = 'nightly ingest' and notes 'From event_candidates #<id>'.

create extension if not exists pg_trgm with schema extensions;

-- "The Roxy Theatre" -> "roxy theatre": for comparing names and venues
create or replace function ingest.norm(t text) returns text
language sql immutable set search_path = '' as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(t, '')), '^\s*the\s+', ''), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Same place: a similar venue name, the same street address (number + street), or the same zip.
create or replace function ingest.same_place(v1 text, a1 text, z1 text, v2 text, a2 text, z2 text) returns boolean
language sql immutable set search_path = '' as $$
  select (ingest.norm(v1) <> '' and extensions.similarity(ingest.norm(v1), ingest.norm(v2)) >= 0.5)
      or (substring(ingest.norm(a1) from '^\d+ \w+') = substring(ingest.norm(a2) from '^\d+ \w+'))
      or (z1 is not null and z1 = z2)
$$;

-- Two listings of one event: a similar name at the same place, one name starting with the other at the same place
-- ("MICO" / "MICO: Running From A Feeling Tour"), or a near-identical name where nothing says the places differ.
-- Listings that both give a start time more than 30 minutes apart are different events (two "Story Time"s at
-- one library, a 7pm and a 10pm show); so are two "Story Time"s at different library branches.
create or replace function ingest.same_event(n1 text, v1 text, a1 text, z1 text, t1 time,
                                             n2 text, v2 text, a2 text, z2 text, t2 time)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case
    when abs(extract(epoch from t1 - t2)) > 1800 then false
    when extensions.similarity(ingest.norm(n1), ingest.norm(n2)) >= 0.75
      then ingest.same_place(v1, a1, z1, v2, a2, z2)
        or ingest.norm(v1) = '' or ingest.norm(v2) = ''
        or extensions.similarity(ingest.norm(v1), ingest.norm(v2)) >= 0.3
    when extensions.similarity(ingest.norm(n1), ingest.norm(n2)) >= 0.5
      or (least(length(ingest.norm(n1)), length(ingest.norm(n2))) >= 4
          and (ingest.norm(n1) like ingest.norm(n2) || ' %' or ingest.norm(n2) like ingest.norm(n1) || ' %'))
      then ingest.same_place(v1, a1, z1, v2, a2, z2)
    else false end, false)
$$;

drop function if exists ingest.same_event(text, text, text, text, text, text, text, text);

-- What the AI flags in its notes (or the listing says) that makes an event not for the app as is.
create or replace function ingest.red_flag(c ingest.event_candidates) returns text
language sql stable set search_path = '' as $$
  select substring(concat_ws(' | ', c.name, c.description, c.ai_notes) from
    '(?i)(members[- ]only|online[- ]only|virtual|livestream|webinar|zoom|private (?:event|tour|party)|school[- ]only|students only|staff only|invitation only|invite only|sold out|cancel+ed|postponed)')
$$;

create or replace function ingest.auto_promote(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today   date := (now() at time zone 'America/Los_Angeles')::date;
  c       ingest.event_candidates;
  hit     text;
  stats   jsonb := '{}';
  filled  int := 0;
  bump    text;
begin
  -- 1. A post that names the venue but not its address: take the address from the same venue's other events,
  --    in the app or among the candidates, or from the address noted on the source itself. Only near-identical
  --    names ("Hollywood Improv - The Lab" -> "Hollywood Improv"), and never across different cities.
  create temp table _addr on commit drop as
  with known as (
    select ingest.norm(venue) v, street_address, city, zip from public.events
     where venue is not null and street_address ~ '^\s*\d'
    union all
    select ingest.norm(venue), street_address, city, zip from ingest.event_candidates
     where venue is not null and street_address ~ '^\s*\d'
    union all
    select ingest.norm(regexp_replace(display_name, '\s+[–-]\s.*$', '')), substring(notes from '^\s*(\d[^;]+)'), null, null
      from ingest.event_sources where notes ~ '^\s*\d'
  ), counted as (
    select v, street_address, city, zip, count(*) n from known where v <> '' group by 1, 2, 3, 4
  )
  select distinct on (m.id) m.id, k.street_address, coalesce(m.city, k.city) city, coalesce(m.zip, k.zip) zip
    from ingest.event_candidates m
    join counted k on extensions.similarity(ingest.norm(m.venue), k.v) >= 0.8
                   or (length(k.v) >= 8 and ingest.norm(m.venue) like k.v || ' %')
   where m.status = 'new' and m.street_address is null and ingest.norm(m.venue) <> ''
     and (m.city is null or k.city is null or lower(m.city) = lower(k.city))
   order by m.id, extensions.similarity(ingest.norm(m.venue), k.v) desc, k.n desc;

  if p_dry_run then
    select count(*) into filled from _addr;
  else
    update ingest.event_candidates e set street_address = a.street_address, city = a.city, zip = a.zip
      from _addr a where e.id = a.id;
    get diagnostics filled = row_count;
  end if;

  -- 2. Go through the new candidates, best listing of an event first: the venue's own site before aggregators
  --    (Patch, tourism and news calendars), then the one with a time, the most detail and the most confidence.
  --    The first listing of an event is promoted; later ones match it (or an event already in the app) and are
  --    marked duplicate.
  create temp table _accepted (event_id text, name text, venue text, street_address text, zip text,
    start_time time, start_date date, end_date date, recurring boolean) on commit drop;
  insert into _accepted
    select event_id, name, venue, street_address, zip, start_time, start_date, end_date,
           coalesce(recurrence, 'One-off') <> 'One-off'
      from public.events where coalesce(status, '') !~* 'cancel';

  for c in
    select e.* from ingest.event_candidates e
      left join ingest.event_sources s on s.id = e.source_id
     where e.status = 'new'
     order by (coalesce(s.category, '') = 'general') , (e.start_time is null), e.confidence desc nulls last,
              length(coalesce(e.description, '')) desc, e.id
  loop
    if p_dry_run then   -- see the address step 1 would have filled in
      select coalesce(c.street_address, a.street_address), coalesce(c.city, a.city), coalesce(c.zip, a.zip)
        into c.street_address, c.city, c.zip from (select 1) x left join _addr a on a.id = c.id;
    end if;

    bump := case
      when c.name is null or c.start_date is null              then 'held: no name or date'
      when coalesce(c.end_date, case when coalesce(c.recurrence, 'One-off') = 'One-off' then c.start_date end) < today
                                                                then 'held: already over'
      when c.start_date > today + 60                            then 'held: more than 60 days out'
      when coalesce(c.confidence, 0) < 0.8                      then 'held: AI confidence under 0.8'
      when coalesce(c.street_address, '') !~ '^\s*\d'           then 'held: no street address'
      when c.zip is not null and c.zip !~ '^(90[0-9]|91[0-8]|935)' then 'held: outside LA County'
      when ingest.red_flag(c) is not null                       then 'held: ' || lower(ingest.red_flag(c))
    end;
    if bump is not null then
      stats := jsonb_set(stats, array[bump], to_jsonb(coalesce((stats ->> bump)::int, 0) + 1));
      continue;
    end if;

    select a.event_id into hit from _accepted a
     -- on overlapping dates: a show's run listed once vs. its single performances listed elsewhere
     where (a.start_date is not null and daterange(a.start_date, greatest(a.start_date, a.end_date), '[]')
              && daterange(c.start_date, greatest(c.start_date, c.end_date), '[]')
            or (a.recurring and coalesce(c.recurrence, 'One-off') <> 'One-off'))
       and ingest.same_event(c.name, c.venue, c.street_address, c.zip, c.start_time,
                             a.name, a.venue, a.street_address, a.zip, a.start_time)
     limit 1;
    if found then
      if not p_dry_run then
        update ingest.event_candidates set status = 'duplicate',
          review_note = 'Auto: same event as ' || coalesce(hit, 'one promoted in this run') where id = c.id;
      end if;
      stats := jsonb_set(stats, '{duplicate}', to_jsonb(coalesce((stats ->> 'duplicate')::int, 0) + 1));
      continue;
    end if;

    if p_dry_run then
      hit := null;
    else
      perform set_config('comuna.skip_geocode', 'on', true);   -- one geocode request at the end, not one per event
      hit := ingest.promote_candidate(c.id);
    end if;
    insert into _accepted values (hit, c.name, c.venue, c.street_address, c.zip, c.start_time, c.start_date, c.end_date,
                                  coalesce(c.recurrence, 'One-off') <> 'One-off');
    stats := jsonb_set(stats, '{promoted}', to_jsonb(coalesce((stats ->> 'promoted')::int, 0) + 1));
  end loop;

  -- 3. Events it promoted whose last date has passed leave the app (the app already hides past one-off events,
  --    but not repeating ones, e.g. an exhibition listed as daily until its closing date).
  if not p_dry_run then
    update public.events set status = 'Past / archived'
     where added_by = 'nightly ingest' and end_date < today and status not in ('Past / archived', 'Cancelled');
    get diagnostics filled = row_count;   -- reuse: count archived
    stats := stats || jsonb_build_object('archived', filled);
    perform set_config('comuna.skip_geocode', 'off', true);
    if (stats ->> 'promoted') is not null then perform public.request_event_geocode(); end if;
  end if;

  return stats || jsonb_build_object('dry_run', p_dry_run,
    'addresses_filled', (select count(*) from _addr));
end $$;
revoke execute on function ingest.auto_promote(boolean) from public, anon, authenticated;

-- Promoting hundreds of events in one go shouldn't fire a geocode request per insert (see geocode.sql).
create or replace function public.events_request_geocode() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('comuna.skip_geocode', true) is distinct from 'on' then
    perform public.request_event_geocode();
  end if;
  return null;
end $$;
revoke execute on function public.events_request_geocode() from public, anon, authenticated;

-- 12:10 UTC: after the last nightly ingest call (every 5 minutes from 10:00 to 11:55, see ingest_schedule.sql)
select cron.schedule('nightly-auto-promote', '10 12 * * *', 'select ingest.auto_promote()');

-- One geocode run only gets through a few dozen Census lookups, so after a big night look up the rest in a few
-- more passes (12:20-12:50 UTC), while any event added in the last day still has no pin.
select cron.schedule('nightly-geocode', '20-50/10 12 * * *',
  $$select public.request_event_geocode() where exists (select 1 from public.events where lat is null and street_address ~ '^\s*\d' and created_at > now() - interval '1 day')$$);
