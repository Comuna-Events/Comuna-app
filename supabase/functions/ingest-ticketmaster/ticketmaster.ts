// Ticketmaster (concerts, theater, sports, family shows), read for the nightly ingest through its free Discovery API.
// index.ts hands fetchPosts to the shared ingest; everything here is plain fetch and mapping, so
// scripts/test-ingest-ticketmaster.mjs can run it under Node.
//
// Needs the Edge Function secret TICKETMASTER_API_KEY (a free "Consumer Key" from developer.ticketmaster.com).
// The free tier allows 5,000 calls a day and 5 a second; a night uses a few dozen.
//
// A source's handle is a search: a point, a radius and usually a segment, written as Discovery API parameters:
//   https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.25&radius=25&segmentName=Music
// latlong is turned into the geoPoint the API now asks for. The function adds the key, today to 90 days out, date
// order and paging: up to 5 pages of 200 (#pages=N for fewer), since the API stops at 1,000 results per search.
// Split a busy search into several sources (by segment or area) so each stays under that.
//
// No AI: toEvent maps the data straight onto a candidate. Left out: cancelled, postponed and off-sale events, add-ons
// sold as their own listing (parking, VIP and hotel packages, suites, lounges), venues outside LA County, and business
// keywords. A show that runs many nights (a musical, a residency) is kept once, at its next date, with the others listed.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";
import {
  addDays, ageFrom, alsoOn, cleanName, guessCategory, HORIZON_DAYS, inLaArea, inLaCounty, laDate, nextDates, priceRange,
  skipText, summary, upcoming,
} from "../_shared/structured.ts";

const API = "https://app.ticketmaster.com/discovery/v2/events.json";
const PAGE_SIZE = 200;
const MAX_PAGES = 5;   // size * page must stay under 1,000

/** An event in the search results (only the fields read here). */
export interface TmEvent {
  id: string;
  name: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTBA?: boolean; timeTBA?: boolean; noSpecificTime?: boolean };
    end?: { localDate?: string; localTime?: string };
    status?: { code?: string };
    timezone?: string;
  };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  classifications?: { primary?: boolean; segment?: { name?: string }; genre?: { name?: string }; subGenre?: { name?: string } }[];
  images?: { url: string; ratio?: string; width?: number; fallback?: boolean }[];
  _embedded?: {
    venues?: {
      name?: string; postalCode?: string;
      address?: { line1?: string }; city?: { name?: string }; state?: { stateCode?: string };
      location?: { latitude?: string; longitude?: string };
    }[];
    attractions?: { name?: string }[];
  };
}

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const key = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("TICKETMASTER_API_KEY");
  if (!key) throw new Error("Set the TICKETMASTER_API_KEY Edge Function secret (free key from developer.ticketmaster.com).");
  const events = await searchEvents(source.handle, key);
  const today = laDate();
  const kept = nextDates(events.filter((e) => !skipReason(e, today)),
    (e) => e.name, (e) => e._embedded?.venues?.[0]?.name ?? "", (e) => e.dates?.start?.localDate ?? "");

  return kept.map(({ item, laterDates }) => {
    const event = toEvent(item, laterDates);
    return {
      externalId: `ticketmaster:${item.id}`,
      text: [`Title: ${event.name}`, `When: ${event.start_date} ${event.start_time ?? ""}`,
        `Where: ${[event.venue, event.street_address, event.city, event.zip].filter(Boolean).join(", ")}`,
        `Price: ${event.price_detail ?? "not stated"}`, `Link: ${event.ticket_url}`].join("\n"),
      url: event.ticket_url,
      imageUrls: bestImage(item) ? [bestImage(item)!] : [],
      raw: item,
      events: [event],
    };
  });
}

/** The search URL for a handle, with the key, dates, order and page size filled in. */
export function searchUrl(handle: string, key: string, today = laDate()): { url: URL; pages: number } {
  const given = new URL(handle.trim());
  if (!/(^|\.)ticketmaster\.com$/.test(given.hostname)) {
    throw new Error("Handle must be a Discovery API search, e.g. https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.25&radius=25&segmentName=Music");
  }
  const url = new URL(API);
  for (const [k, v] of given.searchParams) if (k !== "apikey") url.searchParams.set(k, v);
  const latlong = url.searchParams.get("latlong");
  if (latlong) {
    const [lat, lng] = latlong.split(",").map(Number);
    url.searchParams.delete("latlong");
    url.searchParams.set("geoPoint", geohash(lat, lng, 7));
  }
  if (!url.searchParams.get("geoPoint") && !url.searchParams.get("dmaId") && !url.searchParams.get("venueId")) {
    throw new Error("The search needs a place: latlong=lat,lng (or geoPoint, dmaId, venueId).");
  }
  if (!url.searchParams.get("radius") && !url.searchParams.get("venueId")) url.searchParams.set("radius", "25");
  if (!url.searchParams.get("unit")) url.searchParams.set("unit", "miles");
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("startDateTime", `${today}T00:00:00Z`);
  url.searchParams.set("endDateTime", `${addDays(today, HORIZON_DAYS)}T23:59:59Z`);
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("apikey", key);
  const pages = Math.min(MAX_PAGES, Math.max(1, Number(given.hash.match(/pages=(\d+)/)?.[1] ?? MAX_PAGES)));
  return { url, pages };
}

export async function searchEvents(handle: string, key: string): Promise<TmEvent[]> {
  const { url, pages } = searchUrl(handle, key);
  const events: TmEvent[] = [];
  for (let page = 0; page < pages; page++) {
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); page--; continue; }  // 5 calls a second
    if (!res.ok) throw new Error(`Ticketmaster answered ${res.status}${res.status === 401 ? " (check TICKETMASTER_API_KEY)" : ""}`);
    const body = await res.json() as { _embedded?: { events?: TmEvent[] }; page?: { totalPages?: number } };
    events.push(...(body._embedded?.events ?? []));
    if (page + 1 >= (body.page?.totalPages ?? 0)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [...new Map(events.map((e) => [e.id, e])).values()];
}

// Listings that aren't a show of their own.
const ADD_ON = /\b(parking|park & ride|shuttle|vip (package|upgrade|experience)|hotel package|suites?|lounge|club access|premium seating|upgrade|add-?on|tailgate|season tickets?|gift card|souvenir|merch|fast lane|express entry|meet (and|&) greet package)\b/i;

/** Why an event is left out, or null to keep it. */
export function skipReason(e: TmEvent, today: string): string | null {
  const v = e._embedded?.venues?.[0];
  const status = e.dates?.status?.code;
  if (status && !["onsale", "rescheduled"].includes(status)) return status;   // canceled, postponed, offsale
  if (!upcoming(e.dates?.start?.localDate ?? null, today)) return "date";
  if (e.dates?.start?.dateTBA) return "date to be announced";
  if (ADD_ON.test(e.name)) return "add-on";
  if (!v) return "no venue";
  if (v.postalCode && !inLaCounty(v.postalCode.slice(0, 5))) return "outside LA County";
  const lat = Number(v.location?.latitude), lng = Number(v.location?.longitude);
  if (v.location && !inLaArea(lat, lng)) return "outside LA";
  if (skipText(e.name)) return "keyword";
  return null;
}

const SEGMENT_CATEGORY: Record<string, string> = {
  "Music": "Arts & Entertainment", "Arts & Theatre": "Arts & Entertainment", "Film": "Arts & Entertainment",
  "Sports": "Arts & Entertainment", "Family": "Arts & Entertainment",
};

const bestImage = (e: TmEvent) =>
  [...(e.images ?? [])].filter((i) => !i.fallback).sort((a, b) =>
    (Number(b.ratio === "16_9") - Number(a.ratio === "16_9")) || ((b.width ?? 0) - (a.width ?? 0)))[0]?.url ?? null;

/** An event as a candidate, field by field. */
export function toEvent(e: TmEvent, laterDates: string[] = []): ExtractedEvent & { lat?: number; lng?: number } {
  const v: NonNullable<NonNullable<TmEvent["_embedded"]>["venues"]>[number] = e._embedded?.venues?.[0] ?? {};
  const c = e.classifications?.find((x) => x.primary) ?? e.classifications?.[0];
  const segment = c?.segment?.name ?? "";
  const name = cleanName(e.name);
  const genre = [c?.genre?.name, c?.subGenre?.name].filter((g) => g && g !== "Undefined" && g !== "Other").join(", ");
  const prices = (e.priceRanges ?? []).filter((p) => !p.currency || p.currency === "USD");
  const lo = prices.length ? Math.min(...prices.map((p) => p.min ?? p.max ?? 0)) : null;
  const hi = prices.length ? Math.max(...prices.map((p) => p.max ?? p.min ?? 0)) : null;
  const start = e.dates?.start ?? {}, end = e.dates?.end ?? {};
  const time = !start.timeTBA && !start.noSpecificTime && start.localTime ? start.localTime.slice(0, 5) : null;
  const lat = Number(v.location?.latitude), lng = Number(v.location?.longitude);
  const performers = (e._embedded?.attractions ?? []).map((a) => a.name).filter(Boolean).slice(0, 3).join(", ");
  const blurb = [genre && `${segment ? `${segment}: ` : ""}${genre}.`, e.info].filter(Boolean).join(" ");
  return {
    name,
    description: summary(blurb || null),
    category: SEGMENT_CATEGORY[segment] ?? guessCategory(name, blurb, v.name),
    tags: [segment, c?.genre?.name].filter((t): t is string => !!t && t !== "Undefined" && t !== "Miscellaneous"),
    vibes: [],
    start_date: start.localDate ?? null,
    end_date: end.localDate && end.localDate !== start.localDate ? end.localDate : null,
    start_time: time,
    end_time: end.localTime ? end.localTime.slice(0, 5) : null,
    recurrence: "One-off",
    recurrence_detail: alsoOn(laterDates),
    venue: v.name ?? null,
    street_address: v.address?.line1 ?? null,
    city: v.city?.name ?? null,
    zip: v.postalCode?.slice(0, 5) ?? null,
    neighborhood: v.city?.name ?? null,
    setting: null,
    price_type: lo === 0 && hi === 0 ? "Free" : "Paid",
    price_detail: lo != null && hi != null && hi > 0 ? priceRange(lo, hi) : null,
    rsvp_required: true,
    ticket_url: e.url ?? null,
    age: ageFrom(`${name} ${e.pleaseNote ?? ""} ${e.info ?? ""}`),
    host: performers || null,
    confidence: v.address?.line1 && v.postalCode ? 0.9 : 0.6,
    notes: e.dates?.status?.code === "rescheduled" ? "Rescheduled on Ticketmaster" : null,
    ...(inLaArea(lat, lng) ? { lat, lng } : {}),
  };
}

/** Standard geohash of a point (the Discovery API's geoPoint). */
export function geohash(lat: number, lng: number, precision = 7): string {
  const chars = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latR = [-90, 90], lngR = [-180, 180], hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR, val = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (val >= mid) { ch |= 1 << (4 - bit); r[0] = mid; } else r[1] = mid;
    even = !even;
    if (++bit === 5) { hash += chars[ch]; bit = 0; ch = 0; }
  }
  return hash;
}
