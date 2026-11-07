// Nightly ingest: WordPress sites running The Events Calendar. Covers every event_sources row with platform
// events_calendar (see events-calendar.ts for the handle and how it's read). No AI: candidates are built from the
// site's own event data. Skipping events already read, saving candidates and the run log are in ../_shared;
// ingest.auto_promote() moves the clear-cut ones into the app.

import { handleIngestRequest } from "../_shared/ingest.ts";
import { fetchPosts } from "./events-calendar.ts";

Deno.serve((req) => handleIngestRequest(req, "events_calendar", fetchPosts));
