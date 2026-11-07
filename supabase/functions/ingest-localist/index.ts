// Nightly ingest: Localist calendars (universities, cities). Covers every event_sources row with platform localist
// (see localist.ts for the handle and how it's read). No AI: candidates are built from the calendar's own event data.
// Skipping events already read, saving candidates and the run log are in ../_shared; ingest.auto_promote() moves the
// clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./localist.ts";

Deno.serve((req) => handleIngestRequest(req, "localist", fetchPosts));
