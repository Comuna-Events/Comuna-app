// Checks for supabase/functions/ingest-events-calendar/events-calendar.ts and ingest-localist/localist.ts: the mapping
// offline (fixtures shaped like real responses from palmsnc.la, laparent.com, calendar.usc.edu and
// calendar.santaclarita.gov), then (with --live) one real feed of each read end to end. No database is touched.
// Run: node --experimental-strip-types scripts/test-ingest-events-calendar-localist.mjs [--live]
// (behind a proxy, add NODE_USE_ENV_PROXY=1)
import assert from "node:assert/strict";
import * as tec from "../supabase/functions/ingest-events-calendar/events-calendar.ts";
import * as localist from "../supabase/functions/ingest-localist/localist.ts";
import { decodeHtml, htmlText, isMeeting, parseAddress } from "../supabase/functions/_shared/structured.ts";

const today = "2026-11-07";
const source = { display_name: "Palms Neighborhood Council", neighborhood: "Palms" };

// Shared helpers.
assert.equal(decodeHtml("Rock &amp; Roll &#8217;n&#x2019; more"), "Rock & Roll ’n’ more");
assert.equal(htmlText("<p>Hello&nbsp;<b>there</b></p><p>Second</p>"), "Hello there\nSecond");
assert.deepEqual(parseAddress("West Creek Park, 24247 Village Cir Dr, Valencia, CA 91354"),
  { street: "24247 Village Cir Dr", city: "Valencia", zip: "91354" });
assert.deepEqual(parseAddress("900 West 34th Street, Los Angeles, CA 90089"), { street: "900 West 34th Street", city: "Los Angeles", zip: "90089" });
assert.ok(isMeeting("PNC Board Meeting") && isMeeting("Land Use Committee Meeting") && isMeeting("Special Board Meeting Agenda"));
assert.ok(!isMeeting("Neighborhood Cleanup") && !isMeeting("Meet & Greet with Santa") && !isMeeting("Community Meetup"));

// The Events Calendar.
const tecEvent = (over = {}) => ({
  id: 245955, url: "https://www.laparent.com/event/all-abilities-resource-fair/", title: "All Abilities Resource Fair",
  description: "<p>Designed by families, for families, the 13th annual All Abilities Resource Fair gives families the opportunity to discover local resources.</p>",
  status: "publish", all_day: false, start_date: "2026-11-07 10:00:00", end_date: "2026-11-07 14:00:00",
  website: "", cost: "", cost_details: { values: [] }, image: { url: "https://www.laparent.com/x.jpg" },
  venue: { venue: "CSUN", address: "18111 Nordhoff St.", city: "Northridge", zip: "91330", country: "United States" },
  organizer: [], categories: [{ name: "Family" }],
  ...over,
});
assert.equal(tec.feedUrl("https://palmsnc.la", today).url.toString(),
  "https://palmsnc.la/wp-json/tribe/events/v1/events?per_page=50&start_date=2026-11-07&end_date=2027-02-05");
assert.equal(tec.feedUrl("https://www.cityofpasadena.net/parks-and-rec/wp-json/tribe/events/v1/events?per_page=50", today).url.pathname,
  "/parks-and-rec/wp-json/tribe/events/v1/events");
assert.equal(tec.feedUrl("https://southwestnc.org/wp-json/tribe/events/v1/events?per_page=50&start_date={today}&end_date={today+60}#pages=2", today).pages, 2);
assert.equal(tec.skipReason(tecEvent(), today), null);
assert.equal(tec.skipReason(tecEvent({ title: "PLUM Committee Meeting" }), today), "meeting");
assert.equal(tec.skipReason(tecEvent({ start_date: "2026-11-01 10:00:00" }), today), "date");
assert.equal(tec.skipReason(tecEvent({ title: "Parenting Webinar (Zoom)" }), today), "online");
assert.equal(tec.skipReason(tecEvent({ venue: { venue: "Irvine Spectrum", address: "1 Spectrum", city: "Irvine", zip: "92618" } }), today), "outside LA County");
assert.equal(tec.skipReason(tecEvent({ end_date: "2027-01-30 10:00:00" }), today), "long run");
const te = tec.toEvent(tecEvent(), source);
assert.equal(te.name, "All Abilities Resource Fair");
assert.equal(te.start_date, "2026-11-07");
assert.equal(te.start_time, "10:00");
assert.equal(te.end_time, "14:00");
assert.equal(te.venue, "CSUN");
assert.equal(te.street_address, "18111 Nordhoff St.");
assert.equal(te.zip, "91330");
assert.equal(te.confidence, 0.9);
assert.equal(te.ticket_url, "https://www.laparent.com/event/all-abilities-resource-fair/");
assert.equal(te.host, "Palms Neighborhood Council");
assert.ok(te.description.startsWith("Designed by families"));
// No venue (Palms' cleanup): kept for review, not promoted.
const noVenue = tec.toEvent(tecEvent({ title: "Neighborhood Cleanup", venue: [], all_day: false }), source);
assert.equal(noVenue.street_address, null);
assert.equal(noVenue.confidence, 0.6);
// All day, free, decoded title, organizer, cost range.
const allDay = tec.toEvent(tecEvent({ all_day: true, start_date: "2026-11-08 00:00:00", end_date: "2026-11-08 23:59:59",
  title: "Kids&#8217; Art Day", cost: "Free", organizer: [{ organizer: "Pasadena Parks &amp; Rec" }] }), source);
assert.equal(allDay.name, "Kids’ Art Day");
assert.equal(allDay.start_time, null);
assert.equal(allDay.price_type, "Free");
assert.equal(allDay.host, "Pasadena Parks & Rec");
const paid = tec.toEvent(tecEvent({ cost: "$10 – $25", cost_details: { values: ["10", "25"] } }), source);
assert.equal(paid.price_type, "Paid");
assert.equal(paid.price_detail, "$10–$25");
// Coordinates, when the venue has them.
const geo = tec.toEvent(tecEvent({ venue: { venue: "Palms Rec", address: "2950 Overland Ave", city: "Los Angeles", zip: "90064", geo_lat: "34.03", geo_lng: "-118.41" } }), source);
assert.equal(geo.lat, 34.03);
assert.equal(geo.lng, -118.41);

// Localist.
const lEvent = (over = {}) => ({
  id: 54223223317039, title: "Eco Media Film Fest x Impact Weekend", status: "live", private: false, experience: "inperson",
  localist_url: "https://calendar.usc.edu/event/eco-media-film-fest-x-impact-weekend", url: "https://www.uscimpact.org/",
  ticket_url: "https://www.uscimpact.org/", ticket_cost: "free", free: true,
  photo_url: "https://localist-images.azureedge.net/photos/54223223427649/huge/e77c.jpg",
  location_name: "School of Cinematic Arts - SCA (SCA)", address: "900 West 34th Street, Los Angeles, CA 90089", room_number: "",
  description_text: "IMPACT WEEKEND: WHERE MEDIA MEETS SOCIAL AND ENVIRONMENTAL IMPACT\nExplore impact-driven films, art and conversations.",
  geo: { zip: "90007", city: "Los Angeles", state: "CA", street: "900 West 34th Street", latitude: "34.023338", longitude: "-118.287199" },
  filters: { event_types: [{ name: "Sustainability" }], event_audience: [{ name: "Students" }, { name: "Alumni" }, { name: "Neighbors" }] },
  departments: [{ name: "School of Cinematic Arts" }],
  event_instances: [{ event_instance: { start: "2026-11-07T00:00:00-08:00", end: null, all_day: true } }],
  ...over,
});
assert.equal(localist.apiUrl("https://calendar.usc.edu/event/x").url.toString(), "https://calendar.usc.edu/api/2/events?days=90&pp=100");
assert.equal(localist.skipReason(lEvent(), today), null);
assert.equal(localist.skipReason(lEvent({ filters: { event_audience: [{ name: "Students" }, { name: "Faculty/Staff" }] } }), today), "not public");
assert.equal(localist.skipReason(lEvent({ filters: {} }), today), null);   // no audience listed: public
assert.equal(localist.skipReason(lEvent({ experience: "virtual" }), today), "online");
assert.equal(localist.skipReason(lEvent({ experience: "hybrid" }), today), null);
assert.equal(localist.skipReason(lEvent({ status: "canceled" }), today), "not live");
assert.equal(localist.skipReason(lEvent({ event_instances: [{ event_instance: { start: "2026-11-01T10:00:00-07:00" } }] }), today), "date");
const le = localist.toEvent(lEvent(), { display_name: "USC calendar", neighborhood: null }, today);
assert.equal(le.name, "Eco Media Film Fest x Impact Weekend");
assert.equal(le.start_date, "2026-11-07");
assert.equal(le.start_time, null);   // all day
assert.equal(le.venue, "School of Cinematic Arts - SCA");
assert.equal(le.street_address, "900 West 34th Street");
assert.equal(le.zip, "90007");
assert.equal(le.price_type, "Free");
assert.equal(le.lat, 34.023338);
assert.equal(le.host, "School of Cinematic Arts");
assert.equal(le.confidence, 0.9);
// Santa Clarita: no geo, address only in location_name; numeric cost; timed; repeated dates.
const scv = localist.toEvent(lEvent({
  title: "2nd Annual DIG DEEP DASH 5K Run/Walk", free: false, ticket_cost: "35", filters: {}, departments: [],
  localist_url: "https://calendar.santaclarita.gov/event/2nd-annual-dig-deep-dash", ticket_url: "https://runsignup.com/Race/CA/Valencia/DigDeepDash5KRunWalk",
  location_name: "West Creek Park, 24247 Village Cir Dr, Valencia, CA 91354", address: "", location: "West Creek Park, 24247 Village Cir Dr, Valencia, CA 91354",
  geo: { zip: null, city: null, street: null, latitude: null, longitude: null },
  event_instances: [
    { event_instance: { start: "2026-11-14T08:00:00-08:00", end: "2026-11-14T10:30:00-08:00", all_day: false } },
    { event_instance: { start: "2026-11-07T08:00:00-08:00", end: "2026-11-07T10:30:00-08:00", all_day: false } },
  ],
}), { display_name: "City of Santa Clarita", neighborhood: "Santa Clarita" }, today);
assert.equal(scv.venue, "West Creek Park");
assert.equal(scv.street_address, "24247 Village Cir Dr");
assert.equal(scv.city, "Valencia");
assert.equal(scv.zip, "91354");
assert.equal(scv.start_date, "2026-11-07");
assert.equal(scv.start_time, "08:00");
assert.equal(scv.end_time, "10:30");
assert.equal(scv.price_type, "Paid");
assert.equal(scv.price_detail, "$35");
assert.equal(scv.category, "Active & Outdoors");
assert.equal(scv.recurrence_detail, "Also on Nov 14");
assert.equal(scv.host, "City of Santa Clarita");
assert.equal(scv.lat, undefined);
assert.equal(localist.price({ ticket_cost: "$10 - $20" }).detail, "$10 - $20");

console.log("events-calendar + localist mapping: ok");

if (process.argv.includes("--live")) {
  const live = async (name, fetchPosts, handle) => {
    const posts = await fetchPosts({ id: 0, platform: name, handle, display_name: name, neighborhood: null, category: null, last_success_at: null });
    console.log(`${name} ${handle}: ${posts.length} events`, posts.slice(0, 3).map((p) => p.events[0]));
  };
  await live("events_calendar", tec.fetchPosts, "https://palmsnc.la");
  await live("localist", localist.fetchPosts, "https://calendar.usc.edu");
}
