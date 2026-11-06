// Meetup, read for the nightly ingest. index.ts hands fetchPosts to the shared ingest; everything here is plain
// fetch and mapping, so scripts/test-ingest-luma-meetup.mjs can run it under Node.
//
// A source's handle is a point to search around, written as Meetup's find link:
//   https://www.meetup.com/find/?lat=34.05&lon=-118.24          (downtown LA)
// It reads up to 8 pages of 50 in-person events (#pages=N to change), soonest first.
//
// Meetup's site loads its search results from its GraphQL API (www.meetup.com/gql2), which answers the same query
// without signing in: name, time, venue, address, coordinates, fee, group, photo and description. If Meetup changes
// it, the source fails with a clear error in event_sources.last_error.
//
// No AI: toEvent maps the data straight onto a candidate (category from keywords, see guessCategory). Left out:
// online events, no venue or street address, outside LA County, more than 90 days out, and business keywords.
// Most Meetup groups repeat an event weekly; only its next date is kept, and once that's over the next is picked up.

import type { ExtractedEvent } from "../_shared/extract.ts";
import type { Source, SourcePost } from "../_shared/ingest.ts";
import {
  ageFrom, alsoOn, cleanName, guessCategory, inLaArea, inLaCounty, laDate, localParts, money, nextDates, skipText,
  summary, upcoming,
} from "../_shared/structured.ts";

const GRAPHQL = "https://www.meetup.com/gql2";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const DEFAULT_PAGES = 8;

// The start date goes in as a literal: its GraphQL type isn't one the schema lets a variable name.
const query = (start: string) => `query($lat: Float!, $lon: Float!, $after: String) {
  recommendedEvents(filter: { lat: $lat, lon: $lon, eventType: PHYSICAL, startDateRange: ${JSON.stringify(start)}, doConsolidateEvents: true },
                    sort: { sortField: DATETIME }, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title dateTime endTime eventUrl eventType description
      series { description }
      venue { name address city state postalCode lat lon }
      group { name urlname }
      feeSettings { amount currency }
      featuredEventPhoto { highResUrl }
    } }
  }
}`;

/** An event as the API returns it (only the fields asked for). */
export interface MeetupEvent {
  id: string;
  title: string;
  dateTime: string;
  endTime?: string | null;
  eventUrl: string;
  eventType?: string;
  description?: string | null;
  series?: { description?: string | null } | null;
  venue?: { name?: string; address?: string; city?: string; state?: string; postalCode?: string; lat?: number; lon?: number } | null;
  group?: { name?: string; urlname?: string } | null;
  feeSettings?: { amount?: number; currency?: string } | null;
  featuredEventPhoto?: { highResUrl?: string } | null;
}

export async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const events = await searchEvents(source.handle);
  if (!events.length) throw new Error("No events around this point; Meetup may have changed its API.");
  const today = laDate();
  const kept = nextDates(events.filter((e) => !skipReason(e, today)),
    (e) => e.title, (e) => e.venue?.address ?? e.venue?.name ?? "", (e) => e.dateTime);
  return kept.map(({ item, laterDates }) => {
    const event = toEvent(item, laterDates);
    return {
      externalId: `meetup:${item.id}`,
      text: [`Title: ${event.name}`, `When: ${event.start_date} ${event.start_time ?? ""}`,
        `Where: ${[event.venue, event.street_address, event.city, event.zip].filter(Boolean).join(", ")}`,
        `Price: ${event.price_detail ?? event.price_type}`, `Group: ${event.host ?? ""}`, `Link: ${event.ticket_url}`,
        event.description ? `\n${event.description}` : ""].join("\n"),
      url: event.ticket_url,
      imageUrls: item.featuredEventPhoto?.highResUrl ? [item.featuredEventPhoto.highResUrl] : [],
      raw: { ...item, description: item.description?.slice(0, 2000) },
      events: [event],
    };
  });
}

/** The handle's point, searched page by page from now on. */
export async function searchEvents(handle: string): Promise<MeetupEvent[]> {
  const url = new URL(handle.trim());
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon") ?? url.searchParams.get("lng"));
  if (!/(^|\.)meetup\.com$/.test(url.hostname) || !Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !lon) {
    throw new Error("Handle must be a Meetup find link with a point, e.g. https://www.meetup.com/find/?lat=34.05&lon=-118.24");
  }
  const pages = Math.min(20, Math.max(1, Number(url.hash.match(/pages=(\d+)/)?.[1] ?? DEFAULT_PAGES)));
  const start = `${laDate()}T00:00:00-08:00[US/Pacific]`;
  const found: MeetupEvent[] = [];
  let after: string | null = null;
  for (let page = 0; page < pages; page++) {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { "user-agent": USER_AGENT, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: query(start), variables: { lat, lon, after } }),
    });
    if (!res.ok) throw new Error(`Meetup's API answered ${res.status}`);
    const body = await res.json() as {
      data?: { recommendedEvents?: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: { node: MeetupEvent }[] } };
      errors?: { message: string }[];
    };
    const list = body.data?.recommendedEvents;
    if (!list) throw new Error(`Meetup's API answered without events: ${body.errors?.[0]?.message ?? "no data"}`);
    found.push(...list.edges.map((e) => e.node));
    if (!list.pageInfo.hasNextPage) break;
    after = list.pageInfo.endCursor;
  }
  return [...new Map(found.map((e) => [e.id, e])).values()];
}

/** Why an event is left out, or null to keep it. */
export function skipReason(e: MeetupEvent, today: string): string | null {
  const v = e.venue ?? {};
  const street = streetOf(e);
  if (e.eventType && e.eventType !== "PHYSICAL") return "online";
  if (!inLaArea(v.lat ?? NaN, v.lon ?? NaN)) return "outside LA";
  if (v.postalCode && !inLaCounty(v.postalCode)) return "outside LA County";
  if (!upcoming(localParts(e.dateTime)?.date ?? null, today)) return "date";
  if (!street) return "no street address";
  if (skipText(e.title)) return "keyword";
  return null;
}

// Meetup's address is either the street ("111 S Kenwood Street") or the whole line
// ("3741 W 27th St, Los Angeles, CA 90018, USA"); the venue's name is sometimes just the street again.
const streetOf = (e: MeetupEvent) => {
  const first = (e.venue?.address ?? "").split(",")[0].trim();
  return /^\d/.test(first) ? first : null;
};

/** An event as a candidate, field by field. */
export function toEvent(e: MeetupEvent, laterDates: string[] = []): ExtractedEvent & { lat: number; lng: number } {
  const v = e.venue ?? {};
  const start = localParts(e.dateTime), end = localParts(e.endTime);
  const street = streetOf(e);
  const venueName = v.name?.trim() && v.name.trim() !== street && !/^\d/.test(v.name.trim()) ? v.name.trim() : null;
  const name = cleanName(e.title);
  const text = e.description ?? e.series?.description ?? null;
  const fee = e.feeSettings?.amount;
  return {
    name,
    description: summary(text),
    category: guessCategory(name, text, venueName),
    tags: [],
    vibes: [],
    start_date: start?.date ?? null,
    end_date: end && start && end.date !== start.date ? end.date : null,
    start_time: start?.time ?? null,
    end_time: end?.time ?? null,
    recurrence: "One-off",
    recurrence_detail: alsoOn(laterDates) ?? (e.series ? "Repeats; one of several dates on Meetup" : null),
    venue: venueName ?? street,
    street_address: street,
    city: v.city?.trim() || null,
    zip: v.postalCode || null,
    neighborhood: v.city?.trim() || null,
    setting: null,
    // no Meetup fee isn't proof it's free: many groups charge at the door ("$20 cash fee"), so a description that names
    // a price leaves the type empty for backfill-details to read from the page rather than calling it Free
    price_type: fee ? "Paid" : /\$\s?\d/.test(`${name} ${text ?? ""}`) ? null : "Free",
    price_detail: fee ? money(fee) : null,
    rsvp_required: true,
    ticket_url: e.eventUrl.split("?")[0],
    age: ageFrom(`${name} ${text ?? ""}`),
    host: e.group?.name?.trim() || null,
    confidence: 0.9, // Meetup's own structured data, not read from a caption
    notes: null,
    lat: v.lat!,
    lng: v.lon!,
  };
}
