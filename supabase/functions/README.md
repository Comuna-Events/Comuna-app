# Nightly event ingest

Each night one function per platform reads the accounts in `ingest.event_sources`, has Claude pull the
events out of each new post, and saves them to `ingest.event_candidates` for review. Nothing reaches the
app until someone runs `select ingest.promote_candidate(<id>);`.

```
_shared/ingest.ts      shared: loads sources, skips posts already read, saves candidates, logs ingest_runs
_shared/extract.ts     shared: the Claude prompt and the fields it returns
ingest-instagram/      fetchPosts for Instagram                   ← Instagram owner
ingest-web/            city calendars and venue / event websites  ← web owner (works already; improve per site)
```

**Your job is one function: `fetchPosts(source)`** in your platform's `index.ts`. Return the account's recent
posts as `SourcePost`s (see `_shared/ingest.ts`). Don't call Claude or write to the database yourself.
To add a platform, copy `ingest-instagram/`, rename it, and change the platform name in the last line
(it must be one of the values allowed in `ingest.event_sources.platform`).

**Web sources:** add a row with platform `city_calendar` or `venue_website` and the page's full URL as `handle`.
`ingest-web` downloads the page, turns it into text and lets the AI find the events. If a source fails
with "almost no text", the site loads its events with JavaScript: look for its iCal / RSS feed or API and
add a special case for that site in `ingest-web/index.ts`.

## One-time setup (the project owner does this once)

- Secrets in Supabase > Edge Functions > Secrets:
  - `ANTHROPIC_API_KEY`: the Claude key
  - `INGEST_SECRET`: any long random string; callers must send it as the `x-ingest-secret` header
  - plus whatever your platform needs (e.g. `APIFY_TOKEN`, `META_ACCESS_TOKEN`)
- Project Settings > Data API > Exposed schemas includes `ingest`.
- Run `supabase/ingest_schedule.sql` in SQL Editor (after storing `INGEST_SECRET` in Vault, as its top says).
  That schedules the nightly run (10:00 UTC, 3am LA time in summer) and adds `ingest.run()`.

## Run it by hand

In SQL Editor: `select ingest.run();` for every web source, or `select ingest.run('ingest-web', 1);` for one source.
It returns right away; check `ingest.ingest_runs` and `ingest.event_candidates` a couple of minutes later.
When a new platform's function is deployed, add it to `ingest.run_nightly()` in `ingest_schedule.sql`.

## Try it

1. Add an account to `ingest.event_sources` in Table Editor (switch the schema dropdown to `ingest`). Note its `id`.
2. Deploy your function (needs Node; the first run asks you to log in):
   ```
   npx supabase login
   npx supabase functions deploy ingest-instagram --project-ref sjxxiammvvfxcnukkqhg --no-verify-jwt
   ```
   (`--no-verify-jwt` because the function checks `INGEST_SECRET` itself.)
3. Run it for that one account:
   ```
   curl -X POST "https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/ingest-instagram?source_id=1" \
     -H "x-ingest-secret: $INGEST_SECRET"
   ```
   It returns a summary. Then look at `ingest.event_candidates` and `ingest.ingest_runs`.
4. Logs: Supabase > Edge Functions > your function > Logs.

Running it again only reads new posts (for web pages: only pages whose text changed), and an event we already
have from that source is skipped, even if it's posted again. To make it re-read a post, delete the rows with
that `post_id` from `event_candidates`.

## Good to know

- Each run has about 2 minutes. It stops starting new work after ~110 seconds and the next run picks up
  the accounts it didn't reach (accounts are read least-recently-checked first).
- If the details are in a flyer image rather than the caption, include the image in `imageUrls`; Claude
  reads it. If the image link isn't publicly reachable, the post is read from the text alone.
- Posts with no event are saved with status `rejected` (and posts with only events we already have, with
  `duplicate`) so they aren't read and paid for again. Filter on `rejected` to check what the AI skipped.
- Each new post or changed page costs one Claude call (`claude-opus-5-5` at low effort). The model is set at the top of `_shared/extract.ts`.
