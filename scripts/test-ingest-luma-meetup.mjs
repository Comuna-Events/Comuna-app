// Checks for supabase/functions/ingest-luma/luma.ts, ingest-meetup/meetup.ts and _shared/structured.ts: the mapping
// offline, then (with --live) one real search on each site read end to end. No database is touched.
// Run: node --experimental-strip-types scripts/test-ingest-luma-meetup.mjs [--live]
// (behind a proxy, add NODE_USE_ENV_PROXY=1)
import assert from "node:assert/strict";
import * as luma from "../supabase/functions/ingest-luma/luma.ts";
import * as meetup from "../supabase/functions/ingest-meetup/meetup.ts";
import { guessCategory, inLaCounty, laDate, localParts, nextDates, priceRange, summary } from "../supabase/functions/_shared/structured.ts";

const today = "2026-11-04";
const CATEGORIES = ["Food & Drink", "Arts & Entertainment", "Classes & Workshops", "Active & Outdoors", "Markets & Shopping", "Community & Social"];

// Shared helpers.
assert.ok(inLaCounty("90012") && inLaCounty("90731") && inLaCounty("90723") && !inLaCounty("90630") && !inLaCounty("90740") && !inLaCounty("92614"));
assert.deepEqual(localParts("2026-11-08T02:00:00.000Z"), { date: "2026-11-07", time: "18:00" });
assert.deepEqual(localParts("2026-11-04T05:30:00-08:00"), { date: "2026-11-04", time: "05:30" });
assert.equal(priceRange(55, 88), "$55–$88");
assert.equal(priceRange(0, 20), "Free–$20");
assert.equal(priceRange(12.5), "$12.50");
assert.equal(summary("**Join us** for [trivia](https://x.com) night!"), "Join us for trivia night!");
assert.ok(summary("word ".repeat(200)).length <= 302);
assert.equal(guessCategory("Trivia Night at Maydan Market"), "Community & Social");
assert.equal(guessCategory("Sunday Morning Run Club"), "Active & Outdoors");
assert.equal(guessCategory("Clay Magnets", "A pottery workshop"), "Classes & Workshops");
assert.equal(guessCategory("Friday Jazz on the Patio"), "Arts & Entertainment");
assert.equal(guessCategory("Something"), "Community & Social");
const grouped = nextDates([{ n: "Yoga", p: "Park", d: "2026-11-11" }, { n: "Yoga", p: "Park", d: "2026-11-04" }, { n: "Run", p: "Park", d: "2026-11-05" }],
  (x) => x.n, (x) => x.p, (x) => x.d);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].item.d, "2026-11-04");
assert.deepEqual(grouped[0].laterDates, ["2026-11-11"]);

// Luma.
const entry = (over = {}, ev = {}) => ({
  api_id: "evt-1",
  event: { api_id: "evt-1", name: "Art Social Hour: Clay Magnets", start_at: "2026-11-08T02:00:00.000Z", end_at: "2026-11-08T04:30:00.000Z",
    timezone: "America/Los_Angeles", url: "entropy.claymagnets", cover_url: "https://images.lumacdn.com/x.jpg", location_type: "offline",
    visibility: "public", coordinate: { latitude: 33.851, longitude: -118.389 },
    geo_address_info: { mode: "shown", address: "The Slice & Pint", city: "Redondo Beach",
      full_address: "The Slice & Pint, 601 N Pacific Coast Hwy, Redondo Beach, CA 90277, USA", short_address: "601 N Pacific Coast Hwy, Redondo Beach" },
    ...ev },
  hosts: [{ name: "Entropy Creatives" }],
  ticket_info: { is_free: false, price: { cents: 5500 }, max_price: { cents: 8800 } },
  ...over,
});
assert.equal(luma.skipReason(entry(), today), null);
assert.equal(luma.skipReason(entry({}, { location_type: "online" }), today), "online");
assert.equal(luma.skipReason(entry({}, { geo_address_info: { mode: "obfuscated", city: "Los Angeles" } }), today), "address hidden");
assert.equal(luma.skipReason(entry({}, { coordinate: { latitude: 33.68, longitude: -117.82 },
  geo_address_info: { mode: "shown", full_address: "1 Main St, Irvine, CA 92614, USA" } }), today), "outside LA County");
assert.equal(luma.skipReason(entry({ ticket_info: { is_sold_out: true } }), today), "sold out");
assert.equal(luma.skipReason(entry({}, { start_at: "2026-11-01T02:00:00.000Z" }), today), "date");
assert.deepEqual(luma.address(entry()), { venue: "The Slice & Pint", street: "601 N Pacific Coast Hwy", city: "Redondo Beach", zip: "90277" });
const le = luma.toEvent(entry(), "Make clay magnets. Paint them. Take them home.", ["2026-11-14"]);
assert.equal(le.start_date, "2026-11-07");
assert.equal(le.start_time, "18:00");
assert.equal(le.end_time, "20:30");
assert.equal(le.venue, "The Slice & Pint");
assert.equal(le.price_type, "Paid");
assert.equal(le.price_detail, "$55–$88");
assert.equal(le.ticket_url, "https://luma.com/entropy.claymagnets");
assert.equal(le.recurrence_detail, "Also on Nov 14");
assert.equal(le.host, "Entropy Creatives");
assert.equal(le.lat, 33.851);
assert.equal(luma.toEvent(entry({ ticket_info: { is_free: true } }), null).price_type, "Free");
assert.equal(luma.toEvent(entry({ ticket_info: { price: { cents: 1000, is_flexible: true } } }), null).price_type, "Donation / Pay-what-you-can");
assert.equal(luma.mirrorText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "there" }] },
  { type: "paragraph", content: [{ type: "text", text: "Second." }] }] }), "Hello there\nSecond.");
await assert.rejects(luma.searchEntries("https://luma.com/los-angeles"), /discover link/);

// Meetup.
const mev = (over = {}) => ({
  id: "317190254", title: "Yoga Asana & Meditation", dateTime: "2026-11-05T05:30:00-08:00", endTime: "2026-11-05T07:45:00-08:00",
  eventUrl: "https://www.meetup.com/ashwin/events/317190254/", eventType: "PHYSICAL", description: "**Morning** yoga and breathwork.",
  venue: { name: "Ashwin College", address: "111 S Kenwood Street", city: "Glendale", state: "CA", postalCode: "91205", lat: 34.1458, lon: -118.2515 },
  group: { name: "Kriya Meditation" }, feeSettings: null, featuredEventPhoto: { highResUrl: "https://secure.meetupstatic.com/x.jpeg" },
  ...over,
});
assert.equal(meetup.skipReason(mev(), today), null);
assert.equal(meetup.skipReason(mev({ eventType: "ONLINE" }), today), "online");
assert.equal(meetup.skipReason(mev({ venue: { ...mev().venue, address: "Griffith Park" } }), today), "no street address");
assert.equal(meetup.skipReason(mev({ title: "Real Estate Investor Night" }), today), "keyword");
const me = meetup.toEvent(mev(), ["2026-11-12"]);
assert.equal(me.start_date, "2026-11-05");
assert.equal(me.start_time, "05:30");
assert.equal(me.venue, "Ashwin College");
assert.equal(me.price_type, "Free");
assert.equal(me.category, "Active & Outdoors");
assert.equal(me.description, "Morning yoga and breathwork.");
assert.equal(me.host, "Kriya Meditation");
const whole = meetup.toEvent(mev({ venue: { name: "3741 West 27th Street", address: "3741 W 27th St, Los Angeles, CA 90018, USA", city: "Los Angeles", postalCode: "90018", lat: 34.03, lon: -118.32 }, feeSettings: { amount: 10 } }));
assert.equal(whole.street_address, "3741 W 27th St");
assert.equal(whole.venue, "3741 W 27th St");
assert.equal(whole.price_detail, "$10");
await assert.rejects(meetup.searchEvents("https://www.meetup.com/find/?location=us--ca--Los%20Angeles"), /find link/);
console.log("offline checks passed");

if (process.argv.includes("--live")) {
  const now = laDate();
  for (const [name, mod, handle] of [["luma", luma, "https://luma.com/discover?lat=34.05&lng=-118.24#pages=2"],
                                     ["meetup", meetup, "https://www.meetup.com/find/?lat=34.05&lon=-118.24#pages=2"]]) {
    const started = Date.now();
    const posts = await mod.fetchPosts({ id: 0, platform: name, handle, display_name: null, neighborhood: null, category: null, last_success_at: null });
    assert.ok(posts.length > 10, `${name}: a live search should find events`);
    for (const p of posts) {
      const [e] = p.events;
      assert.ok(e.name && e.start_date >= now && /^\d/.test(e.street_address) && Number.isFinite(e.lat) && CATEGORIES.includes(e.category), `${name}: ${e.name}`);
    }
    const withText = posts.filter((p) => p.events[0].description).length;
    console.log(`${name}: ${posts.length} posts (${withText} with a description) in ${((Date.now() - started) / 1000).toFixed(1)}s, e.g.`,
      posts.slice(0, 4).map((p) => `${p.events[0].start_date} ${p.events[0].name} @ ${p.events[0].venue}, ${p.events[0].city} [${p.events[0].category}] (${p.events[0].price_detail ?? p.events[0].price_type})`));
  }
}
