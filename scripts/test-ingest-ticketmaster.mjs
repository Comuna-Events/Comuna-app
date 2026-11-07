// Checks for supabase/functions/ingest-ticketmaster/ticketmaster.ts: the search URL and the mapping offline (fixtures
// shaped like Discovery API v2 results), then (with --live and TICKETMASTER_API_KEY set) one real search read end to
// end. No database is touched.
// Run: node --experimental-strip-types scripts/test-ingest-ticketmaster.mjs [--live]
// (behind a proxy, add NODE_USE_ENV_PROXY=1)
import assert from "node:assert/strict";
import * as tm from "../supabase/functions/ingest-ticketmaster/ticketmaster.ts";

const today = "2026-11-07";

// Geohash (the API's geoPoint) for downtown LA.
assert.equal(tm.geohash(34.05, -118.25, 5), "9q5ct");
assert.equal(tm.geohash(57.64911, 10.40744, 11), "u4pruydqqvj");   // the textbook example

// Search URL: latlong becomes geoPoint; key, dates, order and size are filled in; #pages caps paging.
const { url, pages } = tm.searchUrl("https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.25&radius=20&segmentName=Music#pages=3", "KEY", today);
assert.equal(url.searchParams.get("geoPoint"), tm.geohash(34.05, -118.25, 7));
assert.equal(url.searchParams.get("latlong"), null);
assert.equal(url.searchParams.get("segmentName"), "Music");
assert.equal(url.searchParams.get("radius"), "20");
assert.equal(url.searchParams.get("startDateTime"), "2026-11-07T00:00:00Z");
assert.equal(url.searchParams.get("endDateTime"), "2027-02-05T23:59:59Z");
assert.equal(url.searchParams.get("size"), "200");
assert.equal(url.searchParams.get("sort"), "date,asc");
assert.equal(url.searchParams.get("apikey"), "KEY");
assert.equal(pages, 3);
assert.equal(tm.searchUrl("https://app.ticketmaster.com/discovery/v2/events.json?latlong=34,-118", "K", today).pages, 5);
assert.throws(() => tm.searchUrl("https://example.com/?latlong=34,-118", "K", today));
assert.throws(() => tm.searchUrl("https://app.ticketmaster.com/discovery/v2/events.json?segmentName=Music", "K", today));

const tmEvent = (over = {}, venue = {}) => ({
  id: "vvG1zZ9abc", name: "Khruangbin", url: "https://www.ticketmaster.com/khruangbin-los-angeles/event/0900ABC",
  info: "All ages.", pleaseNote: "No cameras.",
  dates: { start: { localDate: "2026-11-20", localTime: "20:00:00" }, status: { code: "onsale" }, timezone: "America/Los_Angeles" },
  priceRanges: [{ type: "standard", currency: "USD", min: 45.5, max: 129 }],
  classifications: [{ primary: true, segment: { name: "Music" }, genre: { name: "Rock" }, subGenre: { name: "Psychedelic" } }],
  images: [{ url: "https://s1.ticketm.net/small.jpg", ratio: "3_2", width: 305 }, { url: "https://s1.ticketm.net/big.jpg", ratio: "16_9", width: 2048 },
    { url: "https://s1.ticketm.net/fallback.jpg", ratio: "16_9", width: 4000, fallback: true }],
  _embedded: {
    venues: [{ name: "Hollywood Bowl", postalCode: "90068", address: { line1: "2301 N Highland Ave" }, city: { name: "Los Angeles" },
      state: { stateCode: "CA" }, location: { latitude: "34.1122", longitude: "-118.3391" }, ...venue }],
    attractions: [{ name: "Khruangbin" }, { name: "Men I Trust" }],
  },
  ...over,
});
assert.equal(tm.skipReason(tmEvent(), today), null);
assert.equal(tm.skipReason(tmEvent({ name: "Parking: Khruangbin" }), today), "add-on");
assert.equal(tm.skipReason(tmEvent({ name: "Khruangbin - VIP Package Upgrade" }), today), "add-on");
assert.equal(tm.skipReason(tmEvent({ dates: { start: { localDate: "2026-11-20" }, status: { code: "canceled" } } }), today), "canceled");
assert.equal(tm.skipReason(tmEvent({ dates: { start: { localDate: "2026-11-20" }, status: { code: "rescheduled" } } }), today), null);
assert.equal(tm.skipReason(tmEvent({ dates: { start: { localDate: "2026-11-01" }, status: { code: "onsale" } } }), today), "date");
assert.equal(tm.skipReason(tmEvent({}, { postalCode: "92614", name: "Irvine Amphitheater", location: { latitude: "33.6", longitude: "-117.7" } }), today), "outside LA County");
assert.equal(tm.skipReason(tmEvent({ _embedded: {} }), today), "no venue");

const ev = tm.toEvent(tmEvent(), ["2026-11-21"]);
assert.equal(ev.name, "Khruangbin");
assert.equal(ev.category, "Arts & Entertainment");
assert.deepEqual(ev.tags, ["Music", "Rock"]);
assert.equal(ev.start_date, "2026-11-20");
assert.equal(ev.start_time, "20:00");
assert.equal(ev.venue, "Hollywood Bowl");
assert.equal(ev.street_address, "2301 N Highland Ave");
assert.equal(ev.zip, "90068");
assert.equal(ev.price_type, "Paid");
assert.equal(ev.price_detail, "$45.50–$129");
assert.equal(ev.host, "Khruangbin, Men I Trust");
assert.equal(ev.lat, 34.1122);
assert.equal(ev.recurrence_detail, "Also on Nov 21");
assert.equal(ev.confidence, 0.9);
assert.ok(ev.description.startsWith("Music: Rock, Psychedelic."));
// Time to be announced; no price; a Miscellaneous listing falls back to keywords.
const misc = tm.toEvent(tmEvent({ name: "Holiday Night Market", priceRanges: undefined,
  classifications: [{ primary: true, segment: { name: "Miscellaneous" }, genre: { name: "Undefined" } }],
  dates: { start: { localDate: "2026-12-05", timeTBA: true }, status: { code: "onsale" } } }));
assert.equal(misc.start_time, null);
assert.equal(misc.price_detail, null);
assert.equal(misc.category, "Markets & Shopping");
assert.deepEqual(misc.tags, []);

console.log("ticketmaster mapping: ok");

if (process.argv.includes("--live")) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error("Set TICKETMASTER_API_KEY to run --live");
  globalThis.Deno = { env: { get: (k) => process.env[k] } };
  const posts = await tm.fetchPosts({ id: 0, platform: "ticketmaster", display_name: "test", neighborhood: null, category: null, last_success_at: null,
    handle: "https://app.ticketmaster.com/discovery/v2/events.json?latlong=34.05,-118.25&radius=20&segmentName=Music#pages=1" });
  console.log(`ticketmaster: ${posts.length} events`, posts.slice(0, 3).map((p) => p.events[0]));
}
