-- Comuna: "Just dropped" in today's picks: events added to Comuna in the last two days.
-- Run once in Supabase > SQL Editor; safe to re-run. The app works before and after: until this runs it reads
-- events without created_at and never shows "Just dropped".
--
-- created_at is when the row was added to events (the nightly import's promote, or by hand in Table Editor).
-- It says nothing about who added it; added_by, date_added and notes stay private.

-- events are readable column by column (events.sql); add this one
grant select (created_at) on public.events to anon, authenticated;
