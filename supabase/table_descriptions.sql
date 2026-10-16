-- Comuna: a one-line description on every table, shown in Supabase > Database > Tables.
-- Run in Supabase > SQL Editor after event_ingest.sql; safe to re-run. Add a line here for any new table.
--
--   [App users]  written by the app as people use it. Read it, don't hand-edit it.
--   [We manage]  we fill it in; the app reads it.
--   [Internal]   only us and the nightly job; the app can't see it. Lives in the "ingest" schema.

-- [App users]
comment on table  public.profiles          is '[App users] One row per signed-up person: name, home neighborhood, interests, points.';
comment on table  public.rsvps             is '[App users] Interested / RSVP taps, one per person per event.';
comment on table  public.checkins          is '[App users] Check-ins at events, with how far the phone was from the venue (distance_m).';
comment on table  public.feedback          is '[App users] Feedback and event ratings sent from the app.';
comment on table  public.event_submissions  is '[App users] Events people suggested in the app. Review them: change status from pending to approved or rejected.';
comment on table  public.event_actions     is '[App users] Every view and tap on an event (directions, calendar, link, invite...). Raw log for event_stats.';
comment on view   public.event_going       is '[App users] How many people are going to each event (counted from rsvps). The app reads this.';
comment on view   public.event_stats       is '[App users] Per-event totals built from event_actions: views, saves, clicks, check-ins.';
comment on view   public.leaderboard_month is '[App users] This month''s points per person, built from rsvps, checkins, feedback and submissions.';

-- [We manage]
comment on table  public.events            is '[We manage] The event inventory the app shows. Add and edit here; nightly finds arrive via ingest.promote_candidate.';

-- [Internal]
comment on schema ingest                   is '[Internal] Nightly event ingest. The app cannot read or write anything in this schema.';
comment on table  ingest.event_sources     is '[Internal] Accounts, pages and calendars the 3am job checks. Add a row to start watching one; set active = false to pause it.';
comment on table  ingest.event_candidates  is '[Internal] Events the nightly job found. Review status = new, then select ingest.promote_candidate(id) to copy one into events.';
comment on table  ingest.ingest_runs       is '[Internal] One row per platform per night: how many sources and posts it checked, what it found, and any errors.';
