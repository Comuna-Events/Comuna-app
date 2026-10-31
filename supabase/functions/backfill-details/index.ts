// Fills in the price amount, photo and end time on events added before the nightly ingest saved them
// (supabase/backfill_details.sql picks which). For each event it reads the event's own page:
// - photo: the event's schema.org JSON-LD image, else the page's og:image (not on pages that list several events);
// - price and end time: the JSON-LD offers / endDate when the page has them, else Claude reads the page text.
// It only fills what's missing, never overwrites, and marks each event checked so it's read once.
// Without ANTHROPIC_API_KEY it does everything but the Claude step, and flags the events that still need it
// (details_ai_pending), so a later run with the key reads just those again.
//
// Call with header  x-ingest-secret: <INGEST_SECRET>  (or: select ingest.run('backfill-details');)
//   ?limit=40  how many events per call (each call has ~110s)
//   ?dry=1     return what it would save, without saving or marking anything

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { MODEL } from "../_shared/extract.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";
const TIME_BUDGET_MS = 110_000;
const PRICE_TYPE = ["Free", "Paid", "Donation / Pay-what-you-can"];

interface Todo {
  event_id: string; name: string; venue: string | null; start_date: string | null; start_time: string | null;
  end_time: string | null; price_type: string | null; price_detail: string | null; image_url: string | null;
  source_url: string; shared_page: boolean;
}
type Found = { price_type?: string; price_detail?: string; end_time?: string; image_url?: string };

Deno.serve(async (req) => {
  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) return new Response("Not allowed", { status: 401 });
  const params = new URL(req.url).searchParams;
  const dry = params.get("dry") === "1";
  const limit = Number(params.get("limit") ?? 40);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.schema("ingest").rpc("details_todo", { p_limit: limit, p_with_ai: !!client });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const deadline = Date.now() + TIME_BUDGET_MS;
  const results: { event_id: string; saved: Found; needs_ai?: boolean; error?: string }[] = [];
  const todo = (data ?? []) as Todo[];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < todo.length && Date.now() < deadline) {
      const ev = todo[next++];
      let saved: Found = {}, needsAi = false, failure: string | undefined;
      try { ({ found: saved, needsAi } = await lookUp(ev)); } catch (err) { failure = err instanceof Error ? err.message : String(err); }
      if (!dry) {
        const { error } = await db.from("events")
          .update({ ...saved, details_checked_at: new Date().toISOString(), details_ai_pending: needsAi })
          .eq("event_id", ev.event_id);
        if (error) failure = `saving: ${error.message}`;
      }
      results.push({ event_id: ev.event_id, saved, ...(needsAi ? { needs_ai: true } : {}), ...(failure ? { error: failure } : {}) });
    }
  }));

  const count = (k: keyof Found) => results.filter((r) => r.saved[k]).length;
  return Response.json({
    dry, checked: results.length, left_in_batch: todo.length - results.length,
    filled: { price_detail: count("price_detail"), price_type: count("price_type"), image_url: count("image_url"), end_time: count("end_time") },
    failed: results.filter((r) => r.error).length,
    waiting_for_ai: results.filter((r) => r.needs_ai).length,
    results: dry ? results : results.filter((r) => r.error).slice(0, 20),
  });
});

// What to fill in for one event: only fields it's missing. needsAi: Claude would read the page, but there's no key.
async function lookUp(ev: Todo): Promise<{ found: Found; needsAi: boolean }> {
  const res = await fetch(ev.source_url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`page answered ${res.status}`);
  const html = await res.text();
  const pageUrl = res.url || ev.source_url;
  const ld = matchingEvent(jsonLdEvents(html), ev);

  const needPrice = ev.price_type !== "Free" && !ev.price_detail;
  const needEnd = !ev.end_time && !!ev.start_time;
  const needPhoto = !ev.image_url || !/^https?:\/\//.test(ev.image_url);
  const found: Found = {};

  if (needPhoto) {
    const photo = absolute(ldImage(ld), pageUrl) ?? (ev.shared_page ? null : absolute(metaImage(html), pageUrl));
    if (photo && !/logo|favicon|placeholder|default[-_]?image/i.test(photo)) found.image_url = photo;
  }
  if (needPrice && ld) Object.assign(found, ldPrice(ld));
  if (needEnd && ld) {
    const end = timeOf(ld.endDate);
    if (end && ev.start_time && end > ev.start_time.slice(0, 5)) found.end_time = end;
  }

  // Still missing a price or an end time: let Claude read the page.
  const stillPrice = needPrice && !found.price_detail && !(found.price_type === "Free");
  const stillEnd = needEnd && !found.end_time;
  if ((stillPrice || stillEnd) && !client) return { found: tidy(ev, found), needsAi: true };
  if (stillPrice || stillEnd) {
    const ai = await askClaude(ev, pageText(html).slice(0, 15_000));
    if (stillPrice) {
      if (ai.price_detail) found.price_detail = ai.price_detail.slice(0, 40);
      if (!ev.price_type && ai.price_type) found.price_type = ai.price_type;
    }
    if (stillEnd && ai.end_time && ev.start_time && ai.end_time > ev.start_time.slice(0, 5)) found.end_time = ai.end_time;
  }
  return { found: tidy(ev, found), needsAi: false };
}

// never change a price label that's already set
function tidy(ev: Todo, found: Found): Found {
  if (ev.price_type && found.price_type) delete found.price_type;
  return found;
}

// ---------- schema.org JSON-LD ----------
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
const isObj = (v: Json | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function jsonLdEvents(html: string): Obj[] {
  const out: Obj[] = [];
  const collect = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!isObj(node)) return;
    const types = ([] as Json[]).concat(node["@type"] ?? []);
    if (types.some((t) => typeof t === "string" && /Event$/.test(t))) out.push(node);
    else if (node["@graph"]) collect(node["@graph"]);
  };
  for (const [, json] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(json)); } catch { /* a broken block: skip it */ }
  }
  return out;
}

// On a page with one event, that one; on a page listing several, the one with this event's name.
function matchingEvent(events: Obj[], ev: Todo): Obj | null {
  const norm = (s: Json | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const want = norm(ev.name);
  return events.find((e) => norm(e.name) === want)
    ?? events.find((e) => { const n = norm(e.name); return !!n && (n.includes(want) || want.includes(n)); })
    ?? (!ev.shared_page && events.length === 1 ? events[0] : null);
}

function ldImage(e: Obj | null): string | null {
  const img = e?.image;
  const first = Array.isArray(img) ? img[0] : img;
  if (typeof first === "string") return first;
  if (isObj(first) && typeof first.url === "string") return first.url;
  return null;
}

function ldPrice(e: Obj): Found {
  if (e.isAccessibleForFree === true || e.isAccessibleForFree === "true") return { price_type: "Free" };
  const offers = ([] as Json[]).concat(e.offers ?? []).filter(isObj);
  // every number in each price field: "12-52" is 12 and 52, and an empty price isn't $0
  const nums = offers.flatMap((o) => [o.price, o.lowPrice, o.highPrice])
    .flatMap((p): string[] => String(p ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number).filter(Number.isFinite);
  const usd = offers.every((o) => !o.priceCurrency || o.priceCurrency === "USD");
  if (!nums.length || !usd) return {};
  const lo = Math.min(...nums), hi = Math.max(...nums);
  if (hi === 0) return { price_type: "Free" };
  const fmt = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return { price_type: "Paid", price_detail: lo === hi ? fmt(hi) : `${fmt(lo)}–${fmt(hi)}` };
}

// "2026-11-02T14:00:00-08:00" -> "14:00" (the local time as written)
const timeOf = (v: Json | undefined) => String(v ?? "").match(/T(\d{2}:\d{2})/)?.[1] ?? null;

// ---------- the page ----------
function metaImage(html: string): string | null {
  for (const prop of ["og:image", "og:image:url", "twitter:image"]) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"));
    if (m) return m[1].replace(/&amp;/g, "&");
  }
  return null;
}

function absolute(url: string | null, base: string): string | null {
  if (!url) return null;
  try { const u = new URL(url, base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}

function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/article|\/section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// ---------- Claude, for pages without structured data ----------
const client = Deno.env.get("ANTHROPIC_API_KEY") ? new Anthropic() : null; // reads ANTHROPIC_API_KEY

const SCHEMA = {
  type: "object",
  properties: {
    price_type: { anyOf: [{ type: "string", enum: PRICE_TYPE }, { type: "null" }] },
    price_detail: { type: "string" },
    end_time: { type: "string" },
  },
  required: ["price_type", "price_detail", "end_time"],
  additionalProperties: false,
};

const SYSTEM = `You read one event web page for Comuna, an app that lists Los Angeles events, and fill in details the app is missing for one named event.

Answer only from what the page says about that event. If the page lists several events, use only the lines about the named one. When it doesn't say, use an empty string (or null for price_type). Never guess.
- price_type: Free, Paid, or Donation / Pay-what-you-can.
- price_detail: the price exactly as stated, kept short: "$15", "$20–40", "$10 suggested donation", "$25 adv / $30 door". Empty when no amount is given, including for free events.
- end_time: when it ends, 24-hour HH:MM.`;

async function askClaude(ev: Todo, text: string): Promise<{ price_type: string | null; price_detail: string; end_time: string }> {
  const header = [
    `Event: ${ev.name}`, ev.venue && `Venue: ${ev.venue}`, ev.start_date && `Date: ${ev.start_date}`,
    ev.start_time && `Starts: ${ev.start_time.slice(0, 5)}`, `Page: ${ev.source_url}`,
  ].filter(Boolean).join("\n");
  // the same call the nightly extractor makes (extract.ts)
  const response = await client!.beta.messages.create({
    model: MODEL,
    max_tokens: 1000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `${header}\n\nPage text:\n${text}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this page");
  const json = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = JSON.parse(json) as { price_type: string | null; price_detail: string; end_time: string };
  return {
    price_type: PRICE_TYPE.includes(out.price_type ?? "") ? out.price_type : null,
    price_detail: out.price_detail.trim(),
    end_time: /^\d{2}:\d{2}$/.test(out.end_time.trim()) ? out.end_time.trim() : "",
  };
}
