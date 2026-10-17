-- Comuna: one-time cleanup of duplicate events (run 2026-10-17; already applied).
-- Each pair was the same event listed twice, once from the original sheet and once by the web ingest.
-- The copy with less detail was set to 'Past / archived' (hidden from the app, not deleted) and logged
-- in ingest.dedupe_log with the copy that was kept and its old status.

create table if not exists ingest.dedupe_log (event_id text primary key, kept_event_id text not null, old_status text, archived_at timestamptz not null default now());

with p(keep, drop) as (values
  ('EVT-0117','EVT-1359'),  -- Wellness & Waves (Santa Monica Pier)
  ('EVT-0168','EVT-1332'),  -- A Walk Through Pier History
  ('EVT-0237','EVT-1717'),  -- A Talk Through Pier History
  ('EVT-0122','EVT-1337'),  -- Locals' Night (Santa Monica Pier)
  ('EVT-0126','EVT-1340'),  -- Día de los Muertos (Santa Monica Pier)
  ('EVT-0244','EVT-1331'),  -- Holiday Cheer on the Pier
  ('EVT-0039','EVT-0038'),  -- Día de los Muertos (Grand Park)
  ('EVT-0071','EVT-1276'),  -- Hollywood Christmas Parade
  ('EVT-0060','EVT-1327'),  -- Jessica Fichot Holiday Concert
  ('EVT-0242','EVT-1355'),  -- Lise Davidsen Holiday Concert
  ('EVT-0153','EVT-1360'),  -- Gronk: X Reason
  ('EVT-0231','EVT-1328'),  -- Santa Monica Auctions Fall Auction
  ('EVT-0084','EVT-1522'),  -- Griffith Observatory Public Star Party
  ('EVT-1339','EVT-1803'),  -- Leslie Sacks Gallery: Wayne Thiebaud
  ('EVT-1353','EVT-1799')), -- Leslie Sacks Gallery: Female Focus
logged as (insert into ingest.dedupe_log (event_id, kept_event_id, old_status)
  select e.event_id, p.keep, e.status from public.events e join p on p.drop = e.event_id where e.status <> 'Past / archived'
  on conflict (event_id) do nothing returning event_id)
update public.events e set status = 'Past / archived' from p where e.event_id = p.drop and e.status <> 'Past / archived';

-- To undo (all of it, or add "and event_id = 'EVT-…'" for one):
--   update public.events e set status = l.old_status from ingest.dedupe_log l where l.event_id = e.event_id;
