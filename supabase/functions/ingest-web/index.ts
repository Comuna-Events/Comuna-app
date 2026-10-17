// Nightly ingest: public web pages. Covers every event_sources row with platform city_calendar or
// venue_website, where handle is the page's URL (a city / library calendar, a venue's events page, a blog
// that lists events...). Everything else (AI reading, saving candidates, the run log) is in ../_shared.
//
// Works as is: it downloads the page, turns it into plain text and lets the AI find the events.
// The page is only re-read when its text changes, and events we already have are skipped.
// Improve it per site where that pays off, e.g. read a calendar's iCal / RSS feed instead of its HTML.
// Special cases so far:
// - Localist calendar APIs (handle is the .../api/2/events URL), see localistPosts.
// - Any JSON feed or API (handle answers JSON): one post per event, see jsonFeedPosts. Covers e.g. the
//   Hollywood Bowl's /events/feed, the LA Phil's /api/events and Communico library calendars (eeventcaldata).
// - RSS / Atom feeds (handle answers XML): one post per item, see xmlFeedPosts. E.g. the City of Burbank calendar.
// - Pages that list their events as schema.org JSON-LD (common on Ticketmaster / Live Nation venue pages,
//   whose visible listings only appear after the browser runs the page's code): end the handle with #jsonld
//   to read those instead of the page text, one post per event; see jsonLdPosts. It's opt-in because many
//   calendars that already read fine as text (e.g. WordPress "The Events Calendar" sites) also carry JSON-LD,
//   one entry per occurrence, which would cost far more AI calls than reading the page once.
// A handle can contain {today} or {today+N} (e.g. {today+60}); they're replaced with that date (YYYY-MM-DD,
// LA time) on every run, for APIs that want a date range.

import { handleIngestRequest, type Source, type SourcePost } from "../_shared/ingest.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";

async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const url = withDates(source.handle);
  if (/\/api\/2\/events\b/.test(new URL(url).pathname)) return localistPosts(url);

  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.text();
  const type = res.headers.get("content-type") ?? "";

  if (/json/.test(type) || /^\s*[[{]/.test(body)) return jsonFeedPosts(source.handle, JSON.parse(body));
  if ((/xml|rss|atom/.test(type) && !/html/.test(type)) || /^\s*(<\?xml[^>]*>\s*)?<(rss|feed)\b/.test(body)) {
    return xmlFeedPosts(source.handle, body);
  }

  if (new URL(url).hash === "#jsonld") {
    const ldPosts = jsonLdPosts(body, source.handle);
    if (!ldPosts.length) throw new Error("No upcoming schema.org events on the page; remove #jsonld from the handle.");
    return ldPosts;
  }

  const text = pageText(body, url);
  if (text.length < 200) {
    throw new Error("Page has almost no text; it probably loads its events with JavaScript. Look for a feed or API.");
  }
  // A new id whenever the page's text changes, so an unchanged page isn't read (or paid for) again.
  return [{ externalId: `${url}#${await shortHash(text)}`, text, url }];
}

function withDates(handle: string): string {
  return handle.replace(/\{today(?:\+(\d+))?\}/g, (_, days) => {
    const date = new Date(Date.now() + Number(days ?? 0) * 86_400_000);
    return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  });
}

// JSON feeds and APIs: the events are the biggest list of objects in the response. Each becomes one post,
// written out as "field: value" lines for the AI. Occurrences of a series (same recurring_id / series_id)
// are grouped into one post with all their dates. Events that are already over are skipped. The id uses the
// event's own id (plus its updated time, when it has one), so an event is read once and again only if edited.
// The handle, not the date-filled URL, goes into the id, so the ids stay the same from day to day.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function jsonFeedPosts(handle: string, data: Json): SourcePost[] {
  const list = biggestObjectList(data);
  if (!list.length) throw new Error("The JSON has no list of events in it.");
  const groups = new Map<string, JsonObject[]>();
  for (const item of list.filter((item) => !isOver(item))) {
    const series = pick(item, ["recurring_id", "series_id", "recurrence_id"]);
    const key = series && series !== "0" ? `series:${series}` : String(pick(item, ["id", "event_id", "eventId", "uuid"]) ?? stableJson(item));
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups].map(([key, items]) => {
    const first = items[0];
    const updated = pick(first, ["updatedAt", "updated_at", "modified", "lastModified"]);
    const dates = items.length > 1
      ? `\nAll dates (each one is a separate occurrence):\n${items.map((i) => `- ${startOf(i) ?? "?"}`).join("\n")}`
      : "";
    const link = pick(first, ["absolute_url", "url", "link", "permalink", "event_url"]);
    return {
      externalId: `${handle}#${key}${updated ? `:${updated}` : ""}`,
      text: flatten(first) + dates,
      url: link ? absoluteUrl(link, handle) : null,
      raw: items.length > 1 ? items : first,
    };
  });
}

function biggestObjectList(data: Json, depth = 0): JsonObject[] {
  if (Array.isArray(data)) {
    const objects = data.filter(isObject);
    if (objects.length) return objects;
  }
  if (!isObject(data) || depth > 3) return [];
  return Object.values(data).map((v) => biggestObjectList(v, depth + 1))
    .reduce((best, list) => (list.length > best.length ? list : best), [] as JsonObject[]);
}

const isObject = (v: Json): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

function absoluteUrl(link: string, base: string): string | null {
  try { return new URL(link, base).href; } catch { return null; }
}

function pick(item: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

const START_KEYS = ["startDate", "start_date", "start_time", "startTime", "start", "event_start", "starts_at", "date"];
const END_KEYS = ["endDate", "end_date", "event_end", "end", "ends_at"];
const startOf = (item: JsonObject) => pick(item, START_KEYS);

// Over if its end (or else its start) was more than a day ago. Items without a readable date are kept.
function isOver(item: JsonObject): boolean {
  const when = Date.parse(pick(item, END_KEYS) ?? startOf(item) ?? "");
  return !Number.isNaN(when) && when < Date.now() - 86_400_000;
}

// Fields that are noise for the AI (images, styling, ticketing internals, seat counts, SEO) are left out,
// HTML in values is turned into text, and the result is capped so one event stays a small prompt.
const SKIP_FIELD = /^@context$|html|image|img|photo|logo|thumbnail|tenant|theme|meta|seo|tessitura|_tz$|timestamp|waitlist|registrant|attendee|seat|webinar|billing|staff|color|style/i;

function flatten(value: Json, path = "", depth = 0): string {
  if (value === null || value === "" || depth > 4) return "";
  if (typeof value !== "object") {
    const text = typeof value === "string" ? htmlToText(value).slice(0, 800) : String(value);
    return text ? `${path}: ${text}\n` : "";
  }
  const entries: [string, Json][] = Array.isArray(value)
    ? value.slice(0, 10).map((v, i) => [String(i), v])
    : Object.entries(value).filter(([key]) => !SKIP_FIELD.test(key));
  const out = entries.map(([key, v]) => flatten(v, path ? `${path}.${key}` : key, depth + 1)).join("");
  return depth === 0 ? out.slice(0, 5000) : out;
}

function stableJson(value: Json): string {
  return JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
}

// RSS and Atom: one post per <item> / <entry>, with all of its text (title, dates, summary, custom fields).
const HTML_TAG = /^(p|br|div|span|a|strong|em|b|i|u|h[1-6]|ul|ol|li|img|table|tbody|tr|td|th|hr|figure|blockquote)$/i;

function xmlFeedPosts(handle: string, xml: string): SourcePost[] {
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  if (!items.length && !/<(rss|feed)\b/.test(xml)) throw new Error("The XML isn't an RSS or Atom feed.");
  return items.map((item) => {
    const field = (name: string) =>
      item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = field("link") || item.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || null;
    const id = field("guid") || field("id") || link || field("title") || item;
    const updated = field("updated") || field("pubDate") || "";
    // Feed fields become "name: value" lines; HTML tags inside a summary are left for htmlToText.
    const text = item
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/gi, "Link: $1\n")
      .replace(/<(\/?)([a-z][a-z0-9:]*)[^>]*>/gi, (tag, close, name) =>
        HTML_TAG.test(name) ? tag : close ? "\n" : `\n${name.replace(/^.*:/, "")}: `);
    return {
      externalId: `${handle}#${id}${updated ? `:${updated}` : ""}`,
      text: htmlToText(decodeEntities(text)).slice(0, 5000),
      url: link,
      postedAt: updated && !Number.isNaN(Date.parse(updated)) ? new Date(updated).toISOString() : null,
    };
  });
}

// schema.org Event objects in <script type="application/ld+json"> blocks, including ones inside @graph or lists.
function jsonLdPosts(html: string, pageUrl: string): SourcePost[] {
  const events: JsonObject[] = [];
  const collect = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!isObject(node)) return;
    const types = ([] as Json[]).concat(node["@type"] ?? []);
    if (types.some((t) => typeof t === "string" && /Event$/.test(t))) events.push(node);
    else if (node["@graph"]) collect(node["@graph"]);
  };
  for (const [, json] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(json)); } catch { /* a broken block: skip it */ }
  }

  // Occurrences of the same event (same name) become one post with all their dates.
  const byName = new Map<string, JsonObject[]>();
  for (const e of events.filter((e) => !isOver(e))) {
    const name = String(e.name ?? "");
    byName.set(name, [...(byName.get(name) ?? []), e]);
  }
  return [...byName.values()].map((group) => {
    const first = group[0];
    const link = typeof first.url === "string" ? absoluteUrl(first.url, pageUrl) : null;
    const dates = group.length > 1
      ? `\nAll dates (each one is a separate occurrence):\n${group.map((e) => `- ${startOf(e) ?? "?"}`).join("\n")}`
      : "";
    return {
      externalId: `${pageUrl}#ld:${link ?? first.name}`,
      text: flatten(first) + dates,
      url: link ?? pageUrl,
      raw: group.length > 1 ? group : first,
    };
  });
}

// Localist calendars (e.g. the City of Santa Monica's) have a public JSON API, so handle is the API URL:
//   https://santamonica.enterprise.localist.com/api/2/events?days=90&pp=100
// The API returns one entry per date, so a festival with 20 performances comes back 20 times; group them
// into one post per event with all its dates. The id includes updated_at, so an edited event is re-read.
interface LocalistEvent {
  id: number;
  title: string;
  updated_at: string;
  created_at: string;
  description_text?: string | null;
  location_name?: string | null;
  room_number?: string | null;
  address?: string | null;
  experience?: string | null;
  stream_url?: string | null;
  free?: boolean;
  ticket_cost?: string | null;
  ticket_url?: string | null;
  url?: string | null;
  localist_url: string;
  photo_url?: string | null;
  tags?: string[];
  groups?: { name: string }[];
  filters?: { event_types?: { name: string }[] };
  event_instances: { event_instance: { start: string; end: string | null; all_day: boolean } }[];
}

async function localistPosts(apiUrl: string): Promise<SourcePost[]> {
  const byId = new Map<number, { event: LocalistEvent; instances: LocalistEvent["event_instances"] }>();
  for (let page = 1; ; page++) {
    const pageUrl = new URL(apiUrl);
    pageUrl.searchParams.set("page", String(page));
    const res = await fetch(pageUrl, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
    if (!res.ok) throw new Error(`${pageUrl} answered ${res.status}`);
    const body = await res.json() as { events: { event: LocalistEvent }[]; page: { current: number; total: number } };

    for (const { event } of body.events) {
      const seen = byId.get(event.id);
      if (seen) seen.instances.push(...event.event_instances);
      else byId.set(event.id, { event, instances: [...event.event_instances] });
    }
    if (body.page.current >= body.page.total) break;
  }

  return [...byId.values()].map(({ event, instances }) => ({
    externalId: `localist:${event.id}:${event.updated_at}`,
    text: localistText(event, instances),
    url: event.localist_url,
    postedAt: event.created_at,
    raw: event,
  }));
}

function localistText(e: LocalistEvent, instances: LocalistEvent["event_instances"]): string {
  const dates = instances
    .map(({ event_instance: i }) => i.all_day ? `${i.start.slice(0, 10)} (all day)` : `${i.start} to ${i.end ?? "?"}`)
    .sort();
  const place = e.experience === "virtual"
    ? `Online${e.stream_url ? ` (${e.stream_url})` : ""}`
    : [e.location_name, e.room_number, e.address].map((s) => s?.trim()).filter(Boolean).join(", ");
  const price = e.ticket_cost?.trim() || (e.free ? "Free" : "");
  const link = e.ticket_url?.trim() || e.url?.trim();
  return [
    `Title: ${e.title}`,
    `Dates (each one is a separate occurrence):\n${dates.map((d) => `- ${d}`).join("\n")}`,
    place && `Where: ${place}`,
    price && `Price: ${price}`,
    e.groups?.length && `Hosted by: ${e.groups.map((g) => g.name).join(", ")}`,
    e.filters?.event_types?.length && `Type: ${e.filters.event_types.map((t) => t.name).join(", ")}`,
    link && `Tickets / info: ${link}`,
    e.photo_url && `Image: ${e.photo_url}`,
    e.description_text && `\n${e.description_text.trim()}`,
  ].filter(Boolean).join("\n");
}

// HTML to readable text. Keeps link targets, since event pages usually link to the details or tickets.
function pageText(html: string, baseUrl: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      try { return `${label} (${new URL(href, baseUrl).href})`; } catch { return label; }
    })
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/article|\/section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// A snippet of HTML (a feed summary, a JSON field) to plain text.
function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&rsquo;|&lsquo;/g, "'").replace(/&amp;/g, "&");
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve((req) => handleIngestRequest(req, "web", fetchPosts, ["city_calendar", "venue_website"]));
