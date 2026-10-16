// Nightly ingest: public web pages. Covers every event_sources row with platform city_calendar or
// venue_website, where handle is the page's URL (a city / library calendar, a venue's events page, a blog
// that lists events...). Everything else (AI reading, saving candidates, the run log) is in ../_shared.
//
// Works as is: it downloads the page, turns it into plain text and lets the AI find the events.
// The page is only re-read when its text changes, and events we already have are skipped.
// Improve it per site where that pays off, e.g. read a calendar's iCal / RSS feed instead of its HTML.
// Special cases so far: Localist calendar APIs (handle is the .../api/2/events URL), see localistPosts.

import { handleIngestRequest, type Source, type SourcePost } from "../_shared/ingest.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; ComunaEventBot/1.0)";

async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const url = source.handle;
  if (/\/api\/2\/events\b/.test(new URL(url).pathname)) return localistPosts(url);

  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);

  const text = pageText(await res.text(), url);
  if (text.length < 200) {
    throw new Error("Page has almost no text; it probably loads its events with JavaScript. Look for a feed or API.");
  }
  // A new id whenever the page's text changes, so an unchanged page isn't read (or paid for) again.
  return [{ externalId: `${url}#${await shortHash(text)}`, text, url }];
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

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve((req) => handleIngestRequest(req, "web", fetchPosts, ["city_calendar", "venue_website"]));
