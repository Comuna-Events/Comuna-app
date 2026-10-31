-- Comuna: event reminders on the iPhone app ("starts in an hour"). Run once in Supabase > SQL Editor; safe to re-run.
--
-- How it works: the iPhone app asks to send notifications after someone saves their first plan, and saves the
-- phone's push token with save_push_token(). Every 10 minutes the send-reminders Edge Function (scheduled below)
-- reads due_push_reminders(), sends each one through Apple's push service and records it in push_reminders_sent,
-- so nobody gets the same reminder twice.
--
-- The schedule at the bottom only does anything once the APNS_* secrets are set (see
-- supabase/functions/send-reminders/index.ts); until then each call returns "not configured".

-- one row per phone; a phone that signs in to another account moves to that account
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null default 'ios' check (platform in ('ios')),
  -- Apple has two push services: 'sandbox' for builds run from Xcode, 'production' for TestFlight and the
  -- App Store. Null until the first send works out which one the token belongs to.
  environment text check (environment in ('sandbox', 'production')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_id on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- no policies: the app goes through the two functions below, and only they and the Edge Function touch the table
revoke all on public.push_tokens from anon, authenticated;

create or replace function public.save_push_token(p_token text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to get reminders.'; end if;
  if p_token !~ '^[0-9a-f]{64,200}$' then raise exception 'Not an iPhone push token.'; end if;
  insert into push_tokens (token, user_id) values (p_token, auth.uid())
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now(),
    environment = case when push_tokens.user_id = excluded.user_id then push_tokens.environment end;
end $$;

-- signing out stops this phone's reminders for that account
create or replace function public.forget_push_token(p_token text)
returns void
language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.save_push_token(text), public.forget_push_token(text) from public, anon;
grant execute on function public.save_push_token(text), public.forget_push_token(text) to authenticated;

create table if not exists public.push_reminders_sent (
  user_id         uuid not null references auth.users (id) on delete cascade,
  event_id        text not null,
  occurrence_date date not null,
  sent_at         timestamptz not null default now(),
  primary key (user_id, event_id, occurrence_date)
);
alter table public.push_reminders_sent enable row level security;
revoke all on public.push_reminders_sent from anon, authenticated;

-- Plans starting 30 to 60 minutes from now, one row per phone, skipping events the person has already checked in to,
-- events with no start time, and archived ones. The 30-minute margin means a late or missed run still sends.
create or replace function public.due_push_reminders()
returns table (user_id uuid, event_id text, occurrence_date date, title text, venue text, starts_at timestamptz,
               token text, environment text)
language sql stable security definer set search_path = public as $$
  select r.user_id, r.event_id, r.occurrence_date, e.name, e.venue,
         (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles', t.token, t.environment
  from rsvps r
  join events e on e.event_id = r.event_id
  join push_tokens t on t.user_id = r.user_id
  where e.start_time is not null
    and e.status is distinct from 'Past / archived'
    and (r.occurrence_date + e.start_time) at time zone 'America/Los_Angeles'
        between now() + interval '30 minutes' and now() + interval '60 minutes'
    and not exists (select 1 from push_reminders_sent s
                    where s.user_id = r.user_id and s.event_id = r.event_id and s.occurrence_date = r.occurrence_date)
    and not exists (select 1 from checkins c
                    where c.user_id = r.user_id and c.event_id = r.event_id and c.checkin_date = r.occurrence_date);
$$;
revoke execute on function public.due_push_reminders() from public, anon, authenticated;

comment on table public.push_tokens is
'[App users] One row per iPhone that allowed notifications, linked to the account signed in on it.';
comment on table public.push_reminders_sent is
'[Team] Reminders already sent, so each plan gets one. Written by the send-reminders Edge Function.';
comment on function public.due_push_reminders() is
'[Team] Plans starting in 30-60 minutes that still need a reminder, one row per phone. Read by send-reminders.';

-- Every 10 minutes, call send-reminders. It uses the same Vault secret as the nightly ingest
-- (ingest_schedule.sql), sent as the x-ingest-secret header.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('push-reminders', '*/10 * * * *', $cron$
  select net.http_post(
    url     := 'https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('content-type', 'application/json', 'x-ingest-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
-- To pause reminders: select cron.unschedule('push-reminders');
