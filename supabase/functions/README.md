# Nightly event ingest

Each night one function per platform reads the accounts in `ingest.event_sources`, has Claude pull the
events out of each new post, and saves them to `ingest.event_candidates` for review. Nothing reaches the
app until someone runs `select ingest.promote_candidate(<id>);`.

```
_shared/ingest.ts      shared: loads sources, skips posts already read, saves candidates, logs ingest_runs
_shared/extract.ts     shared: the Claude prompt and the fields it returns
ingest-instagram/      fetchPosts for Instagram   ← Instagram owner
ingest-tiktok/         fetchPosts for TikTok      ← TikTok owner
```

**Your job is one function: `fetchPosts(source)`** in your platform's `index.ts`. Return the account's recent
posts as `SourcePost`s (see `_shared/ingest.ts`). Don't call Claude or write to the database yourself.
To add a platform, copy `ingest-instagram/`, rename it, and change the platform name in the last line
(it must be one of the values allowed in `ingest.event_sources.platform`).

## One-time setup (the project owner does this once)

- Secrets in Supabase > Edge Functions > Secrets:
  - `ANTHROPIC_API_KEY`: the Claude key
  - `INGEST_SECRET`: any long random string; callers must send it as the `x-ingest-secret` header
  - plus whatever your platform needs (e.g. `APIFY_TOKEN`, `META_ACCESS_TOKEN`)
- Project Settings > Data API > Exposed schemas includes `ingest`.

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

Running it again only reads new posts. To make it re-read a post, delete that post's rows from `event_candidates`.

## Good to know

- Each run has about 2 minutes. It stops starting new work after ~110 seconds and the next run picks up
  the accounts it didn't reach (accounts are read least-recently-checked first).
- If the details are in a flyer image rather than the caption, include the image in `imageUrls`; Claude
  reads it. If the image link isn't publicly reachable, the post is read from the text alone.
- Posts with no event are saved with status `rejected` so they aren't read (and paid for) again. Filter
  on that status to check what the AI skipped.
- Each post costs one Claude call (`claude-opus-5-5` at low effort). The model is set at the top of `_shared/extract.ts`.
