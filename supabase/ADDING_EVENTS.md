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
