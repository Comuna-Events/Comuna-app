// Nightly ingest: Eventbrite. Covers every event_sources row with platform eventbrite, whose handle is an
// Eventbrite search page for the LA area (see eventbrite.ts for which pages work and how they're read).
// No AI: candidates are built from Eventbrite's own data. Skipping events already read, saving candidates and
// the run log are in ../_shared; ingest.auto_promote() moves the clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./eventbrite.ts";

Deno.serve((req) => handleIngestRequest(req, "eventbrite", fetchPosts));
