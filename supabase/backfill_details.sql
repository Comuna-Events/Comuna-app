-- Comuna: fill in the price amount, photo and end time on events added before the nightly ingest saved them.
-- Run once in Supabase > SQL Editor; safe to re-run. Then deploy supabase/functions/backfill-details and call it
-- until it reports nothing left:  select ingest.run('backfill-details');  (each call does ~40 events)
--
-- Each event is read once (details_checked_at), so calling it again only picks up events not looked at yet.
-- To have one looked at again, clear its details_checked_at. Without the Claude key, events that need it are
-- flagged (details_ai_pending) and read again by the first run that has the key.

alter table public.events add column if not exists details_checked_at timestamptz;
alter table public.events add column if not exists details_ai_pending boolean not null default false;
comment on column public.events.details_checked_at is
'When backfill-details last read this event''s page for its price amount, photo and end time. Not readable from the app.';
comment on column public.events.details_ai_pending is
'backfill-details read the page without an ANTHROPIC_API_KEY and still needs Claude for the price or end time.';

-- The next events to look at: upcoming, with a web page we can read (Instagram / TikTok / Facebook block it),
-- and missing a price amount (unless free), a usable photo or an end time. shared_page: the page lists other
-- events too, so its photo isn't this event's and the AI is asked about this event by name.
drop function if exists ingest.details_todo(int);
create or replace function ingest.details_todo(p_limit int default 40, p_with_ai boolean default true)
returns table (event_id text, name text, venue text, start_date date, start_time time, end_time time,
               price_type text, price_detail text, image_url text, source_url text, shared_page boolean)
language sql stable set search_path = '' as $$
  select e.event_id, e.name, e.venue, e.start_date, e.start_time, e.end_time, e.price_type, e.price_detail,
    e.image_url, e.source_url,
    exists (select 1 from public.events o where o.source_url = e.source_url and o.event_id <> e.event_id)
  from public.events e
  where (e.details_checked_at is null or (p_with_ai and e.details_ai_pending))
    and e.source_url ~ '^https?://'
    and e.source_url !~* '^https?://([a-z0-9-]+\.)?(instagram|tiktok|facebook)\.com/'
    and coalesce(e.end_date, e.start_date, current_date) >= current_date
    and coalesce(e.status, '') !~* 'cancel|past|archiv'
    and ((e.price_type is distinct from 'Free' and e.price_detail is null)
         or e.image_url is null or e.image_url !~ '^https?://'
         or (e.end_time is null and e.start_time is not null))
  order by e.start_date nulls last, e.event_id
  limit least(greatest(coalesce(p_limit, 40), 1), 200)
$$;
revoke execute on function ingest.details_todo(int, boolean) from public, anon, authenticated;
grant execute on function ingest.details_todo(int, boolean) to service_role;
