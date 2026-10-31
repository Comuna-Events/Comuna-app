# Adding events to Comuna

For anyone (person or AI) who writes events straight into the `events` table.

## Every event needs a location

Fill in `lat` and `lng` for every event you add. Check-ins are verified by the database
(`supabase/checkin_verify.sql`), which measures the distance to the coordinates stored on the event.
An event without them still shows in the app, but nobody can check in to it.

- Coordinates are decimal degrees in WGS84, e.g. `lat 34.0562`, `lng -118.2365`.
- They should point at the entrance or the middle of the venue, within about 100 m. Check-in allows 400 m.
- Every Comuna event is in Southern California: `lat` between 33.2 and 35.0, `lng` between -119.6 and -116.8.
  Anything outside that is a wrong match.
- Put the pin on the actual spot for big places. "Santa Monica Pier (west end)" is the west end, not the
  pier's street address. For a walking route or street fair, use where it starts.
- If an event has no fixed place ("various locations citywide", porch tours), it can't have check-ins:
  leave it out, or pick the main hub and say so in `notes`.
- Use coordinates you're allowed to keep: your own lookup, OpenStreetMap / Nominatim, the US Census
  geocoder, or a paid geocoder that permits storage. Mapbox's free geocoding results can't be saved.

If you leave `lat` / `lng` empty, the database tries the US Census geocoder on its own
(`supabase/geocode.sql`). It can't place addresses without a street number or landmarks like
"200 Santa Monica Pier", so don't rely on it.

## Changing an address

Set `lat` and `lng` **in the same update** as `street_address`, `city` or `zip`. When the address changes and
the coordinates don't, the database clears them on purpose (the old pin would be wrong), and the event
loses its location if the Census can't place the new address.

## Fill in price, photo and times

Event cards show these, so fill them whenever the event's page states them. Leave a field empty rather
than guess.

- `price_type`: `Free`, `Paid` or `Donation / Pay-what-you-can`.
- `price_detail`: the price exactly as stated, kept short: `$15`, `$20–40`, `$10 suggested donation`,
  `$25 adv / $30 door`. Leave it empty for free events.
- `image_url`: the full `https://` address of the event's own photo, usually the page's `og:image` (or the
  `image` in its schema.org event data). Not a bare filename, not the site's logo, and not a photo from
  a page that lists many events. The app credits it to `source_url` and links back.
- `start_time` and `end_time`: 24-hour `HH:MM`. Cards show "9 AM–2 PM" when both are there.
- `source_url`: the event's own page, so the photo credit and "Found on" link go to the right place.

## Check after each run

This should return no rows. Anything it lists can't be checked into until it has coordinates:

```sql
select event_id, name, venue, street_address, city
from events
where (lat is null or lng is null)
  and coalesce(end_date, start_date) >= (now() at time zone 'America/Los_Angeles')::date
  and coalesce(status, '') !~* '(past|archiv|cancel)'
order by start_date;
```

And this lists upcoming paid events still missing an amount, and events without a usable photo:

```sql
select event_id, name, price_type, price_detail, image_url, source_url
from events
where coalesce(end_date, start_date) >= (now() at time zone 'America/Los_Angeles')::date
  and coalesce(status, '') !~* '(past|archiv|cancel)'
  and ((price_type is distinct from 'Free' and price_detail is null) or coalesce(image_url, '') !~ '^https?://')
order by start_date;
```
