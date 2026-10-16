// Nightly ingest: Instagram.
// Your part is fetchPosts. Everything else (AI reading, saving candidates, the run log) is in ../_shared.

import { handleIngestRequest, type Source, type SourcePost } from "../_shared/ingest.ts";

// Return this account's recent posts (roughly the last 2 weeks is plenty).
// source.handle is what's in ingest.event_sources, e.g. "@echoparkrec".
// Posts the job has already read are skipped for you, so returning the same posts every night is fine.
// Keys go in Supabase > Edge Functions > Secrets; read them with Deno.env.get("NAME").
async function fetchPosts(source: Source): Promise<SourcePost[]> {
  // TODO: fetch posts for source.handle and map each one to:
  //   { externalId: post id, text: caption, url: permalink, postedAt: ISO time, imageUrls: [image url], raw: post }
  return [];
}

Deno.serve((req) => handleIngestRequest(req, "instagram", fetchPosts));
