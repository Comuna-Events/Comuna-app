// Checks for supabase/functions/ingest-eventbrite/eventbrite.ts: the mapping offline, then (with --live) one real
// search page read end to end. No database is touched.
// Run: node --experimental-strip-types scripts/test-ingest-eventbrite.mjs [--live]
import assert from "node:assert/strict";
import {
  category, cleanCity, cleanName, cleanVenue, fetchPosts, inLaCounty, laDate, nextDates, pageUrls, price, searchResults,
  skipReason, toEvent,
} from "../supabase/functions/ingest-eventbrite/eventbrite.ts";

const today = "2026-11-04";
const listing = (over = {}) => ({
  id: "1", name: "Sip & Sculpt (Clay Workshop) |", summary: "Make a mug.", start_date: "2026-11-08", end_date: "2026-11-08",
  start_time: "14:00", end_time: "16:00", url: "https://www.eventbrite.com/e/sip-sculpt-tickets-1?aff=x",
  tags: [{ prefix: "EventbriteCategory", display_name: "Hobbies & Special Interest" },
    { prefix: "EventbriteFormat", display_name: "Class, Training, or Workshop" }],
  locations: [{ type: "locality", name: "Los Angeles" }, { type: "neighbourhood", name: "Historic Core" }],
  image: { original: { url: "https://img.evbuc.com/x.jpg" } },
  primary_venue: { name: "Clay Space", address: { address_1: "123 S Main St", city: "LOS ANGELES", postal_code: "90012",
    latitude: "34.05", longitude: "-118.25" } },
  ...over,
});

// Handles become numbered pages; anything but an Eventbrite search page is refused.
assert.deepEqual(pageUrls("https://www.eventbrite.com/d/ca--los-angeles/trivia/#pages=2"), [
  "https://www.eventbrite.com/d/ca--los-angeles/trivia/?page=1", "https://www.eventbrite.com/d/ca--los-angeles/trivia/?page=2"]);
assert.equal(pageUrls("https://www.eventbrite.com/d/ca--los-angeles/all-events/").length, 3);
assert.equal(pageUrls("https://www.eventbrite.com/d/ca--los-angeles/all-events/#pages=50").length, 10);
assert.throws(() => pageUrls("https://www.eventbrite.com/e/some-event-123"), /search page/);
assert.throws(() => pageUrls("https://partiful.com/explore/la"), /search page/);

// The page data is read from window.__SERVER_DATA__; a page without it fails loudly.
const page = `<script>window.__SERVER_DATA__ = ${JSON.stringify({ search_data: { events: {
  results: [listing()], pagination: { page_count: 4 } } } })};\n</script>`;
assert.equal(searchResults(page, "u").results[0].id, "1");
assert.equal(searchResults(page, "u").pageCount, 4);
// The real pages assign more after it in the same script.
assert.equal(searchResults(page.replace("\n</script>", '\n    window.__REACT_QUERY_STATE__ = {"a":"b;"};\n</script>'), "u").pageCount, 4);
assert.throws(() => searchResults("<html></html>", "u"), /no page data/);
assert.throws(() => searchResults(`<script>window.__SERVER_DATA__ = {};</script>`, "u"), /no search results/);

// Filters.
assert.equal(skipReason(listing(), today), null);
assert.equal(skipReason(listing({ is_online_event: true }), today), "online");
assert.equal(skipReason(listing({ start_date: "2026-11-01" }), today), "date");
assert.equal(skipReason(listing({ start_date: "2027-03-01" }), today), "date");
assert.equal(skipReason(listing({ end_date: "2027-01-20" }), today), "long run");
assert.equal(skipReason(listing({ name: "Real Estate Investing Night" }), today), "keyword");
assert.equal(skipReason(listing({ tags: [{ prefix: "EventbriteCategory", display_name: "Business & Professional" }] }), today), "category");
const venue = (address) => ({ primary_venue: { name: "X", address: { latitude: "34.05", longitude: "-118.25", ...address } } });
assert.equal(skipReason(listing(venue({ address_1: "Grand Park" })), today), "no street address");
assert.equal(skipReason(listing(venue({ address_1: "1 Main St", postal_code: "92801" })), today), "outside LA County");
assert.equal(skipReason(listing({ primary_venue: { name: "X", address: { address_1: "1 Main", latitude: "32.7", longitude: "-117.1" } } }), today), "outside LA");
assert.ok(inLaCounty("90012") && inLaCounty("93550") && !inLaCounty("90630") && !inLaCounty("92614"));

// One entry per repeated event, keeping the next date.
const repeats = nextDates([listing({ id: "3", start_date: "2026-11-22" }), listing({ id: "2", start_date: "2026-11-15" }),
  listing(), listing({ id: "9", name: "Other show" })]);
assert.equal(repeats.length, 2);
assert.equal(repeats[0].listing.id, "1");
assert.deepEqual(repeats[0].laterDates, ["2026-11-15", "2026-11-22"]);

// Prices as the buyer sees them; no ticket info stays empty.
const tickets = (lo, hi, extra = {}) => ({ ticket_availability: {
  minimum_ticket_price: lo == null ? null : { major_value: lo }, maximum_ticket_price: hi == null ? null : { major_value: hi }, ...extra } });
assert.deepEqual(price(tickets("0.00", "0.00")), { type: "Free", detail: null });
assert.deepEqual(price(tickets("12.51", "12.51")), { type: "Paid", detail: "$12.51" });
assert.deepEqual(price(tickets("0.00", "44.52")), { type: "Paid", detail: "Free–$44.52" });
assert.deepEqual(price(tickets("25.00", "1469.07")), { type: "Paid", detail: "$25–$1,469.07" });
assert.deepEqual(price({}), { type: null, detail: null });

// The whole candidate.
const event = toEvent(listing(), { ...tickets("35.00", "35.00"), primary_organizer: { name: "Clay Space LA" } }, ["2026-11-15"]);
assert.equal(event.name, "Sip & Sculpt (Clay Workshop)");
assert.equal(event.category, "Classes & Workshops");
assert.equal(event.city, "Los Angeles");
assert.equal(event.neighborhood, "Downtown LA");
assert.equal(event.price_detail, "$35");
assert.equal(event.host, "Clay Space LA");
assert.equal(event.ticket_url, "https://www.eventbrite.com/e/sip-sculpt-tickets-1");
assert.equal(event.recurrence_detail, "Also on Nov 15");
assert.equal(event.end_date, null);
assert.equal(event.lat, 34.05);
assert.deepEqual(event.tags, ["Class, Training, or Workshop"]);
assert.equal(toEvent(listing({ primary_venue: { name: "The Pier", address: { ...listing().primary_venue.address, city: "Santa Monica" } } }), {}).neighborhood, "Santa Monica");
assert.equal(toEvent(listing({ name: "Club Night 21+" }), {}).age, "21+");

// Smaller pieces.
assert.equal(category(listing({ name: "Rose Bowl Flea Market", tags: [] })), "Markets & Shopping");
assert.equal(category(listing({ name: "Friday Jazz", tags: [{ prefix: "EventbriteCategory", display_name: "Music" }] })), "Arts & Entertainment");
assert.equal(category(listing({ name: "Turkey Trot 5K", tags: [{ prefix: "EventbriteCategory", display_name: "Sports & Fitness" }] })), "Active & Outdoors");
assert.equal(category(listing({ name: "Neighborhood Potluck", tags: [] })), "Community & Social");
assert.equal(category(listing({ name: "Trivia Night at Compass Rose at Maydan Market", tags: [] })), "Community & Social");
assert.equal(category(listing({ name: "Head Games Trivia Night", tags: [{ prefix: "EventbriteCategory", display_name: "Music" }] })), "Community & Social");
assert.equal(cleanCity("Los A ngeles"), "Los Angeles");
assert.equal(cleanCity("BURBANK"), "Burbank");
assert.equal(cleanCity("Culver"), "Culver City");
assert.equal(cleanName("  AFROVIBES | Live DJ |  "), "AFROVIBES | Live DJ");
assert.equal(cleanVenue("Broadwater Black Box, 6322 Santa Monica Boulevard, Los Angeles, CA, USA"), "Broadwater Black Box");
assert.equal(cleanVenue("Smith, Jones & Co"), "Smith, Jones & Co");
console.log("offline checks passed");

if (process.argv.includes("--live")) {
  const started = Date.now();
  const posts = await fetchPosts({ id: 0, platform: "eventbrite", handle: "https://www.eventbrite.com/d/ca--los-angeles/trivia/#pages=2",
    display_name: null, neighborhood: null, category: null, last_success_at: null });
  assert.ok(posts.length > 0, "a live trivia search should find something");
  for (const p of posts) {
    const [e] = p.events;
    assert.match(p.externalId, /^eventbrite:\d+$/);
    assert.ok(e.name && e.start_date >= laDate(new Date()) && /^\d/.test(e.street_address) && Number.isFinite(e.lat), e.name);
    assert.ok(["Food & Drink", "Arts & Entertainment", "Classes & Workshops", "Active & Outdoors", "Markets & Shopping",
      "Community & Social"].includes(e.category));
  }
  console.log(`live: ${posts.length} posts in ${((Date.now() - started) / 1000).toFixed(1)}s, e.g.`,
    posts.slice(0, 3).map((p) => `${p.events[0].start_date} ${p.events[0].name} @ ${p.events[0].venue} (${p.events[0].price_detail ?? p.events[0].price_type})`));
}
