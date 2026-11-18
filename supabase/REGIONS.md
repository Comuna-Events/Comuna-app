# Regions: design note

Comuna started as a Los Angeles app, and LA is built into many places: the zip filter in the nightly ingest, the
auto-promote check, the AI prompt, the geocoder's default city, the list of neighborhoods, and the app's copy and
default map. To add Ventura County, and then more regions, "region" becomes real data instead of an assumption.

## What a region is

One row in `public.regions`:

| Column | Meaning |
|---|---|
| `id` | Short, stable key: `la`, `ventura` |
| `name` | What people see |
| `status` | `planned` (not launched), `pilot` (being tried), `live` |
| `timezone` | Stored now; the rest of the code is still Pacific-only |
| `center_lat`, `center_lng` | Where the map opens |
| `zip_ranges`, `zip_exclude` | Which zip codes it claims, and which zips inside those ranges belong elsewhere |

`events`, `ingest.event_sources` and `ingest.event_candidates` get a `region` column. `profiles.region` comes later,
with the app change. Everything that exists today is region `la`.

## This change (step 1 of 3)

`supabase/regions.sql`: the table, the Los Angeles row (copied from the rule `inLaCounty` uses today), a planned
Ventura County row, the three `region` columns, and `region_for_zip()`. Nothing reads any of it yet, so nothing
changes for people using the app or for the nightly ingest. It's additive, and every existing row becomes `la`.

## Decisions

- **Regions are rows, not code.** Adding a region should mostly be adding a row.
- **Zip ranges, with an escape hatch.** Zip codes cross county lines, so `region_for_zip()` returns a region only
  when exactly one launched region claims the zip. With none or several, it returns null and the caller settles it
  by location (step 2). The rule isn't smarter than that on purpose.
- **Only `pilot` and `live` regions claim zips.** A `planned` region can sit in the table without affecting anything.
- **The app can read launched regions** (RLS: `pilot` and `live`). It cannot change them. `region_for_zip()` is
  not callable from the app.
- **Time zone is stored but not wired.** About ten SQL files and several functions hardcode `America/Los_Angeles`.
  Ventura is Pacific, so they only matter for a region in another zone. We'll convert them when one needs it.
- **Neighborhoods and leaderboards are unchanged here.** Leaderboard boards are keyed by neighborhood; each region
  will need its places defined first (step 3).

## Known problem to settle in step 2

Los Angeles's zip range (90001-91899) already covers some zips that I believe are Ventura County (Thousand Oaks,
Newbury Park, Oak Park, in the 913xx range). So today those events are accepted as LA. The Ventura row has no zips
yet. When they're added, the overlapping zips become ambiguous on purpose, and the ingest has to decide them from
the event's coordinates. That list needs checking against a real source before it goes in.

## Next steps

2. **Pipeline reads regions.** Replace `inLaCounty` (five ingesters), the auto-promote zip check, the AI prompt's
   "Los Angeles", and the geocoder's default city with region-driven versions. `promote_candidate` copies the
   candidate's region onto the event. LA results must not change.
3. **App reads regions.** Per-region places, location-based region detection with a manual switcher, copy and map
   center from the region, and a "not in your area yet" waitlist. This needs an app release.

## Open questions

- Should `pilot` regions be visible to everyone, or only to testers? Today's policy shows them to everyone.
- Is Ventura one region (the county) or several (Ventura, Oxnard, Thousand Oaks...)? One region per county keeps
  the number of rows and sources manageable; a city can be a place inside it.
