// Helpers for platforms whose pages already carry the event as data (Luma, Meetup), so their functions build
// candidates themselves instead of asking the AI (see SourcePost.events in ingest.ts). Plain TypeScript with no
// Deno or database calls, so the platform modules that use it can be tested under Node (scripts/test-ingest-*.mjs).

/** How far ahead to look. auto_promote holds anything over 60 days out until it's closer. */
export const HORIZON_DAYS = 90;

// Southern California box from supabase/ADDING_EVENTS.md, narrowed to LA County and its edges.
export const inLaArea = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33.65 && lat <= 34.85 && lng >= -118.95 && lng <= -117.65;

// LA County zip codes: 900xx-918xx and the Antelope Valley's 935xx, minus the Orange County ones in that range
// (Buena Park to La Habra 90620-90633, Stanton 90680, Los Alamitos 90720-90721, Seal Beach 90740, Sunset Beach
// and Surfside 90742-90743; San Pedro 90731 and Paramount 90723 are LA County).
export function inLaCounty(zip: string): boolean {
  const z = Number(zip);
  if (!((z >= 90001 && z <= 91899) || (z >= 93510 && z <= 93599))) return false;
  return !((z >= 90620 && z <= 90633) || z === 90680 || z === 90720 || z === 90721 || z === 90740 || z === 90742 || z === 90743);
}

/** Today in Los Angeles, YYYY-MM-DD. */
export const laDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Within today .. today + HORIZON_DAYS. */
export const upcoming = (date: string | null, today = laDate()) =>
  !!date && date >= today && date <= addDays(today, HORIZON_DAYS);

/** An instant as the local date (YYYY-MM-DD) and 24-hour time (HH:MM) in the event's time zone. */
export function localParts(iso: string | null | undefined, tz = "America/Los_Angeles"): { date: string; time: string } | null {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const s = d.toLocaleString("sv-SE", { timeZone: tz, hourCycle: "h23" }); // "2026-11-08 11:00:00"
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** "$10", "$12.50", "$1,200". */
export const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** "$15" or "$15–$40" (or "Free–$40" when there are free tickets too). */
export const priceRange = (min: number, max = min) =>
  max === min ? money(min) : min === 0 ? `Free–${money(max)}` : `${money(min)}–${money(max)}`;

// "Comedy Night | Live DJ |" -> "Comedy Night | Live DJ"
export const cleanName = (name: string) =>
  name.replace(/\s+/g, " ").replace(/[\s|\-–—:/,·•]+$/, "").trim().slice(0, 140);

/** Markdown or plain text kept to its first few sentences (about 300 characters). */
export function summary(text: string | null | undefined, max = 300): string | null {
  if (!text) return null;
  const flat = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")   // [label](link) -> label
    .replace(/[*_#>`~]+/g, "")                    // markdown emphasis, headings, quotes
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 20);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 120 ? cut.slice(0, end + 1) : `${flat.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

const ENTITIES: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};
/** "Rock &amp; Roll &#8217;n&#x2019; more" -> "Rock & Roll ’n’ more" */
export const decodeHtml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) =>
    code[0] === "#"
      ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : ENTITIES[code.toLowerCase()] ?? m);

/** HTML (a WordPress or Localist description) as plain text, one line per paragraph. */
export const htmlText = (html: string | null | undefined) =>
  html ? decodeHtml(html.replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() || null : null;

/** Street, city and zip from "Venue, 24247 Village Cir Dr, Valencia, CA 91354" (any part may be missing). */
export function parseAddress(text: string | null | undefined): { street: string | null; city: string | null; zip: string | null } {
  const parts = (text ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const zip = (text ?? "").match(/\bCA\s+(\d{5})\b/i)?.[1] ?? null;
  const street = parts.find((p) => /^\d+\s+\S/.test(p) && !/^\d{5}$/.test(p)) ?? null;
  const stateAt = parts.findIndex((p) => /^CA(\s+\d{5})?$/i.test(p));
  const city = stateAt > 0 && parts[stateAt - 1] !== street ? parts[stateAt - 1] : null;
  return { street, city, zip };
}

// Public-body business rather than events: neighborhood council and city meetings, agendas, hearings.
const MEETING = /\b(board|committee|general|regular|special|governing|executive|budget|stakeholder|council|commission|subcommittee|plum|land use)\b[^|]*\bmeeting\b|\bmeeting\b[^|]*\b(board|committee|council|commission)\b|\b(agenda|public hearing|board of directors)\b/i;
export const isMeeting = (title: string) => MEETING.test(title);

export const ageFrom = (text: string) =>
  /\b21\s*\+|21 and over|21 & over/i.test(text) ? "21+" : /\b18\s*\+|18 and over/i.test(text) ? "18+" : null;

// Words that mark an event as not for the app: business and money, online, private, sold out or called off.
// (Same list as ingest-eventbrite.)
const SKIP_TEXT = new RegExp(
  "\\b(real estate|investor|investing|wealth|crypto|forex|trading|webinar|virtual|zoom|certification|certified|" +
    "cpr|bls|acls|notary|license exam|ce credits?|continuing education|career fair|job fair|hiring event|recruit|" +
    "seminar|summit|conference|bootcamp|mastermind|business owners?|entrepreneur|founders?|sales training|" +
    "marketing workshop|tax|credit repair|mortgage|insurance|medicare|retreat|private event|members only|" +
    "invite only|sold out|cancel+ed|postponed|bus trip|cruise)\\b",
  "i",
);
export const skipText = (text: string) => SKIP_TEXT.test(text);

// The app's six categories (see extract.ts), from keywords: the title first, then the start of the description,
// then the venue's name. Within each, the first category that matches wins; social formats come first, since
// "Trivia Night at Maydan Market" is trivia.
const CATEGORY_WORDS: [string, RegExp][] = [
  ["Community & Social", /\b(trivia|quiz|bingo|game night|board games?|speed dating|singles|book club|meetup|meet-up|mixer|social|hang|potluck|friendsgiving|mahjong|chess|ttrpg|d&d|volunteer\w*|cleanup|clean-up|networking|co-?working|language exchange)\b/i],
  ["Markets & Shopping", /\b(market|flea|thrift|swap|vintage|bazaar|makers? fair|craft fair|pop-?up shop|sample sale)\b/i],
  ["Active & Outdoors", /\b(run|runs|running|run club|5k|10k|hike|hiking|walk|walking|yoga|pilates|cycling|bike|ride|pickleball|tennis|volleyball|soccer|basketball|climb\w*|surf|swim|kayak|paddle|dance fitness|workout|bootcamp|sound bath|breathwork|meditat\w*)\b/i],
  ["Classes & Workshops", /\b(workshop|class|classes|masterclass|lesson|course|talk|lecture|panel|reading|author|paint\w*|pottery|ceramics|knit\w*|crochet|sewing|candle|craft\w*|cooking class|photography|writing|writers?)\b/i],
  ["Food & Drink", /\b(tasting|coffee|matcha|tea|wine|beer|brew\w*|supper|dinner|brunch|lunch|food|cocktail|bake\w*|happy hour)\b/i],
  ["Arts & Entertainment", /\b(comedy|comedians?|stand-?up|improv|show|concert|music|karaoke|jazz|dj|dance|film|screening|movie|cinema|gallery|exhibit\w*|art|theat\w*|opera|poetry|open mic|party|festival)\b/i],
];
export function guessCategory(title: string, description?: string | null, venue?: string | null): string {
  for (const text of [title, (description ?? "").slice(0, 400), venue ?? ""]) {
    const hit = CATEGORY_WORDS.find(([, words]) => words.test(text));
    if (hit) return hit[0];
  }
  return "Community & Social";
}

/**
 * One entry per event that's listed once per date (same name at the same place): the earliest, with the later
 * dates alongside. Once the earliest is over it drops out of the listing and the next one is picked up.
 */
export function nextDates<T>(items: T[], name: (t: T) => string, place: (t: T) => string, date: (t: T) => string) {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const groups = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => date(a).localeCompare(date(b)))) {
    const k = `${key(name(item))}@${key(place(item))}`;
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return [...groups.values()].map(([first, ...rest]) => ({
    item: first,
    laterDates: [...new Set(rest.map((r) => date(r).slice(0, 10)).filter((d) => d !== date(first).slice(0, 10)))],
  }));
}

/** "Also on Nov 15, Nov 22" for the dates after the one listed. */
export function alsoOn(dates: string[]): string | null {
  if (!dates.length) return null;
  const short = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Also on ${dates.slice(0, 6).map(short).join(", ")}${dates.length > 6 ? " and more" : ""}`;
}

/** Runs fn over items, `parallel` at a time, keeping the results in order. */
export async function inBatches<T, R>(items: T[], parallel: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += parallel) out.push(...await Promise.all(items.slice(i, i + parallel).map(fn)));
  return out;
}
