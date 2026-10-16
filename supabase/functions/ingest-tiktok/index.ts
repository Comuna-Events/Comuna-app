// Nightly ingest: TikTok.
// Your part is fetchPosts. Everything else (AI reading, saving candidates, the run log) is in ../_shared.

import { handleIngestRequest, type Source, type SourcePost } from "../_shared/ingest.ts";

// Return this account's recent videos (roughly the last 2 weeks is plenty).
// source.handle is what's in ingest.event_sources, e.g. "@lafoodfest".
// Videos the job has already read are skipped for you, so returning the same ones every night is fine.
// Keys go in Supabase > Edge Functions > Secrets; read them with Deno.env.get("NAME").
async function fetchPosts(source: Source): Promise<SourcePost[]> {
  // TODO: fetch videos for source.handle and map each one to:
  //   { externalId: video id, text: caption (+ on-screen text / transcript if you can get it),
  //     url: video link, postedAt: ISO time, imageUrls: [cover image url], raw: video }
  return [];
}

Deno.serve((req) => handleIngestRequest(req, "tiktok", fetchPosts));
