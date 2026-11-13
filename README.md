# Comuna

Comuna shows what's on in your neighborhood across Los Angeles. People save events to their plans, check in
when they go (verified by location), collect each neighborhood's stamp on their passport, and compete on a
monthly neighborhood leaderboard. It runs as a web app that can be added to a phone's Home Screen.

## How it's built

- **`index.html`** is the whole app: markup, styles and code in one file, no build step.
  `places.js` holds every neighborhood and city boundary (built by `scripts/build-places.mjs` from `data/raw/`).
- **Supabase** stores everything: the event catalogue, accounts (email code sign-in, no passwords), plans,
  check-ins, points, reports and guest counts. The publishable key in `index.html` is safe to ship; row-level
  security decides what each person can read and write.
- **Mapbox** draws the map. Event locations are stored in the database (see `supabase/ADDING_EVENTS.md`).
  The map is restyled in code to look hand-drawn (ink-outlined roads, watercolor parks and water, hand-lettered
  neighborhood names, drawn pins): see `sketchMapbox()` in `index.html`. Add `?classic` to the link to see the plain map.
- **`service-worker.js`** caches the app shell so it opens offline. Change `CACHE_NAME` whenever you change
  a file it caches, so phones pick up the new version.

## Deploying

GitHub Pages serves the repository root from `main`, so merging a pull request publishes it within a few minutes.
The app always fetches the newest `index.html` when it opens.

Database changes are SQL files in `supabase/`. Each one says at the top what it does and how to run it
(Supabase > SQL Editor). Some come in two steps, where the second step must wait until the matching app
change is live; the file says so.

## Using it on a phone

- **iPhone app:** the same app, packaged for the App Store. How to build and upload it is in `IOS.md`.
- **Android app:** the same app, packaged for Google Play. How to build and upload it is in `ANDROID.md`.
- **iPhone (Safari):** open the site, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the site, tap **⋮**, then **Install app**.

## Team tools

Add `?dev` to the end of the link (for example `…/index.html?dev`) to show the team tools:

- on a laptop, beside the phone: map and database status, buttons that jump to each screen, and **Restart the demo**
  (signs out and clears everything saved on that browser);
- in Profile: **Account sync**, which checks the connection to Supabase.

Everyone else sees the plain app.

## Adding events

Events are added straight to the `events` table. Every event needs a map location, or nobody can check in:
read `supabase/ADDING_EVENTS.md` before adding or importing any.

## Badges and titles

People earn badges from verified check-ins (coffee events, farmers markets, trivia nights, streaks, new neighborhoods…) and can
wear one badge's title after their name. The list lives in the `achievements` table: change a name, title, rule text or goal,
or switch one off (`active = false`), in Supabase > Table Editor and the app picks it up. Adding a new *kind* of rule needs a new
metric in `achievement_progress()`; see the top of `supabase/achievements.sql`.

Each badge is an embroidered patch image in `badges/` (`badges/<key>.webp`, the key from the `achievements` table). The
patches are drawn in code in `scripts/patches/`: `patch.cjs` is the patch itself (fabric, rim, stitching, ribbon) with a
shape and colors per category, and `icons-<category>.cjs` hold each badge's ribbon text and icon. To add or change one,
edit its icon set and run `node scripts/patches/build.cjs <key>`, then bump `BADGE_ART` in `index.html` so phones load
the new image. A badge with no image yet shows its category's blank patch (`badges/section-<category>.webp`).

## Friend invites

**Invite** on an event lets people pick friends or share a link. Everyone answers I'm in, Maybe or Can't, and only the
people in that invite see each other's names. "I'm in" saves it to Plans. Everything is in `supabase/invites.sql`
(tables, the functions the app calls, and the notifications send-reminders sends); the app side is under
"friend invites" in `index.html`, tested by `scripts/test-invites.cjs`.

- **Friends** are people who've answered an invite with you; there's no friends list to manage. Everyone else comes in
  by link.
- **Links** look like `https://www.wearecomuna.com/i/?c=CODE` (the `i/` page in the comuna-website repo). On iPhone it
  goes to the App Store; on Android (until Comuna is on Google Play) and on a computer it opens the web app with the
  invite. Someone who installs the app first pastes the link in Plans.
- **Notifications** (send-reminders): "invited you", "is waiting on you" (Nudge), "Still in?" a couple of hours before,
  and "can't make it". On iPhone the invite ones have answer buttons (`ios/App/App/AppDelegate.swift`).
- To turn it on: run `supabase/invites.sql`, then redeploy send-reminders. Until then the Invite button shares a link
  to the event, as before.

## Team checks

- **Reported events**, daily: `select * from event_reports_review;` in the SQL Editor. How to restore, remove or
  block is at the top of `supabase/event_reports.sql`.
- **Shared events waiting for review**, daily: `select * from event_submissions_review;` (after `supabase/submissions_v2.sql`).
  Open each link and check the site name before approving. Links are already checked for shortened links, downloads,
  look-alike domains and blocked sites; block a bad site with `insert into blocked_link_hosts (host, reason) values (...)`.

## Tests

Each file in `scripts/test-*.cjs` runs with `node scripts/<file>` and prints what it checked. The browser tests
need Playwright and Chromium. The `scripts/test-*.sql` files check database changes against the live database
inside a transaction that's always rolled back; run them in the SQL Editor and read the report in the error message.
