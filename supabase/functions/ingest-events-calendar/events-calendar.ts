// WordPress sites running "The Events Calendar" (neighborhood councils, cities, BIDs, parent magazines...), read for the
// nightly ingest. index.ts hands fetchPosts to the shared ingest; everything here is plain fetch and mapping, so
// scripts/test-ingest-events-calendar-localist.mjs can run it under Node.
//
// A source's handle is the site, or its events feed if the calendar lives in a subfolder:
//   https://palmsnc.la
//   https://www.cityofpasadena.net/parks-and-rec/wp-json/tribe/events/v1/events
// The plugin publishes every event as JSON at <site>/wp-json/tribe/events/v1/events (title, local start and end,
// venue with address, cost, organizer, image, categories). It reads up to 6 pages of 50 (#pages=N to change),
// from today to 90 days out. A site whose feed is switched off fails with a clear error in event_sources.last_error.
//
// No AI: toEvent maps the data straight onto a candidate (category from keywords, see guessCategory). Left out:
// public meetings (board, committee, agenda...), online events, outside LA County, more than 90 days out, runs longer
// than 45 days, and business keywords. Events without a street address are kept at confidence 0.6, so they wait for
// review instead of being promoted. Of an event repeated on several dates, only the next one is kept.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";
import {
  addDays, ageFrom, alsoOn, cleanName, decodeHtml, guessCategory, HORIZON_DAYS, htmlText, inLaArea, inLaCounty, isMeeting,
  laDate, nextDates, priceRange, skipText, summary, upcoming,
} from "../_shared/structured.ts";

const FEED_PATH = "/wp-json/tribe/events/v1/events";
const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";
const PAGE_SIZE = 50;
const DEFAULT_PAGES = 6;

/** An event in the feed (only the fields read here). Missing venue/organizer/image come as [] or false. */
export interface TecEvent {
  id: number;
  url: string;
  title: string;
  description?: string | null;
  excerpt?: string | null;
  status?: string;
  hide_from_listings?: boolean;
  all_day?: boolean;
  start_date: string;           // "2026-11-07 10:00:00", the site's local time
  end_date?: string | null;
  website?: string | null;
  cost?: string | null;
  cost_details?: { values?: string[] } | null;
  image?: { url?: string } | false | null;
  venue?: TecVenue | unknown[] | null;
  organizer?: { organizer?: string }[] | null;
  categories?: { name?: string }[] | null;
}
export interface TecVenue {
  venue?: string; address?: string; city?: string; zip?: string; state?: string; province?: string;
  geo_lat?: number | string; geo_lng?: number | string;
}

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const events = await feedEvents(source.handle);
  const today = laDate();
  const kept = nextDates(events.filter((e) => !skipReason(e, today)),
    (e) => e.title, (e) => venueOf(e)?.address ?? venueOf(e)?.venue ?? "", (e) => e.start_date);

  return kept.map(({ item, laterDates }) => {
    const event = toEvent(item, source, laterDates);
    return {
      externalId: `tec:${new URL(item.url).hostname}:${item.id}`,
      text: [`Title: ${event.name}`, `When: ${event.start_date} ${event.start_time ?? ""}`,
        `Where: ${[event.venue, event.street_address, event.city, event.zip].filter(Boolean).join(", ")}`,
        `Price: ${event.price_detail ?? event.price_type ?? "not stated"}`, `Link: ${item.url}`,
        event.description ? `\n${event.description}` : ""].join("\n"),
      url: item.url,
      imageUrls: imageOf(item) ? [imageOf(item)!] : [],
      raw: { ...item, description: undefined },
      events: [event],
    };
  });
}

/** The feed URL for a handle: the site with /wp-json/tribe/events/v1/events added, unless it's already there. */
export function feedUrl(handle: string, today = laDate()): { url: URL; pages: number } {
  const given = new URL(handle.trim());
  const pages = Math.min(20, Math.max(1, Number(given.hash.match(/pages=(\d+)/)?.[1] ?? DEFAULT_PAGES)));
  const at = given.pathname.indexOf(FEED_PATH);
  const url = new URL(at >= 0 ? `${given.origin}${given.pathname.slice(0, at)}${FEED_PATH}`
    : `${given.origin}${given.pathname.replace(/\/+$/, "")}${FEED_PATH}`);
  url.searchParams.set("per_page", String(PAGE_SIZE));
  url.searchParams.set("start_date", today);
  url.searchParams.set("end_date", addDays(today, HORIZON_DAYS));
  return { url, pages };
}

export async function feedEvents(handle: string): Promise<TecEvent[]> {
  const { url, pages } = feedUrl(handle);
  const events: TecEvent[] = [];
  let next: string | null = url.toString();
  for (let page = 0; page < pages && next; page++) {
    const res = await fetch(next, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
    // The plugin answers 404 with code rest_no_route when the feed is off, and 400 past the last page.
    if (res.status === 400 && page > 0) break;
    if (!res.ok) throw new Error(`${url.origin}${url.pathname} answered ${res.status}; is The Events Calendar's REST feed on?`);
    const body = await res.json() as { events?: TecEvent[]; next_rest_url?: string };
    if (!Array.isArray(body.events)) throw new Error("The events feed answered without an event list.");
    events.push(...body.events);
    next = body.next_rest_url ?? null;
  }
  return [...new Map(events.map((e) => [e.id, e])).values()];
}

export const venueOf = (e: TecEvent): TecVenue | null =>
  e.venue && !Array.isArray(e.venue) && typeof e.venue === "object" ? e.venue as TecVenue : null;
const imageOf = (e: TecEvent) => (e.image && typeof e.image === "object" && e.image.url) || null;

/** Why an event is left out, or null to keep it. */
export function skipReason(e: TecEvent, today: string): string | null {
  const title = decodeHtml(e.title ?? "");
  const v = venueOf(e);
  const start = e.start_date?.slice(0, 10) ?? null, end = (e.end_date ?? e.start_date)?.slice(0, 10);
  if (!title) return "no title";
  if (e.status && e.status !== "publish") return "not published";
  if (e.hide_from_listings) return "hidden";
  if (!upcoming(start, today)) return "date";
  if (start && end && (Date.parse(end) - Date.parse(start)) / 86_400_000 > 45) return "long run";
  if (isMeeting(title)) return "meeting";
  if (/\b(online|virtual|zoom|webinar)\b/i.test(`${title} ${v?.venue ?? ""}`)) return "online";
  if (v?.zip && /^\d{5}/.test(v.zip) && !inLaCounty(v.zip.slice(0, 5))) return "outside LA County";
  const lat = Number(v?.geo_lat), lng = Number(v?.geo_lng);
  if (v?.geo_lat && v?.geo_lng && !inLaArea(lat, lng)) return "outside LA";
  if (skipText(title)) return "keyword";
  return null;
}

/** An event as a candidate, field by field. */
export function toEvent(e: TecEvent, source: Pick<Source, "display_name" | "neighborhood">, laterDates: string[] = []):
  ExtractedEvent {
  const name = cleanName(decodeHtml(e.title));
  const text = htmlText(e.description) ?? htmlText(e.excerpt);
  const v = venueOf(e);
  const venue = v?.venue ? decodeHtml(v.venue).trim() : null;
  const street = v?.address && /^\d/.test(v.address.trim()) ? decodeHtml(v.address).trim() : null;
  const zip = v?.zip?.trim().slice(0, 5) || null;
  const cats = (e.categories ?? []).map((c) => c.name).filter(Boolean).join(" ");
  const cost = (e.cost ?? "").trim();
  const amounts = (e.cost_details?.values ?? []).map(Number).filter((n) => Number.isFinite(n));
  const free = /^free\b/i.test(cost) || (amounts.length > 0 && Math.max(...amounts) === 0);
  const lat = Number(v?.geo_lat), lng = Number(v?.geo_lng);
  const hasPoint = !!v?.geo_lat && !!v?.geo_lng && inLaArea(lat, lng);
  const startDate = e.start_date.slice(0, 10), endDate = e.end_date?.slice(0, 10) ?? null;
  return {
    name,
    description: summary(text),
    category: guessCategory(name, `${cats} ${text ?? ""}`, venue),
    tags: [],
    vibes: [],
    start_date: startDate,
    end_date: endDate && endDate !== startDate ? endDate : null,
    start_time: e.all_day ? null : e.start_date.slice(11, 16) || null,
    end_time: e.all_day ? null : e.end_date?.slice(11, 16) || null,
    recurrence: "One-off",
    recurrence_detail: alsoOn(laterDates),
    venue: venue ?? street,
    street_address: street,
    city: v?.city?.trim() || null,
    zip,
    neighborhood: source.neighborhood ?? v?.city?.trim() ?? null,
    setting: null,
    price_type: free ? "Free" : amounts.some((n) => n > 0) || /\$\s?\d/.test(cost) ? "Paid"
      : /donat|pay what/i.test(cost) ? "Donation / Pay-what-you-can" : null,
    price_detail: !free && amounts.some((n) => n > 0)
      ? priceRange(Math.min(...amounts.filter((n) => n > 0)), Math.max(...amounts))
      : !free && cost && cost.length <= 30 ? decodeHtml(cost) : null,
    rsvp_required: null,
    ticket_url: e.website?.trim() || e.url,
    age: ageFrom(`${name} ${text ?? ""}`),
    host: (e.organizer ?? []).map((o) => o.organizer && decodeHtml(o.organizer).trim()).filter(Boolean).slice(0, 2).join(", ")
      || source.display_name,
    // The site's own data; without a street and zip it waits for a person (or the nightly run) to add the address.
    confidence: street && zip ? 0.9 : 0.6,
    notes: street && zip ? null : "No street address in the calendar's venue",
    ...(hasPoint ? { lat, lng } : {}),
  };
}
