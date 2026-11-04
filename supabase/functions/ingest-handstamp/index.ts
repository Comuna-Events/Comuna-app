// Nightly ingest: Handstamp. Covers every event_sources row with platform handstamp (see handstamp.ts for the handle
// and how it's read). No AI: candidates are built from Handstamp's own data. Skipping events already read, saving
// candidates and the run log are in ../_shared; ingest.auto_promote() moves the clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./handstamp.ts";

Deno.serve((req) => handleIngestRequest(req, "handstamp", fetchPosts));
