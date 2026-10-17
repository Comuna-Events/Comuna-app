// The part of the nightly ingest every platform shares. A platform's function only supplies
// fetchPosts(source); this file loads the sources, skips posts we've already read, runs the AI,
// saves new events to ingest.event_candidates and logs the run to ingest.ingest_runs.

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
 * The whole HTTP handler for an ingest-* function. `name` labels the run in ingest_runs; `platforms`
 * are the event_sources.platform values this function reads (defaults to just `name`).
 * Call with header  x-ingest-secret: <INGEST_SECRET>.  Add ?source_id=12 to run a single source.
 */
export async function handleIngestRequest(
  req: Request, name: string, fetchPosts: FetchPosts, platforms: string[] = [name],
) {
  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) {
    return new Response("Not allowed", { status: 401 });
  }
  const sourceId = new URL(req.url).searchParams.get("source_id");
  const summary = await runIngest(name, platforms, fetchPosts, sourceId ? Number(sourceId) : null);
  return Response.json(summary);
}

function connect() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "ingest" },
  });
}
type Db = ReturnType<typeof connect>;

async function runIngest(name: string, platforms: string[], fetchPosts: FetchPosts, onlySourceId: number | null) {
  const db = connect();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const stats = { sources_checked: 0, posts_seen: 0, candidates_new: 0 };
  const errors: { source: string; error: string }[] = [];
  let ranOutOfTime = false;

  const { data: run, error: runError } = await db.from("ingest_runs").insert({ platform: name }).select("id").single();
  if (runError) throw runError;

  let query = db.from("event_sources").select("*").in("platform", platforms).eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true });
  if (onlySourceId) query = query.eq("id", onlySourceId);
  const { data: sources, error: sourcesError } = await query;
  if (sourcesError) throw sourcesError;

  for (const source of (sources ?? []) as Source[]) {
    if (Date.now() > deadline) { ranOutOfTime = true; break; }
    try {
      const posts = await fetchPosts(source);
      stats.posts_seen += posts.length;

      for (const post of await dropAlreadySeen(db, source.platform, posts)) {
        if (Date.now() > deadline) { ranOutOfTime = true; break; }
        const events = await extractEvents(post, source);
        stats.candidates_new += await saveCandidates(db, run.id, source, post, events);
      }

      stats.sources_checked++;
      await db.from("event_sources").update({
        last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null,
      }).eq("id", source.id);
    } catch (err) {
      // Database errors are plain objects, not Errors, so read their message too.
      const message = err instanceof Error ? err.message
        : (err as { message?: string })?.message ?? JSON.stringify(err);
      errors.push({ source: source.handle, error: message });
      await db.from("event_sources").update({ last_checked_at: new Date().toISOString(), last_error: message })
        .eq("id", source.id);
    }
  }

  const status = errors.length === 0 && !ranOutOfTime ? "succeeded"
    : stats.sources_checked === 0 ? "failed" : "partial";
  const summary = {
    platform: name, status, ...stats,
    error: errors.length ? `${errors.length} source(s) failed` : null,
    details: { errors, ran_out_of_time: ranOutOfTime },
  };
  await db.from("ingest_runs").update({ ...summary, finished_at: new Date().toISOString() }).eq("id", run.id);
  return summary;
}

// Every row remembers the post it came from (post_id), so a post we've read before isn't paid for again.
// Asked in batches: the ids go into the request URL, and a feed's ids can be long (they include its URL).
async function dropAlreadySeen(db: Db, platform: string, posts: SourcePost[]) {
  const seen = new Set<string>();
  for (let i = 0; i < posts.length; i += 10) {
    const { data, error } = await db.from("event_candidates").select("post_id")
      .eq("platform", platform).in("post_id", posts.slice(i, i + 10).map((p) => p.externalId));
    if (error) throw new Error(`Checking which posts were already read: ${error.message}`);
    for (const row of (data ?? []) as { post_id: string }[]) seen.add(row.post_id);
  }
  return posts.filter((p) => !seen.has(p.externalId));
}

type Extracted = Awaited<ReturnType<typeof extractEvents>>;

// Saves the post's events, skipping ones we already have. Returns how many were new.
async function saveCandidates(db: Db, runId: number, source: Source, post: SourcePost, events: Extracted) {
  const shared = {
    platform: source.platform, run_id: runId, source_id: source.id, post_id: post.externalId,
    posted_at: post.postedAt ?? null, source_url: post.url ?? null,
    raw: { text: post.text, image_urls: post.imageUrls ?? [], post: post.raw ?? null },
  };
  const rows = new Map(events.map(({ notes, ...event }) => {
    const row = {
      ...shared,
      ...event,
      // the AI is told these formats; anything else would make the insert fail, so drop it
      start_date: ifMatches(event.start_date, DATE), end_date: ifMatches(event.end_date, DATE),
      start_time: ifMatches(event.start_time, TIME), end_time: ifMatches(event.end_time, TIME),
      confidence: Math.min(1, Math.max(0, event.confidence)),
      neighborhood: event.neighborhood ?? source.neighborhood,
      category: event.category ?? source.category,
      image_url: post.imageUrls?.[0] ?? null,
      ai_notes: notes,
      external_id: "",
    };
    row.external_id = eventKey(source, row.name, row.start_date, row.recurrence);
    return [row.external_id, row] as const;
  }));

  let added = 0;
  if (rows.size) {
    const { data, error } = await db.from("event_candidates")
      .upsert([...rows.values()], { onConflict: "platform,external_id", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    added = data?.length ?? 0;
  }
  if (added === 0) {
    // Nothing new in this post: keep one row for it anyway so it isn't read again tomorrow.
    // Filter status = 'rejected' to spot-check what the AI skipped.
    const { error } = await db.from("event_candidates").upsert([{
      ...shared, external_id: `post:${post.externalId}`,
      status: events.length ? "duplicate" : "rejected",
      review_note: events.length ? "AI: only events we already have" : "AI: no upcoming event in this post",
    }], { onConflict: "platform,external_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return added;
}

// The same event from the same account is one candidate, however many times it's posted or the page changes.
// Repeating events key on the name alone, since their start_date moves to the next occurrence each week.
function eventKey(source: Source, name: string, startDate: string | null, recurrence: string | null) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const when = recurrence && recurrence !== "One-off" ? "repeating" : startDate ?? "no-date";
  return `${source.id}:${slug}:${when}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const ifMatches = (value: string | null, pattern: RegExp) => (value && pattern.test(value) ? value : null);
