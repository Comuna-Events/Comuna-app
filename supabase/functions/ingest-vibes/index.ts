// Fills in events.vibes (spooky, date night, live music...) for events that don't have them yet: everything that
// was in the table before vibes existed, and events added by hand since. Events from the nightly ingest arrive
// with vibes already (the AI picks them while reading the post), so this only catches the rest.
// It runs with the nightly ingest (ingest.run_nightly in ../../ingest_schedule.sql); each event is read once.
//
// Deploy:  npx supabase functions deploy ingest-vibes --project-ref sjxxiammvvfxcnukkqhg --no-verify-jwt
// (--no-verify-jwt because it checks the x-ingest-secret header itself, like the ingest-* functions.)
//
// Look before saving: add ?dry=1 to see what it would pick for the next 40 events without saving anything.
//   curl -X POST "https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/ingest-vibes?dry=1" -H "x-ingest-secret: $INGEST_SECRET"
// Run it for real from SQL Editor: select ingest.run('ingest-vibes');   (repeat until it reports remaining: 0)
// Re-pick every event's vibes after changing the list: add ?all=1 (or clear vibes_checked_at in Table Editor).

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { MODEL } from "../_shared/extract.ts";
import { cleanVibes, VIBE_GUIDE, VIBE_NAMES } from "../_shared/vibes.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const TIME_BUDGET_MS = 110_000;   // edge functions get ~150s; leftovers are picked up by the next run
const BATCH = 20;                 // events per Claude call
const COLS = "event_id,name,category,tags,description,start_date,end_date,start_time,end_time,recurrence," +
  "recurrence_detail,venue,neighborhood,setting,price_type,age";

type Row = Record<string, unknown> & { event_id: string; name: string };

const SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          vibes: { type: "array", items: { type: "string", enum: VIBE_NAMES } },
        },
        required: ["event_id", "vibes"],
        additionalProperties: false,
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
};

const SYSTEM = `You tag events for Comuna, an app that helps people in Los Angeles find in-person events. For each event
you're given, return its event_id and the vibes that fit, judging only from the details given. Return every event_id,
with an empty list when nothing clearly fits.
${VIBE_GUIDE}`;

async function pickVibes(rows: Row[]): Promise<Map<string, string[]>> {
  const listing = rows.map((row) =>
    JSON.stringify(Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))))
  ).join("\n");
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if Claude declines a batch, the API retries it on another model
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Events, one per line:\n${listing}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to tag this batch");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
  const json = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const { events } = JSON.parse(json) as { events: { event_id: string; vibes: string[] }[] };
  return new Map(events.map((e) => [e.event_id, cleanVibes(e.vibes)]));
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) return new Response("Not allowed", { status: 401 });

  const params = new URL(req.url).searchParams, dry = params.has("dry"), all = params.has("all");
  const started = Date.now();
  // Finished and cancelled events never show, so they aren't worth a call.
  let query = db.from("events").select(COLS).not("status", "in", '("Cancelled","Past / archived")').order("event_id");
  if (!all) query = query.is("vibes_checked_at", null);
  const { data, error } = await query.limit(dry ? 40 : 1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Row[];

  const picked: { event_id: string; name: string; vibes: string[] }[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rows.length && Date.now() - started < TIME_BUDGET_MS; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let vibes: Map<string, string[]>;
    try {
      vibes = await pickVibes(batch);
    } catch (err) {
      errors.push(String(err instanceof Error ? err.message : err));
      continue;
    }
    // an event left out of the answer stays unchecked and is tried again next run
    const found = batch.filter((row) => vibes.has(row.event_id))
      .map((row) => ({ event_id: row.event_id, name: row.name, vibes: vibes.get(row.event_id)! }));
    picked.push(...found);
    if (dry) continue;
    const checkedAt = new Date().toISOString();
    for (const p of found) {
      const { error } = await db.from("events").update({ vibes: p.vibes, vibes_checked_at: checkedAt }).eq("event_id", p.event_id);
      if (error) errors.push(`${p.event_id}: ${error.message}`);
    }
  }

  const done = picked.length;
  return Response.json({
    dry,
    checked: done,
    tagged: picked.filter((p) => p.vibes.length).length,
    remaining: dry ? null : rows.length - done,
    errors,
    events: dry ? picked : undefined,
  });
});
