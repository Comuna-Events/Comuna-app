// Fills in events.lat / lng from the street address, so nobody has to look coordinates up by hand.
// The database calls this on its own whenever an event is added or its address changes (see ../../geocode.sql);
// each run picks up every event that has an address or venue but no coordinates yet.
//
// Lookups use the US Census geocoder first: free, no key, and the results are public domain, so we can keep them.
// (Mapbox's free lookups can't be saved and the app's key only works on our website; OpenStreetMap's
// Nominatim refuses requests from Supabase's servers.) When the Census can't place it, Photon (photon.komoot.io,
// OpenStreetMap data, ODbL, so it can be kept too) gets the street address and then the venue's name: landmarks
// like "200 Santa Monica Pier" or "O'Brien's Irish Pub" that the Census doesn't know. Photon asks for gentle use,
// so its lookups go one at a time, about a second apart.
//
// Check-in is verified against these coordinates (../../checkin_verify.sql), so an event left blank can't be
// checked in to, even though the app still shows its pin from a lookup on the phone. Vague venues ("Various
// locations", "meeting point given at booking") stay blank on purpose. To place one by hand, type its lat / lng
// in Table Editor.
//
// The Census matches loosely: with no "Santa Monica Pier" street it answers "200 Santa Monica Blvd", and for
// "N Highland Ave" it answered "Highland Dr" miles away. So a match only counts when it's the street we asked
// for (see sameStreet); otherwise the event stays blank for the phone to place.
//
// Deploy:  npx supabase functions deploy geocode-events --project-ref sjxxiammvvfxcnukkqhg --no-verify-jwt
// (--no-verify-jwt because it checks the x-geocode-secret header itself; the value lives in Supabase Vault.)

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const TIME_BUDGET_MS = 110_000;   // edge functions get ~150s; leftovers are picked up by the next run
const UA = "ComunaEvents/1.0 (https://comuna-events.github.io)";
// Southern California, generously: anything outside is a wrong match, not one of our events
const inArea = (lat: number, lng: number) => lat > 33.2 && lat < 35.0 && lng > -119.6 && lng < -116.8;

type Row = { event_id: string; street_address: string | null; venue: string | null; city: string | null; zip: string | null };
type Point = { lat: number; lng: number };
type Parts = { streetName?: string; suffixType?: string; preDirection?: string };

// street words the way the Census writes them: "W. Third Street" -> W 3RD ST
const TYPES: Record<string, string> = { STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", DRIVE: "DR", ROAD: "RD",
  PLACE: "PL", PLAZA: "PLZ", LANE: "LN", COURT: "CT", PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", CIRCLE: "CIR",
  ALLEY: "ALY", SQUARE: "SQ", TRAIL: "TRL", PROMENADE: "PROM", PIER: "PIER", PARK: "PARK", WAY: "WAY", WALK: "WALK" };
const TYPE_ABBR = new Set(Object.values(TYPES).concat(["ST", "AVE", "BLVD", "DR", "RD", "PL", "PLZ", "LN", "CT", "PKWY", "HWY", "TER", "CIR", "ALY", "SQ", "TRL"]));
const ORDINALS: Record<string, string> = { FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH",
  SIXTH: "6TH", SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH" };
const DIRS: Record<string, string> = { N: "N", S: "S", E: "E", W: "W", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
const words = (s: string) => s.toUpperCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean)
  .map((w) => TYPES[w] ?? ORDINALS[w] ?? w);

// is the Census match on the street we asked for? Its street name has to be in our address, and our street type
// (Ave, Pier...) and direction (N, W...) can't disagree with its own. A type or direction we left out is fine.
// Intersections ("Sunset Blvd & Micheltorena St") come back without parts: each street in the match has to be
// one we named.
function sameStreet(street: string, m: Parts, matched: string): boolean {
  const ours = words(street.split(",")[0]);
  const find = (name: string[]) => ours.findIndex((_, i) => name.every((n, k) => ours[i + k] === n));
  if (!m.streetName) {
    const sides = matched.split(",")[0].split(" & ");
    return sides.length > 1 && sides.every((side) => {
      const w = words(side);
      if (DIRS[w[0]]) w.shift();
      if (w.length > 1 && TYPE_ABBR.has(w[w.length - 1])) w.pop();
      return w.length > 0 && find(w) >= 0;
    });
  }
  const name = words(m.streetName), at = find(name);
  if (at < 0) return false;
  const type = ours[at + name.length], theirs = m.suffixType && (TYPES[m.suffixType] ?? m.suffixType);
  if (type && TYPE_ABBR.has(type) && theirs && type !== theirs) return false;
  const dir = DIRS[ours[1]];
  if (at > 1 && dir && m.preDirection && dir !== m.preDirection) return false;
  return true;
}

const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/";
async function census(query: string): Promise<(Point & { parts: Parts; matched: string }) | null> {
  const res = await fetch(CENSUS + query + "&benchmark=Public_AR_Current&format=json",
    { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) { console.warn(`census answered ${res.status}`); return null; }
  const m = (await res.json())?.result?.addressMatches?.[0];
  return m?.coordinates ? { lat: m.coordinates.y, lng: m.coordinates.x, parts: m.addressComponents || {}, matched: m.matchedAddress } : null;
}

// ---------- Photon (OpenStreetMap) ----------
type PhotonHit = Point & { name?: string; housenumber?: string; street?: string; osmKey?: string };
let photonQueue: Promise<unknown> = Promise.resolve();
// one request at a time, ~1.1s apart, and one retry when it's busy (it answers 503 to bursts)
function photon(q: string): Promise<PhotonHit | null> {
  const run = async (): Promise<PhotonHit | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise((ok) => setTimeout(ok, attempt ? 3000 : 1100));
      try {
        const res = await fetch("https://photon.komoot.io/api/?limit=1&lat=34.05&lon=-118.3&bbox=-119.6,33.2,-116.8,35.0&q=" +
          encodeURIComponent(q), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
        if (res.status === 503 || res.status === 429) continue;
        if (!res.ok) { console.warn(`photon answered ${res.status}`); return null; }
        const f = (await res.json())?.features?.[0];
        if (!f?.geometry?.coordinates) return null;
        const p = f.properties || {};
        return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: p.name, housenumber: p.housenumber,
          street: p.street, osmKey: p.osm_key };
      } catch (err) { console.warn(`photon lookup failed: ${err}`); }
    }
    return null;
  };
  const p = photonQueue.then(run, run);
  photonQueue = p.catch(() => null);
  return p;
}

// words that say what kind of place it is, not which one ("Montrose Community Park" vs "Montrose Shopping Park"
// differ only in the words that aren't on this list)
const GENERIC = new Set(["THE", "OF", "AT", "AND", "&", "A", "PARK", "ST", "AVE", "BLVD", "DR", "RD", "WAY", "CA",
  "SCHOOL", "ELEMENTARY", "LIBRARY", "BRANCH", "CENTER", "CENTRE", "RESTAURANT", "BAR", "CAFE", "INC", "CO"]);
const sig = (s: string) => words(s.replace(/['’]/g, "")).filter((w) => !GENERIC.has(w));
// the place Photon found is the venue we asked for: every telling word of its name is in our venue's name, and it
// isn't just one word of several ("Society" for "Movement Society"). The city's name doesn't count either way.
function sameVenue(venue: string, found: string | undefined, city: string): boolean {
  if (!found) return false;
  const cityWords = new Set(sig(city)), notCity = (w: string) => !cityWords.has(w);
  const ours = new Set(sig(venue).filter(notCity)), theirs = sig(found).filter(notCity);
  if (!theirs.length || !theirs.every((w) => ours.has(w))) return false;
  return theirs.length > 1 || ours.size === 1;
}
// "Third Street Promenade (between Arizona Ave...)" -> "Third Street Promenade"; "Library - Main / Pico" -> "Library"
const venueName = (v: string) => v.replace(/\(.*?\)/g, "").split(/ - |,| \/ /)[0].trim();
const VAGUE = /various|citywide|across|meeting point|emailed|registrants|tba|tbd|online|virtual/i;

async function photonLocate(r: Row): Promise<Point | null> {
  const city = r.city || "Los Angeles";
  // the address: only when Photon finds that exact house number on that street
  const num = r.street_address?.match(/^\s*(\d+)\s+(.+)$/);
  if (num) {
    const p = await photon(`${r.street_address}, ${city}, CA`);
    if (p && inArea(p.lat, p.lng) && p.housenumber === num[1] && p.street) {
      const ours = new Set(words(num[2])), theirs = words(p.street).filter((w) => !TYPE_ABBR.has(w) && !DIRS[w]);
      if (theirs.length && theirs.every((w) => ours.has(w))) return p;
    }
  }
  // the venue by name, if it names one place (not a street, which can run for miles)
  const name = r.venue && !VAGUE.test(r.venue) ? venueName(r.venue) : "";
  if (name.length > 3) {
    const p = await photon(`${name}, ${city}, CA`);
    if (p && inArea(p.lat, p.lng) && p.osmKey !== "highway" && sameVenue(name, p.name, city)) return p;
    if (p) console.warn(`${r.event_id}: venue "${name}" found "${p.name ?? "?"}", not the same place; skipped`);
  }
  return null;
}

// The whole address first, then the street with just the zip, then with just the city: the Census often misses
// a neighborhood used as the city ("Venice") or a wrong zip, and finds the other way round. Then Photon.
async function locate(r: Row): Promise<Point | null> {
  const e = encodeURIComponent, city = r.city || "Los Angeles";
  const tries: string[] = [];
  if (r.street_address) {
    tries.push(`onelineaddress?address=${e([r.street_address, city, "CA", r.zip].filter(Boolean).join(", "))}`);
    if (r.zip) tries.push(`address?street=${e(r.street_address)}&state=CA&zip=${e(r.zip)}`);
    tries.push(`address?street=${e(r.street_address)}&city=${e(city)}&state=CA`);
  }
  for (const q of tries) {
    try {
      const p = await census(q);
      if (!p || !inArea(p.lat, p.lng)) continue;
      if (sameStreet(r.street_address!, p.parts, p.matched)) return { lat: p.lat, lng: p.lng };
      console.warn(`${r.event_id}: "${r.street_address}" matched "${p.matched}", a different street; skipped`);
    } catch (err) { console.warn(`lookup failed: ${err}`); }   // try the next one
  }
  const p = await photonLocate(r);
  return p && { lat: p.lat, lng: p.lng };
}

Deno.serve(async (req) => {
  const { data: secret } = await db.rpc("geocode_events_secret");
  if (!secret || req.headers.get("x-geocode-secret") !== secret) return new Response("Not allowed", { status: 401 });

  const started = Date.now();
  const { data: rows, error } = await db.from("events").select("event_id,street_address,venue,city,zip")
    .is("lat", null).or("street_address.neq.,venue.neq.").order("created_at", { ascending: false }).limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const filled: string[] = [], notFound: string[] = [];
  let next = 0;
  // newest events first, so addresses the Census never finds don't hold up new ones; several lookups at a time
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (next < rows.length && Date.now() - started < TIME_BUDGET_MS) {
      const r = rows[next++] as Row;
      const p = await locate(r);
      if (!p) { notFound.push(r.event_id); continue; }
      // only if the address is still the one we looked up (someone may have edited it meanwhile)
      let q = db.from("events").update({ lat: p.lat, lng: p.lng }).eq("event_id", r.event_id).is("lat", null);
      q = r.street_address ? q.eq("street_address", r.street_address) : q.is("street_address", null);
      const { error: e } = await q;
      if (e) notFound.push(r.event_id); else filled.push(r.event_id);
    }
  }));

  const summary = { checked: filled.length + notFound.length, filled: filled.length, not_found: notFound,
    left_for_next_run: rows.length - filled.length - notFound.length };
  console.log(JSON.stringify(summary));
  return Response.json(summary);
});
