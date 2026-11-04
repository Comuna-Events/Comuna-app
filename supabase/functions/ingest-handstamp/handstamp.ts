// Handstamp (handstamp.com), read for the nightly ingest. index.ts hands fetchPosts to the shared ingest; everything
// here is plain fetch and mapping, so scripts/test-ingest-handstamp.mjs can run it under Node.
//
// A source's handle is either
//   - a city page, e.g. https://www.handstamp.com/d/los-angeles: the events it features, plus the upcoming public
//     events of every host it lists (the city's active hosts), or
//   - a host's or group's profile, e.g. https://www.handstamp.com/camberplaces (Camber): its upcoming public events.
//
// Handstamp's pages are built with Next.js and carry their data as JSON in <script id="__NEXT_DATA__">: city pages
// list events and hosts, profiles list publicEvents, and each event page (/e/<code>) has the details (description,
// tickets, host). Event times are already local (startDate "2026-11-07T12:00:00" with tz "America/Los_Angeles").
// If Handstamp changes its pages, the source fails with a clear error in event_sources.last_error.
//
// No AI: toEvent maps the data straight onto a candidate (category from keywords, see guessCategory). Left out:
// private events, outside LA County, more than 90 days out, no street address, sold out, and business keywords.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";
import {
  ageFrom, cleanName, guessCategory, inBatches, inLaArea, inLaCounty, laDate, priceRange, skipText, summary, upcoming,
} from "../_shared/structured.ts";

const SITE = "https://www.handstamp.com";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const PARALLEL = 4;

/** An event as city pages and profiles list it (only the fields read here). */
export interface ListedEvent {
  id: string;
  name: string;
  startDate: string;          // local, "2026-11-07T12:00:00"
  endDate?: string | null;
  tz?: string | null;
  address?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  shortLink?: string | null;
  privacy?: string | null;
  photoURL?: string | null;
}

/** What the event's own page adds. */
export interface EventPage extends ListedEvent {
  description?: string | null;
  isTicketed?: boolean;
  tickets?: { price?: number; isAvailable?: boolean }[] | null;
  host?: { fullName?: string } | null;
  group?: { fullName?: string } | null;
}

type Json = Record<string, unknown>;

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const listed = await listedEvents(source.handle);
  const today = laDate();
  const candidates = [...new Map(listed.map((e) => [e.id, e])).values()].filter((e) => !skipReason(e, today));
  const pages = await inBatches(candidates, PARALLEL, (e) => eventPage(e).catch(() => null));

  const posts: SourcePost[] = [];
  pages.forEach((page) => {
    if (!page || skipReason(page, today) || soldOut(page)) return;
    const event = toEvent(page);
    posts.push({
      externalId: `handstamp:${page.id}`,
      text: [`Title: ${event.name}`, `When: ${event.start_date} ${event.start_time ?? ""}`,
        `Where: ${[event.venue, event.street_address, event.city, event.zip].filter(Boolean).join(", ")}`,
        `Price: ${event.price_detail ?? event.price_type ?? "not stated"}`, `Host: ${event.host ?? ""}`,
        `Link: ${event.ticket_url}`, event.description ? `\n${event.description}` : ""].join("\n"),
      url: event.ticket_url,
      imageUrls: page.photoURL ? [page.photoURL] : [],
      raw: { ...page, description: page.description?.slice(0, 2000) },
      events: [event],
    });
  });
  return posts;
}

/** The events a handle lists: a city page's own plus its hosts', or a profile's. */
export async function listedEvents(handle: string): Promise<ListedEvent[]> {
  const url = new URL(handle.trim());
  if (!/(^|\.)handstamp\.com$/.test(url.hostname)) throw new Error("Handle must be a handstamp.com link.");
  const path = url.pathname.replace(/\/+$/, "");
  if (/^\/d\/[a-z0-9-]+$/.test(path)) {
    const city = await pageProps(`${SITE}${path}`);
    if (!Array.isArray(city.events) || !Array.isArray(city.users)) {
      throw new Error("The city page has no event list; Handstamp may have changed its pages.");
    }
    const usernames = (city.users as Json[]).map((u) => u.username).filter((u): u is string => typeof u === "string");
    const fromHosts = await inBatches(usernames, PARALLEL, (u) => profileEvents(u).catch(() => []));
    return [...(city.events as ListedEvent[]), ...fromHosts.flat()];
  }
  if (/^\/[A-Za-z0-9._-]+$/.test(path)) return profileEvents(path.slice(1));
  throw new Error("Handle must be a city page (handstamp.com/d/<city>) or a profile (handstamp.com/<username>).");
}

async function profileEvents(username: string): Promise<ListedEvent[]> {
  const props = await pageProps(`${SITE}/${encodeURIComponent(username)}`);
  const data = props.data as Json | undefined;
  if (!data || !("publicEvents" in data)) throw new Error(`${username}: no profile data; Handstamp may have changed its pages.`);
  return (data.publicEvents ?? []) as ListedEvent[];
}

async function eventPage(e: ListedEvent): Promise<EventPage> {
  const link = e.shortLink ?? `${SITE}/e/${e.id}`;
  const props = await pageProps(link);
  if (!props.id || !props.name) throw new Error("no event data on the page");
  return { ...e, ...(props as unknown as EventPage), shortLink: link };
}

/** Why an event is left out, or null to keep it. */
export function skipReason(e: ListedEvent, today: string): string | null {
  const zip = zipOf(e.address);
  if (e.privacy && e.privacy !== "public") return "private";
  if (!inLaArea(Number(e.lat), Number(e.lng))) return "outside LA";
  if (zip && !inLaCounty(zip)) return "outside LA County";
  if (!upcoming(e.startDate?.slice(0, 10) ?? null, today)) return "date";
  if (!streetOf(e.address)) return "no street address";
  if (skipText(e.name ?? "")) return "keyword";
  return null;
}

/** Ticketed, and every ticket gone. */
export const soldOut = (e: EventPage) =>
  !!e.isTicketed && !!e.tickets?.length && e.tickets.every((t) => t.isAvailable === false);

const zipOf = (address?: string | null) => address?.match(/\b[A-Z]{2}\s+(\d{5})\b/)?.[1] ?? null;
const streetOf = (address?: string | null) => {
  const first = (address ?? "").split(",")[0].trim();
  return /^\d/.test(first) ? first : null;
};
const cityOf = (address?: string | null) => {
  const parts = (address ?? "").split(",").map((p) => p.trim());
  const i = parts.findIndex((p) => /^[A-Z]{2}\s+\d{5}$/.test(p));
  return i > 0 ? parts[i - 1] : null;
};

/** An event page as a candidate, field by field. */
export function toEvent(e: EventPage): ExtractedEvent & { lat: number; lng: number } {
  const description = htmlToText(e.description);
  const name = cleanName(e.name);
  const street = streetOf(e.address);
  const prices = (e.tickets ?? []).filter((t) => t.isAvailable !== false && typeof t.price === "number").map((t) => t.price! / 100);
  const paid = prices.filter((p) => p > 0);
  const venue = e.locationName?.trim() || null;
  return {
    name,
    description: summary(description),
    category: guessCategory(name, description, venue),
    tags: [],
    vibes: [],
    start_date: e.startDate.slice(0, 10),
    end_date: e.endDate && e.endDate.slice(0, 10) !== e.startDate.slice(0, 10) ? e.endDate.slice(0, 10) : null,
    start_time: e.startDate.slice(11, 16) || null,
    end_time: e.endDate?.slice(11, 16) || null,
    recurrence: "One-off",
    recurrence_detail: null,
    venue: venue && venue !== street ? venue : street,
    street_address: street,
    city: cityOf(e.address),
    zip: zipOf(e.address),
    neighborhood: cityOf(e.address),
    setting: null,
    price_type: paid.length ? "Paid" : "Free",
    price_detail: paid.length ? priceRange(Math.min(...prices), Math.max(...prices)) : null,
    rsvp_required: true,
    ticket_url: e.shortLink ?? `${SITE}/e/${e.id}`,
    age: ageFrom(`${name} ${description ?? ""}`),
    host: e.group?.fullName?.trim() || e.host?.fullName?.trim() || null,
    confidence: 0.9, // the host's own structured data, not read from a caption
    notes: null,
    lat: Number(e.lat),
    lng: Number(e.lng),
  };
}

export function htmlToText(html?: string | null): string | null {
  if (!html) return null;
  const text = html.replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return text || null;
}

async function pageProps(url: string): Promise<Json> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const json = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error(`${url} has no page data; Handstamp may have changed its pages.`);
  const props = (JSON.parse(json) as { props?: { pageProps?: Json } }).props?.pageProps;
  if (!props) throw new Error(`${url} has no page data; Handstamp may have changed its pages.`);
  return props;
}
