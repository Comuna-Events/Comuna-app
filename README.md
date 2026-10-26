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
- **`service-worker.js`** caches the app shell so it opens offline. Change `CACHE_NAME` whenever you change
  a file it caches, so phones pick up the new version.

## Deploying

GitHub Pages serves the repository root from `main`, so merging a pull request publishes it within a few minutes.
The app always fetches the newest `index.html` when it opens.

Database changes are SQL files in `supabase/`. Each one says at the top what it does and how to run it
(Supabase > SQL Editor). Some come in two steps, where the second step must wait until the matching app
change is live; the file says so.

## Using it on a phone

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

## Team checks

- **Reported events**, daily: `select * from event_reports_review;` in the SQL Editor. How to restore, remove or
  block is at the top of `supabase/event_reports.sql`.

## Tests

Each file in `scripts/test-*.cjs` runs with `node scripts/<file>` and prints what it checked. The browser tests
need Playwright and Chromium. The `scripts/test-*.sql` files check database changes against the live database
inside a transaction that's always rolled back; run them in the SQL Editor and read the report in the error message.
