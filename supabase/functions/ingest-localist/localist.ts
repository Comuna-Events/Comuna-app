// Localist calendars (universities, cities: calendar.usc.edu, calendar.santaclarita.gov...), read for the nightly
// ingest. index.ts hands fetchPosts to the shared ingest; everything here is plain fetch and mapping, so
// scripts/test-ingest-events-calendar-localist.mjs can run it under Node.
//
// A source's handle is the calendar's address (or any page of it):  https://calendar.usc.edu
// Localist publishes every event at <calendar>/api/2/events (title, each date, place with address and coordinates,
// cost, photo, audience). It reads up to 5 pages of 100 (#pages=N to change), from today to 90 days out.
//
// No AI: toEvent maps the data straight onto a candidate (category from keywords, see guessCategory). Left out:
// virtual events (hybrid ones stay), private or cancelled ones, events whose listed audience doesn't include the
// public (a university's students-only talks), public meetings, outside LA County, and business keywords. Each event
// is kept once, at its next date, with the later dates listed. Events without a street address are kept at
// confidence 0.6, so they wait for review instead of being promoted.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";
import {
  ageFrom, alsoOn, cleanName, decodeHtml, guessCategory, HORIZON_DAYS, inLaArea, inLaCounty, isMeeting, laDate,
  localParts, money, parseAddress, skipText, summary, upcoming,
} from "../_shared/structured.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";
const PAGE_SIZE = 100;
const DEFAULT_PAGES = 5;

/** An event in the feed (only the fields read here). */
export interface LocalistEvent {
  id: number;
  title: string;
  status?: string;              // "live"; cancelled events say otherwise
  private?: boolean;
  experience?: string;          // "inperson", "hybrid" or "virtual"
  localist_url: string;
  url?: string | null;          // the organizer's own page
  ticket_url?: string | null;
  ticket_cost?: string | null;  // "35", "free", "$10 - $20", ...
  free?: boolean;
  photo_url?: string | null;
  location_name?: string | null;
  address?: string | null;
  location?: string | null;
  room_number?: string | null;
  description_text?: string | null;
  geo?: { street?: string | null; city?: string | null; zip?: string | null; latitude?: string | number | null; longitude?: string | number | null } | null;
  filters?: { event_audience?: { name?: string }[]; event_types?: { name?: string }[] } | null;
  departments?: { name?: string }[] | null;
  event_instances?: { event_instance: { start: string; end?: string | null; all_day?: boolean } }[];
}

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const events = await feedEvents(source.handle);
  const today = laDate();
  const out: SourcePost[] = [];
  for (const item of events) {
    if (skipReason(item, today)) continue;
    const event = toEvent(item, source, today);
    if (!event) continue;
    out.push({
      externalId: `localist:${new URL(item.localist_url).hostname}:${item.id}`,
      text: [`Title: ${event.name}`, `When: ${event.start_date} ${event.start_time ?? ""}`,
        `Where: ${[event.venue, event.street_address, event.city, event.zip].filter(Boolean).join(", ")}`,
        `Price: ${event.price_detail ?? event.price_type ?? "not stated"}`, `Link: ${item.localist_url}`,
        event.description ? `\n${event.description}` : ""].join("\n"),
      url: item.localist_url,
      imageUrls: item.photo_url ? [item.photo_url] : [],
      raw: { ...item, description_text: undefined },
      events: [event],
    });
  }
  return out;
}

/** The API address for a handle: the calendar's origin plus /api/2/events. */
export function apiUrl(handle: string): { url: URL; pages: number } {
  const given = new URL(handle.trim());
  const pages = Math.min(20, Math.max(1, Number(given.hash.match(/pages=(\d+)/)?.[1] ?? DEFAULT_PAGES)));
  const url = new URL(`${given.origin}/api/2/events`);
  url.searchParams.set("days", String(HORIZON_DAYS));
  url.searchParams.set("pp", String(PAGE_SIZE));
  return { url, pages };
}

export async function feedEvents(handle: string): Promise<LocalistEvent[]> {
  const { url, pages } = apiUrl(handle);
  const events: LocalistEvent[] = [];
  for (let page = 1; page <= pages; page++) {
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
    if (!res.ok) throw new Error(`${url.origin}/api/2/events answered ${res.status}; is this a Localist calendar?`);
    const body = await res.json() as { events?: { event: LocalistEvent }[]; page?: { current?: number; total?: number } };
    if (!Array.isArray(body.events)) throw new Error("Localist answered without an event list.");
    events.push(...body.events.map((e) => e.event));
    if (!body.page?.total || page >= body.page.total) break;
  }
  return [...new Map(events.map((e) => [e.id, e])).values()];
}

// An audience list that names any of these is open to the public.
const PUBLIC = /public|community|neighbo|everyone|\ball\b|visitor|guest|famil|general|open to/i;

/** Why an event is left out, or null to keep it. */
export function skipReason(e: LocalistEvent, today: string): string | null {
  const title = decodeHtml(e.title ?? "");
  if (!title) return "no title";
  if (e.status && e.status !== "live") return "not live";
  if (e.private) return "private";
  if (e.experience === "virtual") return "online";
  const audience = (e.filters?.event_audience ?? []).map((a) => a.name ?? "");
  if (audience.length && !audience.some((a) => PUBLIC.test(a))) return "not public";
  if (!nextInstance(e, today)) return "date";
  if (isMeeting(title)) return "meeting";
  const where = place(e);
  if (where.zip && !inLaCounty(where.zip)) return "outside LA County";
  if (where.lat != null && where.lng != null && !inLaArea(where.lat, where.lng)) return "outside LA";
  if (skipText(title)) return "keyword";
  return null;
}

/** The first date on or after today, and the later ones within the horizon. */
export function nextInstance(e: LocalistEvent, today: string) {
  const dates = (e.event_instances ?? []).map((i) => i.event_instance)
    .map((i) => ({ i, start: localParts(i.start), end: i.end ? localParts(i.end) : null }))
    .filter((x) => x.start && upcoming(x.start.date, today))
    .sort((a, b) => a.i.start.localeCompare(b.i.start));
  if (!dates.length) return null;
  const [first, ...rest] = dates;
  return { ...first, laterDates: [...new Set(rest.map((r) => r.start!.date).filter((d) => d !== first.start!.date))] };
}

/** Venue, street, city, zip and point, from geo first and the address text second. */
export function place(e: LocalistEvent) {
  const g = e.geo ?? {};
  const fromText = parseAddress(e.address || e.location || e.location_name);
  const street = g.street?.trim() || fromText.street;
  const lat = g.latitude != null && g.latitude !== "" ? Number(g.latitude) : null;
  const lng = g.longitude != null && g.longitude !== "" ? Number(g.longitude) : null;
  // "West Creek Park, 24247 Village Cir Dr, Valencia, CA 91354" -> "West Creek Park";
  // "School of Cinematic Arts - SCA (SCA)" -> without the building code; a bare address -> none.
  const first = (e.location_name ?? "").split(",")[0].trim();
  const venue = first && !/^\d/.test(first) ? first.replace(/\s*\([A-Z0-9]{2,6}\)$/, "") : null;
  return {
    venue, street,
    city: g.city?.trim() || fromText.city,
    zip: (g.zip?.trim() || fromText.zip)?.slice(0, 5) ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

/** "35" -> "$35"; "free" -> Free; "$10 - $20" kept as written. */
export function price(e: LocalistEvent): { type: string | null; detail: string | null } {
  const cost = (e.ticket_cost ?? "").trim();
  if (e.free || /^(free|\$?0(\.00)?)$/i.test(cost)) return { type: "Free", detail: null };
  if (/^\d+(\.\d+)?$/.test(cost)) return { type: "Paid", detail: money(Number(cost)) };
  if (/donat|pay what/i.test(cost)) return { type: "Donation / Pay-what-you-can", detail: cost.length <= 30 ? cost : null };
  if (/\$\s?\d/.test(cost)) return { type: "Paid", detail: cost.length <= 30 ? cost : null };
  return { type: null, detail: null };
}

/** An event as a candidate at its next date, or null if it has none in range. */
export function toEvent(e: LocalistEvent, source: Pick<Source, "display_name" | "neighborhood">, today = laDate()):
  ExtractedEvent | null {
  const next = nextInstance(e, today);
  if (!next) return null;
  const name = cleanName(decodeHtml(e.title));
  const text = e.description_text ?? null;
  const where = place(e);
  const types = (e.filters?.event_types ?? []).map((t) => t.name).filter(Boolean).join(" ");
  const p = price(e);
  const allDay = !!next.i.all_day;
  const point = where.lat != null && where.lng != null && inLaArea(where.lat, where.lng);
  return {
    name,
    description: summary(text),
    category: guessCategory(name, `${types} ${text ?? ""}`, where.venue),
    tags: [],
    vibes: [],
    start_date: next.start!.date,
    end_date: next.end && next.end.date !== next.start!.date ? next.end.date : null,
    start_time: allDay ? null : next.start!.time,
    end_time: allDay || !next.end ? null : next.end.time,
    recurrence: "One-off",
    recurrence_detail: alsoOn(next.laterDates),
    venue: where.venue ?? where.street,
    street_address: where.street,
    city: where.city,
    zip: where.zip,
    neighborhood: source.neighborhood ?? where.city,
    setting: null,
    price_type: p.type,
    price_detail: p.detail,
    rsvp_required: null,
    ticket_url: e.ticket_url?.trim() || e.localist_url,
    age: ageFrom(`${name} ${text ?? ""}`),
    host: (e.departments ?? []).map((d) => d.name).filter(Boolean).slice(0, 2).join(", ") || source.display_name,
    confidence: where.street && where.zip ? 0.9 : 0.6,
    notes: [e.experience === "hybrid" ? "Hybrid: also streamed online" : null,
      e.room_number ? `Room ${e.room_number}` : null,
      where.street && where.zip ? null : "No street address in the calendar"].filter(Boolean).join("; ") || null,
    ...(point ? { lat: where.lat!, lng: where.lng! } : {}),
  };
}
