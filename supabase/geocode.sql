-- Comuna: fill in events.lat / lng from the address automatically (run once in Supabase > SQL Editor; safe to re-run).
-- Only the address ever needs typing. Whenever events are added or an address changes, the database calls the
-- geocode-events function (supabase/functions/geocode-events), which looks up every event missing coordinates.
-- Changing an address clears the old pin so it gets looked up again. To place a pin by hand, type lat/lng in
-- the same edit as the address (or after it); the lookup never overwrites coordinates that are already there.
-- Re-run everything missing coordinates:  select public.request_event_geocode();

create extension if not exists pg_net with schema extensions;

-- shared secret between the database and the function, kept in Vault
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'geocode_events_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                'geocode_events_secret', 'x-geocode-secret header for the geocode-events function');
  end if;
end $$;

-- the function reads the secret with the service role key; nobody else can
create or replace function public.geocode_events_secret() returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'geocode_events_secret'
$$;
revoke execute on function public.geocode_events_secret() from public, anon, authenticated;
grant execute on function public.geocode_events_secret() to service_role;

-- ask the function to look up everything missing coordinates (sent once the transaction commits)
create or replace function public.request_event_geocode() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url     := 'https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/geocode-events',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-geocode-secret', public.geocode_events_secret()),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000);
end $$;
revoke execute on function public.request_event_geocode() from public, anon, authenticated;

-- a new address means the old pin is wrong, unless lat/lng were changed in the same edit
create or replace function public.events_clear_coords() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.street_address, new.city, new.zip) is distinct from (old.street_address, old.city, old.zip)
     and (new.lat, new.lng) is not distinct from (old.lat, old.lng) then
    new.lat := null; new.lng := null;
  end if;
  return new;
end $$;
create or replace trigger events_clear_coords before update of street_address, city, zip on public.events
  for each row execute function public.events_clear_coords();

-- once per insert / address edit (not per row), so a bulk paste makes one call
create or replace function public.events_request_geocode() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.request_event_geocode();
  return null;
end $$;
revoke execute on function public.events_request_geocode() from public, anon, authenticated;
create or replace trigger events_request_geocode after insert or update of street_address, city, zip on public.events
  for each statement execute function public.events_request_geocode();
