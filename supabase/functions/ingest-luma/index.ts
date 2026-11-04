// Nightly ingest: Luma. Covers every event_sources row with platform luma (see luma.ts for the handle and how it's read).
// No AI: candidates are built from Luma's own data. Skipping events already read, saving candidates and the run log
// are in ../_shared; ingest.auto_promote() moves the clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./luma.ts";

Deno.serve((req) => handleIngestRequest(req, "luma", fetchPosts));
