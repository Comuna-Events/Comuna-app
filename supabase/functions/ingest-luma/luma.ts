// Luma (luma.com, formerly lu.ma), read for the nightly ingest. index.ts hands fetchPosts to the shared ingest;
// everything here is plain fetch and mapping, so scripts/test-ingest-luma-meetup.mjs can run it under Node.
//
// A source's handle is a point to search around, written as Luma's discover link:
//   https://luma.com/discover?lat=34.05&lng=-118.24            (downtown LA; reaches ~50 km)
// It reads up to 10 pages of 50 events (#pages=N to change), nearest first.
//
// Luma's own site loads these from its public API (api.lu.ma/discover/get-paginated-events): name, times, venue,
// address, coordinates, price, hosts and photo. The description comes from api.lu.ma/event/get, one request per
// event that passes the filters. If Luma changes its API, the source fails with a clear error in
// event_sources.last_error.
//
// No AI: toEvent maps the data straight onto a candidate (category from keywords, see guessCategory). Left out:
// online events, ones whose address is only shown to approved guests, outside LA County, more than 90 days out,
// sold out, and business keywords. Of an event repeated on several dates, only the next one is kept.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";
import {
  ageFrom, alsoOn, cleanName, guessCategory, inBatches, inLaArea, inLaCounty, laDate, localParts, nextDates, priceRange,
  skipText, summary, upcoming,
} from "../_shared/structured.ts";

const API = "https://api.lu.ma";
const SITE = "https://luma.com";
const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";
const PAGE_SIZE = 50;
const DEFAULT_PAGES = 10;
const PARALLEL = 6;

/** An entry of the discover list (only the fields read here). */
export interface LumaEntry {
  api_id: string;
  event: {
    api_id: string;
    name: string;
    start_at: string;
    end_at?: string | null;
    timezone?: string | null;
    url: string;
    cover_url?: string | null;
    location_type?: string;
    visibility?: string;
    recurrence_id?: string | null;
    coordinate?: { latitude: number; longitude: number } | null;
    geo_address_info?: {
      mode?: string; address?: string; city?: string; full_address?: string; short_address?: string;
    } | null;
  };
  calendar?: { name?: string } | null;
  hosts?: { name?: string }[];
  ticket_info?: {
    is_free?: boolean; is_sold_out?: boolean; require_approval?: boolean;
    price?: { cents?: number; is_flexible?: boolean } | null; max_price?: { cents?: number } | null;
  } | null;
}

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const entries = await searchEntries(source.handle);
  if (!entries.length) throw new Error("No events around this point; Luma may have changed its API.");
  const today = laDate();
  const kept = nextDates(entries.filter((e) => !skipReason(e, today)),
    (e) => e.event.name, (e) => e.event.geo_address_info?.address ?? "", (e) => e.event.start_at);
  const descriptions = await inBatches(kept, PARALLEL, ({ item }) => description(item.event.api_id).catch(() => null));

  return kept.map(({ item, laterDates }, i) => {
    const event = toEvent(item, descriptions[i], laterDates);
    return {
      externalId: `luma:${item.event.api_id}`,
      text: [`Title: ${event.name}`, `When: ${event.start_date} ${event.start_time ?? ""}`,
        `Where: ${[event.venue, event.street_address, event.city, event.zip].filter(Boolean).join(", ")}`,
        `Price: ${event.price_detail ?? event.price_type ?? "not stated"}`, `Link: ${event.ticket_url}`,
        event.description ? `\n${event.description}` : ""].join("\n"),
      url: event.ticket_url,
      imageUrls: item.event.cover_url ? [item.event.cover_url] : [],
      raw: item,
      events: [event],
    };
  });
}

/** The handle's point, searched page by page. */
export async function searchEntries(handle: string): Promise<LumaEntry[]> {
  const url = new URL(handle.trim());
  const lat = url.searchParams.get("lat"), lng = url.searchParams.get("lng") ?? url.searchParams.get("lon");
  if (!/(^|\.)(luma\.com|lu\.ma)$/.test(url.hostname) || !lat || !lng) {
    throw new Error("Handle must be a Luma discover link with a point, e.g. https://luma.com/discover?lat=34.05&lng=-118.24");
  }
  const pages = Math.min(20, Math.max(1, Number(url.hash.match(/pages=(\d+)/)?.[1] ?? DEFAULT_PAGES)));
  const entries: LumaEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pages; page++) {
    const q = new URLSearchParams({ latitude: lat, longitude: lng, pagination_limit: String(PAGE_SIZE) });
    if (cursor) q.set("pagination_cursor", cursor);
    const body = await getJson(`${API}/discover/get-paginated-events?${q}`) as
      { entries?: LumaEntry[]; has_more?: boolean; next_cursor?: string };
    if (!Array.isArray(body.entries)) throw new Error("Luma's discover API answered without an event list.");
    entries.push(...body.entries);
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return [...new Map(entries.map((e) => [e.event.api_id, e])).values()];
}

/** Why an entry is left out, or null to keep it. */
export function skipReason(e: LumaEntry, today: string): string | null {
  const ev = e.event, geo = ev.geo_address_info ?? {};
  const where = address(e);
  const start = localParts(ev.start_at, ev.timezone ?? undefined);
  const end = localParts(ev.end_at ?? ev.start_at, ev.timezone ?? undefined);
  if (ev.location_type && ev.location_type !== "offline") return "online";
  if (ev.visibility && ev.visibility !== "public") return "private";
  if (geo.mode && geo.mode !== "shown") return "address hidden";
  if (!inLaArea(ev.coordinate?.latitude ?? NaN, ev.coordinate?.longitude ?? NaN)) return "outside LA";
  if (where.zip && !inLaCounty(where.zip)) return "outside LA County";
  if (!upcoming(start?.date ?? null, today)) return "date";
  if (start && end && (Date.parse(end.date) - Date.parse(start.date)) / 86_400_000 > 45) return "long run";
  if (!where.street) return "no street address";
  if (e.ticket_info?.is_sold_out) return "sold out";
  if (skipText(ev.name)) return "keyword";
  return null;
}

/** Venue, street, city and zip from Luma's address ("The Slice & Pint, 601 N Pacific Coast Hwy, Redondo Beach, CA 90277, USA"). */
export function address(e: LumaEntry): { venue: string | null; street: string | null; city: string | null; zip: string | null } {
  const geo = e.event.geo_address_info ?? {};
  const parts = (geo.full_address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts.find((p) => /^\d/.test(p)) ?? ((geo.short_address ?? "").split(",")[0].trim().match(/^\d.*/)?.[0] ?? null);
  const zip = (geo.full_address ?? "").match(/\b[A-Z]{2}\s+(\d{5})\b/)?.[1] ?? null;
  const name = geo.address?.trim() || null;
  return { venue: name && name !== street ? name : null, street, city: geo.city?.trim() || null, zip };
}

/** An entry as a candidate, field by field. */
export function toEvent(e: LumaEntry, description: string | null, laterDates: string[] = []):
  ExtractedEvent & { lat: number; lng: number } {
  const ev = e.event, t = e.ticket_info ?? {};
  const tz = ev.timezone ?? "America/Los_Angeles";
  const start = localParts(ev.start_at, tz), end = localParts(ev.end_at, tz);
  const where = address(e);
  const name = cleanName(ev.name);
  const hosts = (e.hosts ?? []).map((h) => h.name?.trim()).filter(Boolean).slice(0, 3).join(", ") || e.calendar?.name || null;
  const lo = t.price?.cents, hi = t.max_price?.cents;
  return {
    name,
    description: summary(description),
    category: guessCategory(name, description, where.venue),
    tags: [],
    vibes: [],
    start_date: start?.date ?? null,
    end_date: end && start && end.date !== start.date ? end.date : null,
    start_time: start?.time ?? null,
    end_time: end?.time ?? null,
    recurrence: "One-off",
    recurrence_detail: alsoOn(laterDates) ?? (ev.recurrence_id ? "One of several dates on Luma" : null),
    venue: where.venue ?? where.street,
    street_address: where.street,
    city: where.city,
    zip: where.zip,
    neighborhood: where.city,
    setting: null,
    price_type: t.is_free ? "Free" : t.price?.is_flexible ? "Donation / Pay-what-you-can" : lo != null ? "Paid" : null,
    price_detail: !t.is_free && lo != null ? priceRange(lo / 100, (hi ?? lo) / 100) : null,
    rsvp_required: true,
    ticket_url: `${SITE}/${ev.url}`,
    age: ageFrom(`${name} ${description ?? ""}`),
    host: hosts,
    confidence: 0.9, // Luma's own structured data, not read from a caption
    notes: t.require_approval ? "Host approves each RSVP on Luma" : null,
    lat: ev.coordinate!.latitude,
    lng: ev.coordinate!.longitude,
  };
}

/** The event's description, as plain text, from its rich-text document. */
async function description(apiId: string): Promise<string | null> {
  const body = await getJson(`${API}/event/get?event_api_id=${encodeURIComponent(apiId)}`) as { description_mirror?: unknown };
  return mirrorText(body.description_mirror);
}

export function mirrorText(doc: unknown): string | null {
  const blocks: string[] = [];
  const walk = (node: unknown, into: string[]) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === "string") into.push(n.text);
    if (Array.isArray(n.content)) {
      if (n.type === "paragraph" || n.type === "heading" || n.type === "list_item") {
        const line: string[] = [];
        n.content.forEach((c) => walk(c, line));
        if (line.length) blocks.push(line.join(""));
      } else n.content.forEach((c) => walk(c, into));
    }
  };
  walk(doc, blocks);
  const text = blocks.join("\n").trim();
  return text || null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) throw new Error(`${url.split("?")[0]} answered ${res.status}`);
  return res.json();
}
