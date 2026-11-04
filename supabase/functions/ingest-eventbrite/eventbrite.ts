// Eventbrite, read for the nightly ingest. index.ts hands fetchPosts to the shared ingest; everything here is
// plain fetch and mapping (no Deno or database), so scripts/test-ingest-eventbrite.mjs can run it under Node.
//
// A source's handle is an Eventbrite search page for the LA area, e.g.
//   https://www.eventbrite.com/d/ca--los-angeles/all-events/          (everything, by Eventbrite's ranking)
//   https://www.eventbrite.com/d/ca--los-angeles/free--events/        (a filter)
//   https://www.eventbrite.com/d/ca--los-angeles/trivia/              (a keyword search)
//   https://www.eventbrite.com/d/ca--pasadena/all-events/             (another city: still mostly LA results)
// Category searches only work with a page number, which fetchPosts always adds. Pages are 20 events each; it
// reads 3 by default, or as many as the handle asks for with #pages=N (up to 10).
//
// Eventbrite has no public search API, but its search pages carry their results as JSON
// (window.__SERVER_DATA__): name, dates, times, venue, address, coordinates, photo and categories. The price and
// the organizer come from the event API its own pages use (api/v3/destination/events), 20 events per request.
// If Eventbrite changes its pages, the source fails with a clear error in event_sources.last_error.
//
// No AI: the data is already structured, so toEvent maps it straight onto a candidate (category from Eventbrite's
// categories and keywords, see category). The same filters as the 2026-11-04 sweep leave out what isn't for the
// app: online, outside LA County, more than 90 days out, multi-week runs, no street address, business and
// government events, sold out, tickets over $150, and the keywords in SKIP_TEXT. Of an event listed once per
// date, only the next date is kept (the others are named in recurrence_detail); once it's over, the next one is
// picked up. Vibes are left empty; ingest-vibes fills them in.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";

const SITE = "https://www.eventbrite.com";
// Eventbrite answers a browser's user agent; a bot's gets a challenge page.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const DEFAULT_PAGES = 3;
const MAX_PAGES = 10;
const PARALLEL = 3;          // requests at once, so a source takes seconds without hammering the site
const HORIZON_DAYS = 90;     // auto_promote holds anything over 60 days out until it's closer
const LONGEST_RUN_DAYS = 45; // longer is an exhibition or a standing listing, not an event
const MAX_PRICE = 150;       // cheapest ticket above this: galas, conferences

/** A search result, as the page's JSON lists it (only the fields read here). */
export interface Listing {
  id: string;
  name: string;
  summary?: string | null;
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  url: string;
  is_online_event?: boolean;
  is_cancelled?: boolean | null;
  series_id?: string | null;
  tags?: { prefix?: string; display_name?: string }[];
  locations?: { type: string; name: string }[];
  image?: { original?: { url?: string } } | null;
  primary_venue?: {
    name?: string;
    address?: {
      address_1?: string; address_2?: string; city?: string; postal_code?: string;
      latitude?: string; longitude?: string;
    };
  } | null;
}

/** What the event API adds: the price range and the organizer. */
export interface Details {
  ticket_availability?: {
    is_free?: boolean;
    is_sold_out?: boolean;
    has_available_tickets?: boolean;
    minimum_ticket_price?: { major_value?: string } | null;
    maximum_ticket_price?: { major_value?: string } | null;
  } | null;
  primary_organizer?: { name?: string } | null;
}

export type Candidate = ExtractedEvent & { lat: number; lng: number };

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const pages = pageUrls(source.handle);
  const listed: Listing[] = [];
  for (let i = 0; i < pages.length; i += PARALLEL) {
    const batch = await Promise.all(pages.slice(i, i + PARALLEL).map(readPage));
    for (const { results, pageCount, page } of batch) {
      if (page <= pageCount) listed.push(...results);
    }
  }
  if (!listed.length) throw new Error("No events on the search page; Eventbrite may have changed its pages.");

  const today = laDate(new Date());
  const kept = nextDates([...new Map(listed.map((l) => [l.id, l])).values()].filter((l) => !skipReason(l, today)));
  const details = await readDetails(kept.map((k) => k.listing.id));

  const posts: SourcePost[] = [];
  for (const { listing, laterDates } of kept) {
    const extra = details.get(listing.id);
    if (!extra || skipForPrice(extra)) continue; // no longer listed, sold out, or too expensive
    const event = toEvent(listing, extra, laterDates);
    posts.push({
      externalId: `eventbrite:${listing.id}`,
      text: postText(event),
      url: event.ticket_url,
      imageUrls: listing.image?.original?.url ? [listing.image.original.url] : [],
      raw: { listing, details: extra },
      events: [event],
    });
  }
  return posts;
}

/** The handle's search page, numbered 1..N. */
export function pageUrls(handle: string): string[] {
  const url = new URL(handle.trim());
  if (!/(^|\.)eventbrite\.com$/.test(url.hostname) || !url.pathname.startsWith("/d/")) {
    throw new Error("Handle must be an Eventbrite search page (eventbrite.com/d/...).");
  }
  const asked = Number(url.hash.match(/pages=(\d+)/)?.[1] ?? DEFAULT_PAGES);
  const count = Math.min(MAX_PAGES, Math.max(1, asked || DEFAULT_PAGES));
  url.hash = "";
  return Array.from({ length: count }, (_, i) => {
    const page = new URL(url);
    page.searchParams.set("page", String(i + 1));
    return page.href;
  });
}

async function readPage(url: string): Promise<{ results: Listing[]; pageCount: number; page: number }> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, "accept-language": "en-US" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return { ...searchResults(await res.text(), url), page: Number(new URL(url).searchParams.get("page")) };
}

/** The search results in a page's window.__SERVER_DATA__. */
export function searchResults(html: string, url: string): { results: Listing[]; pageCount: number } {
  const marker = "__SERVER_DATA__ = ";
  const start = html.indexOf(marker);
  // The object ends where the next statement (window.__REACT_QUERY_STATE__ = ...) or the script does. JSON
  // strings can't hold a raw line break, so a ";" followed by a line break is never inside one.
  const rest = start < 0 ? "" : html.slice(start + marker.length);
  const end = rest.search(/;?\s*\n\s*(window\.|<\/script>)|;?\s*<\/script>/);
  if (end < 0) throw new Error(`${url} has no page data; Eventbrite may have changed its pages.`);
  const data = JSON.parse(rest.slice(0, end));
  const events = data?.search_data?.events;
  if (!events) throw new Error(`${url} has no search results; use an eventbrite.com/d/<place>/<search>/ page.`);
  return { results: events.results ?? [], pageCount: events.pagination?.page_count ?? 1 };
}

// Words that mark an event as not for the app: business and money, online, private, sold out or called off.
const SKIP_TEXT = new RegExp(
  "\\b(real estate|investor|investing|wealth|crypto|forex|trading|webinar|virtual|zoom|certification|certified|" +
    "cpr|bls|acls|notary|license exam|ce credits?|continuing education|career fair|job fair|hiring event|recruit|" +
    "seminar|summit|conference|bootcamp|mastermind|business owners?|entrepreneur|founders?|sales training|" +
    "marketing workshop|tax|credit repair|mortgage|insurance|medicare|retreat|private event|members only|" +
    "invite only|sold out|cancel+ed|postponed|bus trip|cruise)\\b",
  "i",
);
const SKIP_CATEGORIES = new Set(["Business & Professional", "Government & Politics", "Auto, Boat & Air", "School Activities"]);

/** Why a listing is left out, or null to keep it. */
export function skipReason(l: Listing, today: string): string | null {
  const a = l.primary_venue?.address ?? {};
  const lat = Number(a.latitude), lng = Number(a.longitude);
  const end = l.end_date ?? l.start_date;
  if (l.is_online_event) return "online";
  if (l.is_cancelled) return "cancelled";
  if (!a.latitude || !a.longitude || !inLaArea(lat, lng)) return "outside LA";
  if (a.postal_code && !inLaCounty(a.postal_code)) return "outside LA County";
  if (!l.start_date || l.start_date < today || l.start_date > addDays(today, HORIZON_DAYS)) return "date";
  if (daysBetween(l.start_date, end) > LONGEST_RUN_DAYS) return "long run";
  if (!/^\s*\d/.test(a.address_1 ?? "")) return "no street address";
  if (!l.primary_venue?.name?.trim()) return "no venue";
  if (tagNames(l, "EventbriteCategory").some((c) => SKIP_CATEGORIES.has(c))) return "category";
  if (SKIP_TEXT.test(`${l.name} ${l.summary ?? ""}`)) return "keyword";
  return null;
}

function skipForPrice(d: Details): boolean {
  const t = d.ticket_availability;
  if (!t) return false; // no ticket info: kept, with the price left empty
  if (t.is_sold_out || t.has_available_tickets === false) return true;
  const lo = t.minimum_ticket_price?.major_value;
  return lo != null && Number(lo) > MAX_PRICE;
}

/** One entry per event that's listed once per date: the next date, with the later ones alongside. */
export function nextDates(listings: Listing[]): { listing: Listing; laterDates: string[] }[] {
  const groups = new Map<string, Listing[]>();
  const sorted = [...listings].sort((a, b) =>
    `${a.start_date} ${a.start_time ?? ""}`.localeCompare(`${b.start_date} ${b.start_time ?? ""}`));
  for (const l of sorted) {
    const key = `${sameName(l.name)}@${sameName(l.primary_venue?.name ?? "")}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()].map(([first, ...rest]) => ({
    listing: first,
    laterDates: [...new Set(rest.map((r) => r.start_date).filter((d) => d !== first.start_date))],
  }));
}

const sameName = (s: string) => s.toLowerCase()
  .replace(/\b(tickets?|\d{1,2}\/\d{1,2}(\/\d{2,4})?)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function readDetails(ids: string[]): Promise<Map<string, Details>> {
  const found = new Map<string, Details>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    await Promise.all(chunks.slice(i, i + PARALLEL).map(async (chunk) => {
      const url = `${SITE}/api/v3/destination/events/?event_ids=${chunk.join(",")}` +
        "&expand=ticket_availability,primary_organizer&page_size=20";
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
      if (!res.ok) throw new Error(`Eventbrite's event API answered ${res.status}`);
      const body = await res.json() as { events?: (Details & { id: string })[] };
      for (const e of body.events ?? []) found.set(e.id, e);
    }));
  }
  return found;
}

/** A listing and its details as a candidate, field by field. */
export function toEvent(l: Listing, d: Details, laterDates: string[] = []): Candidate {
  const venue = l.primary_venue ?? {};
  const a = venue.address ?? {};
  const city = cleanCity(a.city);
  const text = `${l.name} ${l.summary ?? ""}`;
  const { type, detail } = price(d);
  return {
    name: cleanName(l.name),
    description: l.summary?.trim().slice(0, 300) || null,
    category: category(l),
    tags: [...tagNames(l, "EventbriteSubCategory"), ...tagNames(l, "EventbriteFormat")].filter((t) => t !== "Other").slice(0, 3),
    vibes: [],
    start_date: l.start_date,
    end_date: l.end_date && l.end_date !== l.start_date ? l.end_date : null,
    start_time: l.start_time || null,
    end_time: l.end_time || null,
    recurrence: "One-off",
    recurrence_detail: laterDates.length
      ? `Also on ${laterDates.slice(0, 6).map(shortDate).join(", ")}${laterDates.length > 6 ? " and more" : ""}`
      : l.series_id ? "One of several dates on Eventbrite" : null,
    venue: cleanVenue(venue.name ?? ""),
    street_address: [a.address_1, a.address_2].map((s) => s?.trim()).filter(Boolean).join(" ").slice(0, 150),
    city,
    zip: a.postal_code || null,
    neighborhood: neighborhood(l, city),
    setting: null,
    price_type: type,
    price_detail: detail,
    rsvp_required: true,
    ticket_url: l.url.split("?")[0],
    age: /\b21\s*\+|21 and over|21 & over/i.test(text) ? "21+" : /\b18\s*\+|18 and over/i.test(text) ? "18+" : null,
    host: d.primary_organizer?.name?.trim() || null,
    confidence: 0.9, // Eventbrite's own structured data, not read from a caption
    notes: null,
    lat: Number(a.latitude),
    lng: Number(a.longitude),
  };
}

/** Price as the buyer sees it at checkout (Eventbrite's prices include its fees). */
export function price(d: Details): { type: string | null; detail: string | null } {
  const t = d.ticket_availability;
  const lo = t?.minimum_ticket_price?.major_value, hi = t?.maximum_ticket_price?.major_value;
  if (t?.is_free || (lo != null && Number(lo) === 0 && Number(hi ?? 0) === 0)) return { type: "Free", detail: null };
  if (lo == null) return { type: null, detail: null }; // Eventbrite doesn't say: left empty rather than guessed
  const min = Number(lo), max = Number(hi ?? lo);
  return {
    type: "Paid",
    detail: max === min ? money(min) : min === 0 ? `Free–${money(max)}` : `${money(min)}–${money(max)}`,
  };
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

// The app's six categories (see _shared/extract.ts): social formats, markets and classes by name first (social
// first, since "Trivia Night at Maydan Market" is trivia), then Eventbrite's own category, then keywords.
export function category(l: Listing): string {
  const name = l.name.toLowerCase();
  const cats = new Set(tagNames(l, "EventbriteCategory"));
  const format = tagNames(l, "EventbriteFormat").join(" ").toLowerCase();
  if (/trivia|quiz|bingo|game night|board games?|speed dating|singles|book club|meetup|mixer/.test(name)) return "Community & Social";
  if (/market|flea|bazaar|swap meet|vintage|thrift|makers fair|craft fair|pop-?up shop|warehouse sale|sample sale/.test(name)) return "Markets & Shopping";
  if (/class|workshop|training/.test(format) || /\b(workshop|class|lesson|learn)\b/.test(name)) return "Classes & Workshops";
  if (cats.has("Food & Drink")) return "Food & Drink";
  if (["Music", "Performing & Visual Arts", "Film, Media & Entertainment"].some((c) => cats.has(c))) return "Arts & Entertainment";
  if (["Sports & Fitness", "Health & Wellness", "Travel & Outdoor"].some((c) => cats.has(c))) return "Active & Outdoors";
  if (cats.has("Science & Technology")) return "Classes & Workshops";
  if (/comedy|concert|show|film|screening|jazz|\bdj\b|dance|theat|gallery|exhibit/.test(name)) return "Arts & Entertainment";
  return "Community & Social";
}

// Eventbrite's neighborhood within the City of LA ("Silver Lake"); elsewhere the city ("Pasadena"), as the app's
// other events do.
const NEIGHBORHOOD_NAMES: Record<string, string> = {
  "Downtown": "Downtown LA", "Historic Core": "Downtown LA", "Hollywood Studio District": "Hollywood",
  "Hollywood Hills West": "Hollywood Hills", "WeHo": "West Hollywood",
};
function neighborhood(l: Listing, city: string): string {
  const hood = city === "Los Angeles" ? l.locations?.find((p) => p.type === "neighbourhood")?.name : null;
  return hood ? NEIGHBORHOOD_NAMES[hood] ?? hood : city;
}

export function cleanCity(city: string | undefined): string {
  const c = (city ?? "").trim();
  if (!c || /^\d/.test(c) || /^(la|l\.a\.|los a ?ngeles)$/i.test(c)) return "Los Angeles";
  if (/^culver$/i.test(c)) return "Culver City";
  return c === c.toUpperCase() ? c.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : c;
}

// "Comedy Night | Live DJ |" -> "Comedy Night | Live DJ"
export const cleanName = (name: string) =>
  name.replace(/\s+/g, " ").replace(/[\s|\-–—:/,·•]+$/, "").trim().slice(0, 140);

// "Broadwater Black Box, 6322 Santa Monica Boulevard, Los Angeles, CA, USA" -> "Broadwater Black Box"
export const cleanVenue = (venue: string) =>
  (/,\s*(\d|CA\b|USA)/.test(venue) ? venue.split(",")[0] : venue).trim().slice(0, 120);

const tagNames = (l: Listing, prefix: string) =>
  (l.tags ?? []).filter((t) => t.prefix === prefix && t.display_name).map((t) => t.display_name!.trim());

// Southern California box from supabase/ADDING_EVENTS.md, narrowed to LA County and its edges.
const inLaArea = (lat: number, lng: number) => lat >= 33.65 && lat <= 34.85 && lng >= -118.95 && lng <= -117.65;

// LA County zip codes: 900xx-918xx and the Antelope Valley's 935xx, minus the Orange County ones in that range
// (same as ingest-partiful).
export function inLaCounty(zip: string): boolean {
  const z = Number(zip);
  if (!((z >= 90001 && z <= 91899) || (z >= 93510 && z <= 93599))) return false;
  return !((z >= 90620 && z <= 90633) || z === 90680 || (z >= 90720 && z <= 90743));
}

export const laDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Kept with the candidate (raw.text) so a reviewer can see what was read.
function postText(e: Candidate): string {
  return [
    `Title: ${e.name}`,
    `When: ${e.start_date}${e.start_time ? ` ${e.start_time}` : ""}${e.end_time ? `–${e.end_time}` : ""}`,
    e.recurrence_detail,
    `Where: ${[e.venue, e.street_address, e.city, e.zip].filter(Boolean).join(", ")}`,
    `Price: ${e.price_detail ?? e.price_type ?? "not stated"}`,
    e.host && `Organizer: ${e.host}`,
    `Link: ${e.ticket_url}`,
    e.description && `\n${e.description}`,
  ].filter(Boolean).join("\n");
}
