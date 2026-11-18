# Database files (supabase/*.sql)

Each `.sql` file is pasted into Supabase > SQL Editor by hand. There is no migration tool, so nothing stops an older
file from being run again and overwriting a newer definition. To keep that from happening:

**Rule: every function and view has exactly one owner file. Only the owner defines it.**
If you change one, change it in its owner. Don't copy it into another file, even "to keep that file self-contained".

## Owners

| Object | Owner file | Other files |
|---|---|---|
| `public.leaderboard_top()` | `leaderboard_names.sql` | none. It was in `security_hardening.sql`, `achievements.sql` and `leaderboard_privacy.sql` (older versions listed real names and ignored "hidden") |
| `public.leaderboard_start()` | `leaderboard_all_time.sql` | `points_rules.sql` creates it only if it is missing |
| `leaderboard_month` (view) | `points_rules.sql` | none. It reads `leaderboard_start()` |
| `ingest.promote_candidate()` | `price_detail.sql` | none. The older copy in `event_ingest.sql` didn't carry `price_detail` |
| `public.events_request_geocode()` | `event_autopromote.sql` | `geocode.sql` creates it only if it is missing (its trigger needs it) |
| `event_stats`, `search_terms` (views) | `guests.sql` | none. `event_actions.sql` and `search.sql` had older copies with fewer columns |

Two ways to handle a dependency, when a file needs an object before the owner has run:
- **Run order.** The owner runs later, and the older file doesn't define the object at all.
- **Create only if missing.** The older file wraps the definition in `do $$ ... if to_regprocedure('...') is null ... $$`,
  so a re-run never overwrites the owner's version (see `points_rules.sql` and `geocode.sql`).

## Order constraints (from the file headers)

This is not a full install order, only what the files themselves say:

- `event_actions.sql`, then `search.sql`, then `guests.sql`, then `pick_stats.sql`
- `search.sql` before `table_descriptions.sql`; `table_descriptions.sql` after `event_ingest.sql` and `guests.sql`
- `event_ingest.sql`, then `price_detail.sql` (defines `promote_candidate`) and `ingest_schedule.sql`
- `event_autopromote.sql` after `event_ingest.sql`, `ingest_schedule.sql` and `geocode.sql`; it also calls `promote_candidate`, so run `price_detail.sql` before it
- `points_rules.sql` (creates `leaderboard_month`), then `leaderboard_all_time.sql`
- `leaderboard_privacy.sql` (adds `nickname` and `lb_show`), then `leaderboard_names.sql` (defines `leaderboard_top`)
- `achievements.sql` before `leaderboard_names.sql` (the leaderboard joins its `achievements` table)
- `follows.sql` before `push.sql`, then `invites.sql`
- `event_reports.sql` before `submissions_v2.sql`
- `security_hardening.sql` has two steps; run step 2 only once the app that calls the new functions is live

## After running any SQL file

Run `check_current.sql`. It returns one row per owned object and says `OK` or `WRONG`. Anything `WRONG` means an older
definition got back in; re-run that object's owner file.

## Not checked

Most files say "run once; safe to re-run". Only the objects in the table above were audited for overwriting each other.
Other files may still change data or settings when re-run (for example, ones that `update` rows).
