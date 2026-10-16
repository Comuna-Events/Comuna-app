// Fills in events.lat / lng from the street address, so nobody has to look coordinates up by hand.
// The database calls this on its own whenever an event is added or its address changes (see ../../geocode.sql);
// each run picks up every event that has an address but no coordinates yet.
//
// Lookups: the US Census geocoder first (free, no key, results are public domain), then OpenStreetMap's
// Nominatim for addresses the Census doesn't know (1 request a second, results may be stored with credit).
// Mapbox isn't used here: its free lookups can't be saved, and the app's key only works on our website.
// Events that still can't be found stay blank, and the app looks them up on the phone as before.
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
type Point = { lat: number; lng: number; by: string };

async function census(address: string): Promise<Point | null> {
  const url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address="
    + encodeURIComponent(address);
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  const c = (await res.json())?.result?.addressMatches?.[0]?.coordinates;
  return c ? { lat: c.y, lng: c.x, by: "census" } : null;
}

let lastNominatim = 0;
async function nominatim(address: string): Promise<Point | null> {
  const wait = lastNominatim + 1100 - Date.now();   // their limit is one request a second
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" + encodeURIComponent(address);
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  const hit = (await res.json())?.[0];
  return hit ? { lat: +hit.lat, lng: +hit.lon, by: "openstreetmap" } : null;
}

async function locate(r: Row): Promise<Point | null> {
  const address = [r.street_address, r.city || "Los Angeles", "CA", r.zip].filter(Boolean).join(", ");
  for (const lookup of [census, nominatim]) {
    try {
      const p = await lookup(address);
      if (p && inArea(p.lat, p.lng)) return p;
    } catch (_) { /* try the next one */ }
  }
  return null;
}

Deno.serve(async (req) => {
  const { data: secret } = await db.rpc("geocode_events_secret");
  if (!secret || req.headers.get("x-geocode-secret") !== secret) return new Response("Not allowed", { status: 401 });

  const started = Date.now();
  const { data: rows, error } = await db.from("events").select("event_id,street_address,city,zip")
    .is("lat", null).not("street_address", "is", null).neq("street_address", "").order("event_id").limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const filled: string[] = [], notFound: string[] = [];
  let next = 0;
  // a few Census lookups at a time; Nominatim fallbacks queue up behind their one-a-second limit
  await Promise.all(Array.from({ length: 5 }, async () => {
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
