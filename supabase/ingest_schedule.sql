-- Comuna: run the nightly event ingest automatically (run once in Supabase > SQL Editor after event_ingest.sql;
-- safe to re-run).
--
-- First, once: put the same value you saved as the INGEST_SECRET Edge Function secret into Vault, so the
-- database can call the ingest functions:
--   select vault.create_secret('<your INGEST_SECRET>', 'ingest_secret', 'x-ingest-secret header for the ingest-* functions');
-- (To change it later: select vault.update_secret(id, '<new value>') from vault.secrets where name = 'ingest_secret';)
--
-- Run it by hand any time (SQL Editor). It starts the run and returns right away; results show up in
-- ingest.ingest_runs and ingest.event_candidates within a couple of minutes:
--   select ingest.run();                     -- every active web source (ingest-web)
--   select ingest.run('ingest-web', 1);      -- just event_sources row 1
--   select ingest.run('ingest-instagram');   -- another platform's function, once it's deployed
--
-- When a new platform's function is deployed, add it to ingest.run_nightly() below and re-run this file.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function ingest.run(fn text default 'ingest-web', source_id bigint default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
begin
  if fn !~ '^ingest-[a-z0-9-]+$' then raise exception 'Not an ingest function: %', fn; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'ingest_secret';
  if secret is null then raise exception 'Store INGEST_SECRET in Vault first (see the top of ingest_schedule.sql)'; end if;

  return net.http_post(
    url     := 'https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/' || fn
               || coalesce('?source_id=' || source_id, ''),
    headers := jsonb_build_object('content-type', 'application/json', 'x-ingest-secret', secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000);
end $$;
revoke execute on function ingest.run(text, bigint) from public, anon, authenticated;

-- every platform's function, one call each
create or replace function ingest.run_nightly() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform ingest.run('ingest-web');
  perform ingest.run('ingest-vibes');   -- vibes for events added by hand (each event is read once)
end $$;
revoke execute on function ingest.run_nightly() from public, anon, authenticated;

-- Every 5 minutes from 10:00 to 11:55 UTC (3-5am in Los Angeles in summer, 2-4am in winter). One call only
-- gets through ~12 web sources before its 2-minute limit, and each call starts with the sources checked
-- longest ago, so 24 calls cover a couple of hundred. Raise the hours if ingest_runs shows sources left over.
select cron.schedule('nightly-event-ingest', '*/5 10-11 * * *', 'select ingest.run_nightly()');

-- Eventbrite, Luma and Meetup (ingest-eventbrite, ingest-luma, ingest-meetup) read sites that carry their events as
-- data, so they call no AI and a night costs nothing but page loads. They have a job of their own, so they keep running
-- while the AI-based job above is paused: every 10 minutes from 10:00 to 11:50 UTC, done before ingest.auto_promote()
-- at 12:10. Each call reads as many of that platform's sources as fit in its 2 minutes, oldest-checked first, so 12 calls
-- cover them several times over; events already read are skipped. Sources are rows in ingest.event_sources with
-- platform 'eventbrite', 'luma' or 'meetup' (see each function's comments for what a handle looks like).
select cron.unschedule('nightly-eventbrite-ingest') where exists (select 1 from cron.job where jobname = 'nightly-eventbrite-ingest');
select cron.schedule('nightly-structured-ingest', '*/10 10-11 * * *',
  $$select ingest.run('ingest-eventbrite'); select ingest.run('ingest-luma'); select ingest.run('ingest-meetup');$$);
