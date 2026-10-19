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
end $$;
revoke execute on function ingest.run_nightly() from public, anon, authenticated;

-- Every 5 minutes from 10:00 to 11:55 UTC (3-5am in Los Angeles in summer, 2-4am in winter). One call only
-- gets through ~12 web sources before its 2-minute limit, and each call starts with the sources checked
-- longest ago, so 24 calls cover a couple of hundred. Raise the hours if ingest_runs shows sources left over.
-- Turned off Oct 2026: the Claude calls cost too much, so events are now audited by hand outside Supabase and
-- the ANTHROPIC_API_KEY secret was removed. To turn it back on, store the key again and uncomment this line.
-- select cron.schedule('nightly-event-ingest', '*/5 10-11 * * *', 'select ingest.run_nightly()');
