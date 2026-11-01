// Nightly ingest: Partiful. Covers every event_sources row with platform partiful. The handle is either
//   - a host's profile, e.g. https://partiful.com/u/wYOYiNfFReumziGUYS56 (goodboybob): every upcoming public
//     event that host publishes. Find a host's link on any of their event pages (click the host's name), or
//     search the web for  site:partiful.com/u <name>.
//   - a city's Explore page, e.g. https://partiful.com/explore/la: the public events Partiful features there
//     (about 60-90 at a time, trending and by theme).
// Everything else (AI reading, saving candidates, the run log) is in ../_shared.
//
// Partiful has no public API, but its pages are built with Next.js and carry their data as JSON in the
// <script id="__NEXT_DATA__"> tag: the profile lists the host's events (initialPublishedEvents), Explore lists
// its featured events, and each event page (/e/<id>) has the details: description, address, hosts, price.
// One post per upcoming public event, read from its event page. The id includes the event's updatedAt, so an
// event is read once and again only when the host edits it. If Partiful changes its pages, the source fails
// with a clear error in event_sources.last_error rather than quietly finding nothing.

import { handleIngestRequest, type Source, type SourcePost } from "../_shared/ingest.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";
const SITE = "https://partiful.com";
// Event pages fetched at once. Explore lists ~70 events, so this keeps a run to a few seconds without
// hammering the site.
const PARALLEL = 4;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** An event as Partiful's pages list it (only the fields we read). */
interface PartifulEvent {
  id: string;
  title?: string;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  isPublic?: boolean;
  visibility?: string;
  status?: string;
}

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const url = new URL(source.handle.trim());
  if (!/(^|\.)partiful\.com$/.test(url.hostname)) throw new Error("Handle must be a partiful.com link.");

  let listed: PartifulEvent[];
  if (/^\/u\//.test(url.pathname)) {
    const props = await pageProps(url.href);
    const events = props.initialPublishedEvents;
    if (events === undefined) throw new Error("The profile page has no event list; Partiful may have changed its pages.");
    listed = (events ?? []) as unknown as PartifulEvent[]; // null: a person, not a host, or no events yet
  } else if (/^\/(explore|discover)\b/.test(url.pathname)) {
    listed = exploreEvents(await pageProps(url.href));
    if (!listed.length) throw new Error("No events on the Explore page; Partiful may have changed its pages.");
  } else {
    throw new Error("Handle must be a host profile (partiful.com/u/...) or an Explore page (partiful.com/explore/...).");
  }

  const upcoming = [...new Map(listed.filter(isUpcomingPublic).map((e) => [e.id, e])).values()];
  const posts: SourcePost[] = [];
  const failures: string[] = [];
  for (let i = 0; i < upcoming.length; i += PARALLEL) {
    const batch = await Promise.allSettled(upcoming.slice(i, i + PARALLEL).map((e) => eventPost(e.id)));
    batch.forEach((r, j) => {
      if (r.status === "fulfilled") { if (r.value) posts.push(r.value); }
      else failures.push(`${upcoming[i + j].id}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    });
  }
  // One broken event page shouldn't lose the rest, but every page failing means something is wrong.
  if (upcoming.length && !posts.length && failures.length) throw new Error(`Every event page failed, e.g. ${failures[0]}`);
  if (failures.length) console.warn(`${source.handle}: ${failures.length} event page(s) failed`, failures);
  return posts;
}

// Explore: a trending carousel, themed sections and a feed, all made of { type: "event", event } items.
// An event can appear in several, so they're de-duplicated by the caller.
export function exploreEvents(props: JsonObject): PartifulEvent[] {
  const events: PartifulEvent[] = [];
  const collect = (node: Json, depth = 0) => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => collect(n, depth + 1));
    if (node.type === "event" && isObject(node.event) && typeof node.event.id === "string") {
      events.push(node.event as unknown as PartifulEvent);
      return;
    }
    Object.values(node).forEach((v) => collect(v, depth + 1));
  };
  collect(props);
  return events;
}

// Public, published and not over yet (its end, or else its start, is less than 12 hours ago).
export function isUpcomingPublic(e: PartifulEvent): boolean {
  if (e.isPublic === false || (e.visibility && e.visibility !== "public")) return false;
  if (e.status && e.status !== "PUBLISHED") return false;
  const when = Date.parse(e.endDate ?? e.startDate ?? "");
  return !Number.isNaN(when) && when > Date.now() - 12 * 3_600_000;
}

// One event page as a post the AI reads: the facts as "Field: value" lines, then the host's description.
async function eventPost(id: string): Promise<SourcePost | null> {
  const url = `${SITE}/e/${id}`;
  const props = await pageProps(url);
  const e = props.event;
  if (!isObject(e)) throw new Error("no event data on the page");
  if (!isUpcomingPublic(e as unknown as PartifulEvent)) return null; // made private or moved since it was listed
  return {
    externalId: `partiful:${id}${typeof e.updatedAt === "string" ? `:${e.updatedAt}` : ""}`,
    text: eventText(e, props),
    url,
    postedAt: str(e.publishedAt) ?? str(e.createdAt),
    imageUrls: isObject(e.image) && str(e.image.url) ? [str(e.image.url)!] : [],
    raw: { event: e, hosts: props.hosts ?? null, offers: props.offersJsonLd ?? null },
  };
}

export function eventText(e: JsonObject, props: JsonObject): string {
  const tz = str(e.timezone) ?? "America/Los_Angeles";
  const start = str(e.startDate), end = str(e.endDate);
  const info = isObject(e.locationInfo) ? e.locationInfo : {};
  const maps = isObject(info.mapsInfo) ? info.mapsInfo : {};
  const lines = (v: Json | undefined) => (Array.isArray(v) ? v.filter((l): l is string => typeof l === "string") : []);
  const place = [str(maps.name), ...(lines(maps.addressLines).length ? lines(maps.addressLines) : lines(info.displayAddressLines))]
    .filter((s, i, all): s is string => !!s && all.indexOf(s) === i).join(", ") || str(e.location);
  const hosts = (Array.isArray(props.hosts) ? props.hosts : []).map((h) => (isObject(h) ? str(h.name) : null)).filter(Boolean);

  return [
    `Title: ${str(e.title) ?? ""}`,
    start && `Starts: ${localTime(start, tz)}`,
    end && `Ends: ${localTime(end, tz)}`,
    place && `Where: ${place}`,
    str(info.neighborhood) && `Neighborhood: ${str(info.neighborhood)}`,
    hosts.length && `Hosted by: ${hosts.join(", ")}`,
    `Price: ${priceText(props.offersJsonLd)}`,
    "RSVP: on Partiful (link below)",
    e.atCapacity === true && "Note: the event is at capacity (waitlist only)",
    `Link: ${SITE}/e/${str(e.id) ?? ""}`,
    str(e.description) && `\n${str(e.description)!.trim().slice(0, 4000)}`,
  ].filter(Boolean).join("\n");
}

// Ticketed events carry schema.org offers; events without any are free RSVPs.
export function priceText(offers: Json | undefined): string {
  const list = (Array.isArray(offers) ? offers : offers ? [offers] : []).filter(isObject);
  const prices = list.map((o) => Number(o.price)).filter((p) => Number.isFinite(p));
  if (!prices.length) return "Free (RSVP on Partiful)";
  const paid = prices.filter((p) => p > 0);
  if (!paid.length) return "Free (RSVP on Partiful)";
  const min = Math.min(...paid), max = Math.max(...paid);
  const money = (p: number) => `$${Number.isInteger(p) ? p : p.toFixed(2)}`;
  return `${min === max ? money(min) : `${money(min)}–${money(max)}`} (tickets on Partiful)${prices.some((p) => p === 0) ? ", free tickets too" : ""}`;
}

// "Saturday, November 8, 2026, 10:00 AM (America/Los_Angeles)": the AI is asked for local dates and times.
function localTime(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return `${d.toLocaleString("en-US", {
      timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    })} (${tz})`;
  } catch {
    return iso;
  }
}

async function pageProps(url: string): Promise<JsonObject> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return nextDataProps(await res.text(), url);
}

export function nextDataProps(html: string, url: string): JsonObject {
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error(`${url} has no page data; Partiful may have changed its pages.`);
  const props = (JSON.parse(json) as { props?: { pageProps?: Json } }).props?.pageProps;
  if (!isObject(props ?? null)) throw new Error(`${url} has no page data; Partiful may have changed its pages.`);
  return props as JsonObject;
}

const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: Json | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

Deno.serve((req) => handleIngestRequest(req, "partiful", fetchPosts));
