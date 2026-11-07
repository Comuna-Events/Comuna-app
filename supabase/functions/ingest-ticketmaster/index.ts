// Nightly ingest: Ticketmaster's Discovery API. Covers every event_sources row with platform ticketmaster (see
// ticketmaster.ts for the handle, the API key secret and how it's read). No AI: candidates are built from
// Ticketmaster's own data. Skipping events already read, saving candidates and the run log are in ../_shared;
// ingest.auto_promote() moves the clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./ticketmaster.ts";

Deno.serve((req) => handleIngestRequest(req, "ticketmaster", fetchPosts));
