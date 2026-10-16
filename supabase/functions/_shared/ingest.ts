// The part of the nightly ingest every platform shares. A platform's function only supplies
// fetchPosts(source); this file loads the sources, skips posts we've already read, runs the AI,
// saves to ingest.event_candidates and logs the run to ingest.ingest_runs.

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractEvents } from "./extract.ts";

/** A row of ingest.event_sources. */
export interface Source {
  id: number;
  platform: string;
  handle: string;              // what was typed in the table: "@handle", or a page / calendar URL
  display_name: string | null;
  neighborhood: string | null;
  category: string | null;
  last_success_at: string | null; // last time this source was read without an error
}

/** One post or listing, as a platform's fetchPosts returns it. */
export interface SourcePost {
  externalId: string;          // the platform's id for it; must stay the same night to night
  text: string;                // caption / description / page text the AI reads
  url?: string | null;         // link to the post or event page
  postedAt?: string | null;    // ISO timestamp
  imageUrls?: string[];        // flyers: the AI reads them too, so include them when the details are in the image
  raw?: unknown;               // the platform's full response for this post, kept for debugging
}

export type FetchPosts = (source: Source) => Promise<SourcePost[]>;

// Edge functions get ~150s; stop starting new work after this and let the next run pick up the rest
// (sources are read oldest-checked first).
const TIME_BUDGET_MS = 110_000;

/**
 * The whole HTTP handler for an ingest-* function.
 * Call with header  x-ingest-secret: <INGEST_SECRET>.  Add ?source_id=12 to run a single source.
 */
export async function handleIngestRequest(req: Request, platform: string, fetchPosts: FetchPosts) {
  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) {
    return new Response("Not allowed", { status: 401 });
  }
  const sourceId = new URL(req.url).searchParams.get("source_id");
  const summary = await runIngest(platform, fetchPosts, sourceId ? Number(sourceId) : null);
  return Response.json(summary);
}

function connect() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "ingest" },
  });
}
type Db = ReturnType<typeof connect>;

async function runIngest(platform: string, fetchPosts: FetchPosts, onlySourceId: number | null) {
  const db = connect();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const stats = { sources_checked: 0, posts_seen: 0, candidates_new: 0 };
  const errors: { source: string; error: string }[] = [];
  let ranOutOfTime = false;

  const { data: run, error: runError } = await db.from("ingest_runs").insert({ platform }).select("id").single();
  if (runError) throw runError;

  let query = db.from("event_sources").select("*").eq("platform", platform).eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true });
  if (onlySourceId) query = query.eq("id", onlySourceId);
  const { data: sources, error: sourcesError } = await query;
  if (sourcesError) throw sourcesError;

  for (const source of (sources ?? []) as Source[]) {
    if (Date.now() > deadline) { ranOutOfTime = true; break; }
    try {
      const posts = await fetchPosts(source);
      stats.posts_seen += posts.length;

      for (const post of await dropAlreadySeen(db, platform, posts)) {
        if (Date.now() > deadline) { ranOutOfTime = true; break; }
        const events = await extractEvents(post, source);
        const rows = candidateRows(platform, run.id, source, post, events);
        const { error } = await db.from("event_candidates")
          .upsert(rows, { onConflict: "platform,external_id", ignoreDuplicates: true });
        if (error) throw error;
        stats.candidates_new += events.length;
      }

      stats.sources_checked++;
      await db.from("event_sources").update({
        last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null,
      }).eq("id", source.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ source: source.handle, error: message });
      await db.from("event_sources").update({ last_checked_at: new Date().toISOString(), last_error: message })
        .eq("id", source.id);
    }
  }

  const status = errors.length === 0 && !ranOutOfTime ? "succeeded"
    : stats.sources_checked === 0 ? "failed" : "partial";
  const summary = {
    platform, status, ...stats,
    error: errors.length ? `${errors.length} source(s) failed` : null,
    details: { errors, ran_out_of_time: ranOutOfTime },
  };
  await db.from("ingest_runs").update({ ...summary, finished_at: new Date().toISOString() }).eq("id", run.id);
  return summary;
}

// Posts we've read before already have a candidate row (even ones that turned out not to be events),
// so we don't pay to read them again.
async function dropAlreadySeen(db: Db, platform: string, posts: SourcePost[]) {
  if (posts.length === 0) return posts;
  const { data, error } = await db.from("event_candidates").select("external_id")
    .eq("platform", platform).in("external_id", posts.map((p) => p.externalId));
  if (error) throw error;
  const seen = new Set((data ?? []).map((row: { external_id: string }) => row.external_id));
  return posts.filter((p) => !seen.has(p.externalId));
}

function candidateRows(
  platform: string, runId: number, source: Source, post: SourcePost,
  events: Awaited<ReturnType<typeof extractEvents>>,
) {
  const shared = {
    platform, run_id: runId, source_id: source.id,
    posted_at: post.postedAt ?? null, source_url: post.url ?? null,
    raw: { text: post.text, image_urls: post.imageUrls ?? [], post: post.raw ?? null },
  };
  if (events.length === 0) {
    // Remember the post so it isn't re-read tomorrow; filter status = 'rejected' to spot-check what the AI skipped.
    return [{ ...shared, external_id: post.externalId, status: "rejected", review_note: "AI: no upcoming event in this post" }];
  }
  return events.map(({ notes, ...event }, i) => ({
    ...shared,
    ...event,
    // the AI is told these formats; anything else would make the insert fail, so drop it
    start_date: ifMatches(event.start_date, DATE), end_date: ifMatches(event.end_date, DATE),
    start_time: ifMatches(event.start_time, TIME), end_time: ifMatches(event.end_time, TIME),
    confidence: Math.min(1, Math.max(0, event.confidence)),
    // first event keeps the post's id (that's what dropAlreadySeen looks for); extra ones get #2, #3...
    external_id: i === 0 ? post.externalId : `${post.externalId}#${i + 1}`,
    neighborhood: event.neighborhood ?? source.neighborhood,
    category: event.category ?? source.category,
    image_url: post.imageUrls?.[0] ?? null,
    ai_notes: notes,
  }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const ifMatches = (value: string | null, pattern: RegExp) => (value && pattern.test(value) ? value : null);
