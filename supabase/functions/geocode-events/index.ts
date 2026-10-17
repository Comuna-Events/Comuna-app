// Fills in events.lat / lng from the street address, so nobody has to look coordinates up by hand.
// The database calls this on its own whenever an event is added or its address changes (see ../../geocode.sql);
// each run picks up every event that has an address but no coordinates yet.
//
// Lookups use the US Census geocoder: free, no key, and the results are public domain, so we can keep them.
// (Mapbox's free lookups can't be saved and the app's key only works on our website; OpenStreetMap's
// Nominatim refuses requests from Supabase's servers.) Addresses with no street number ("Main St") or that
// the Census doesn't know stay blank, and the app looks those up on the phone as before. To place one by
// hand, type its lat / lng in Table Editor.
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

type Row = { event_id: string; street_address: string; city: string | null; zip: string | null };
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

// The whole address first, then the street with just the zip, then with just the city: the Census often misses
// a neighborhood used as the city ("Venice") or a wrong zip, and finds the other way round.
async function locate(r: Row): Promise<Point | null> {
  const e = encodeURIComponent, city = r.city || "Los Angeles";
  const tries = [`onelineaddress?address=${e([r.street_address, city, "CA", r.zip].filter(Boolean).join(", "))}`];
  if (r.zip) tries.push(`address?street=${e(r.street_address)}&state=CA&zip=${e(r.zip)}`);
  tries.push(`address?street=${e(r.street_address)}&city=${e(city)}&state=CA`);
  for (const q of tries) {
    try {
      const p = await census(q);
      if (!p || !inArea(p.lat, p.lng)) continue;
      if (sameStreet(r.street_address, p.parts, p.matched)) return { lat: p.lat, lng: p.lng };
      console.warn(`${r.event_id}: "${r.street_address}" matched "${p.matched}", a different street; skipped`);
    } catch (err) { console.warn(`lookup failed: ${err}`); }   // try the next one
  }
  return null;
}

Deno.serve(async (req) => {
  const { data: secret } = await db.rpc("geocode_events_secret");
  if (!secret || req.headers.get("x-geocode-secret") !== secret) return new Response("Not allowed", { status: 401 });

  const started = Date.now();
  const { data: rows, error } = await db.from("events").select("event_id,street_address,city,zip")
    .is("lat", null).not("street_address", "is", null).neq("street_address", "").order("created_at", { ascending: false }).limit(1000);
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
      const { error: e } = await db.from("events").update({ lat: p.lat, lng: p.lng })
        .eq("event_id", r.event_id).eq("street_address", r.street_address).is("lat", null);
      if (e) notFound.push(r.event_id); else filled.push(r.event_id);
    }
  }));

  const summary = { checked: filled.length + notFound.length, filled: filled.length, not_found: notFound,
    left_for_next_run: rows.length - filled.length - notFound.length };
  console.log(JSON.stringify(summary));
  return Response.json(summary);
});
