// Checks for supabase/functions/ingest-handstamp/handstamp.ts: the mapping offline, then (with --live) the LA city
// page and Camber's profile read end to end. No database is touched.
// Run: node --experimental-strip-types scripts/test-ingest-handstamp.mjs [--live]   (behind a proxy, add NODE_USE_ENV_PROXY=1)
import assert from "node:assert/strict";
import { fetchPosts, htmlToText, listedEvents, skipReason, soldOut, toEvent } from "../supabase/functions/ingest-handstamp/handstamp.ts";
import { laDate } from "../supabase/functions/_shared/structured.ts";

const today = "2026-11-04";
const ev = (over = {}) => ({
  id: "Se8n", name: "Alana's Open Mic - Pacific Ave ", startDate: "2026-11-07T12:00:00", endDate: "2026-11-07T15:00:00",
  tz: "America/Los_Angeles", address: "2524 Pacific Ave, Venice, CA 90291, USA", locationName: "Alana's Coffee Roasters",
  lat: 33.982471, lng: -118.4677587, shortLink: "https://www.handstamp.com/e/alanas-open-mic", photoURL: "https://x/y.png",
  description: "<h2><strong>Join us for an open mic!</strong></h2><p>Free to attend &amp; sign up in person.</p>",
  isTicketed: true, tickets: [{ price: 0, isAvailable: true }], host: { fullName: "Alana’s Coffee Roasters" }, group: null,
  ...over,
});

assert.equal(skipReason(ev(), today), null);
assert.equal(skipReason(ev({ privacy: "private" }), today), "private");
assert.equal(skipReason(ev({ startDate: "2026-11-01T12:00:00" }), today), "date");
assert.equal(skipReason(ev({ address: "Venice Beach, CA 90291, USA" }), today), "no street address");
assert.equal(skipReason(ev({ lat: 40.7, lng: -74 }), today), "outside LA");
assert.equal(skipReason(ev({ address: "1 Main St, Irvine, CA 92614, USA", lat: 33.8, lng: -117.8 }), today), "outside LA County");

const e = toEvent(ev());
assert.equal(e.name, "Alana's Open Mic - Pacific Ave");
assert.equal(e.start_date, "2026-11-07");
assert.equal(e.start_time, "12:00");
assert.equal(e.end_time, "15:00");
assert.equal(e.street_address, "2524 Pacific Ave");
assert.equal(e.city, "Venice");
assert.equal(e.zip, "90291");
assert.equal(e.venue, "Alana's Coffee Roasters");
assert.equal(e.price_type, "Free");
assert.equal(e.host, "Alana’s Coffee Roasters");
assert.equal(e.category, "Arts & Entertainment");
assert.equal(e.description, "Join us for an open mic!\nFree to attend & sign up in person.".replace("\n", " "));
const paid = toEvent(ev({ tickets: [{ price: 300, isAvailable: true }, { price: 1500, isAvailable: true }, { price: 9900, isAvailable: false }],
  group: { fullName: "Camber" } }));
assert.equal(paid.price_type, "Paid");
assert.equal(paid.price_detail, "$3–$15");
assert.equal(paid.host, "Camber");
assert.ok(soldOut(ev({ tickets: [{ price: 300, isAvailable: false }] })));
assert.ok(!soldOut(ev()));
assert.equal(htmlToText("<p>a</p><p>b &amp; c</p>"), "a\nb & c");
await assert.rejects(listedEvents("https://www.handstamp.com/e/some-event/x"), /city page|profile/);
await assert.rejects(listedEvents("https://partiful.com/explore/la"), /handstamp/);
console.log("offline checks passed");

if (process.argv.includes("--live")) {
  const now = laDate();
  for (const handle of ["https://www.handstamp.com/d/los-angeles", "https://www.handstamp.com/camberplaces"]) {
    const started = Date.now();
    const posts = await fetchPosts({ id: 0, platform: "handstamp", handle, display_name: null, neighborhood: null, category: null, last_success_at: null });
    for (const p of posts) {
      const [x] = p.events;
      assert.ok(x.name && x.start_date >= now && /^\d/.test(x.street_address) && Number.isFinite(x.lat), x.name);
    }
    console.log(`${handle}: ${posts.length} posts in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      posts.slice(0, 6).map((p) => `${p.events[0].start_date} ${p.events[0].name} @ ${p.events[0].venue}, ${p.events[0].city} [${p.events[0].category}] (${p.events[0].price_detail ?? p.events[0].price_type}) by ${p.events[0].host}`));
  }
}
