// Nightly ingest: Meetup. Covers every event_sources row with platform meetup (see meetup.ts for the handle and how it's read).
// No AI: candidates are built from Meetup's own data. Skipping events already read, saving candidates and the run log
// are in ../_shared; ingest.auto_promote() moves the clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./meetup.ts";

Deno.serve((req) => handleIngestRequest(req, "meetup", fetchPosts));
