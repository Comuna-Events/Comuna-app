# App Store listing: draft

Copy-ready text for App Store Connect → Comuna → **App Store** tab (version 1.0). Every field is within Apple's limit.

## App Information (applies to every version)

| Field | Value |
|---|---|
| Name (30) | `Comuna: Neighborhood Events` (27) |
| Subtitle (30) | `Local plans, a few blocks away` (30) |
| Primary category | Lifestyle |
| Secondary category | Entertainment |
| Content rights | No third-party content that needs rights. Events are public listings, linked to their source. |
| Age rating | Answer the questionnaire honestly. Expect **13+**: events include bars and DJ nights ("infrequent alcohol references"), and people can post content. This also matches the privacy policy's "not for children under 13". |

## Version 1.0

**Promotional text** (170, can be changed any time without review), 155 characters:

```
Markets, dinners, workshops, live music and pop-ups near you in Los Angeles. Save a plan, bring friends, check in and collect stamps for your neighborhood.
```

**Description** (4,000):

```
Your neighborhood has plans.

The best things happening in Los Angeles are often buried in social posts, newsletters and flyers, and you hear about them after they've happened. Comuna brings local markets, dinners, workshops, live music, pop-ups and neighborhood gatherings into one place: not everything across the city, just what's close enough and soon enough to become a real plan.

EXPLORE WHAT'S NEARBY
• One map of what's on near you tonight, this weekend or in the days ahead
• Your Top 4 every day: one of each kind of plan, close to you
• Filter by what you're into, from DJ nights to run clubs
• Four kinds of plans: Headliners worth the trip, weekly Staples, Hidden Gems that are easy to miss, and one-time Pop-ups

SAVE IT. BRING PEOPLE. GO.
• Tap "Interested" and the event lands in your Plans calendar
• Send the plan to friends from the share sheet
• Get a reminder an hour before it starts

FILL YOUR PASSPORT
• Check in when you arrive to earn a stamp for the neighborhood
• Unlock patches and titles as you explore
• Earn points and climb your neighborhood's leaderboard, or stay off it if you prefer

SHARE WHAT YOU FIND
• Add an event you know about and earn points when neighbors go
• Review the places you went to help others pick

Starting in Santa Monica, Silver Lake and Echo Park, with more of Los Angeles on the way.

Built by a small team in Los Angeles. We use your location only to show what's near you and confirm check-ins, and we never sell your information.
```

**Keywords** (100, comma-separated, no spaces after commas; Apple already indexes the name and subtitle, so those words aren't repeated), 99 characters:

```
los angeles,LA,things to do,nearby,local,markets,pop-up,live music,weekend,santa monica,silver lake
```

| Field | Value |
|---|---|
| Support URL | `https://www.wearecomuna.com/support` |
| Marketing URL | `https://www.wearecomuna.com` |
| Privacy Policy URL | `https://www.wearecomuna.com/privacy` |
| Copyright | `2026 Corrie Pickering` (change to the company name once there is one) |
| Price | Free |
| Availability | United States |
| Release | **Manually release this version** |

## Screenshots

Required size: **6.9" iPhone, 1320 × 2868** (Apple scales them down for smaller iPhones). Take them in the
**iPhone 16 Pro Max** (or newer Pro Max) simulator with **⌘S**, signed in to an account that has real stamps and
points, in Santa Monica. Use 3 to 10 screenshots, in this order (the first 3 show in search results):

1. **Map** with pins near you: "Your neighborhood has plans"
2. **Top 4 today**: "Four good plans, picked daily"
3. **An event** with photo, time and Interested button: "Save it. Bring people. Go."
4. **Plans calendar** with a few saved events: "Every plan in one place"
5. **Passport** with stamps and patches: "Check in. Collect the neighborhood."
6. **Leaderboard**: "Climb your neighborhood's board"

The captions are optional (overlaid text, e.g. with a free tool like AppLaunchpad or Figma). Plain screenshots are fine for 1.0.

## App Privacy (the "nutrition label")

**Tracking: No.** Comuna doesn't link data with other companies' data for ads, and there's no ad or analytics SDK.

Data collected, all **linked to the person** and **not used for tracking**:

| Apple's type | What it is in Comuna | Purposes |
|---|---|---|
| Contact Info → Name | Account name, leaderboard name | App Functionality |
| Contact Info → Email Address | Sign-in | App Functionality |
| Location → Coarse Location | Stored rounded to about half a mile; check-ins store distance, not position | App Functionality |
| User Content → Other User Content | Reviews, events people submit, event reports, nicknames | App Functionality |
| User Content → Customer Support | Feedback sent in the app | App Functionality |
| Identifiers → User ID | Account ID | App Functionality |
| Identifiers → Device ID | The random ID that keeps a guest's progress | App Functionality, Analytics |
| Search History | Searches in the app | App Functionality, Analytics |
| Usage Data → Product Interaction | Events viewed, saved, shared, directions tapped | App Functionality, Analytics |

Not collected: precise location (it's only used on the device or to check a check-in, never stored), contacts, photos,
payment info, health, diagnostics.

## App Review Information

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name | `appreview@wearecomuna.com` |
| Password | The 8-digit `REVIEW_CODE` secret in Supabase → Edge Functions → Secrets |
| Contact | Corrie Pickering, corrie@wearecomuna.com, phone number |

**Notes** (4,000):

```
Comuna helps people in Los Angeles find local events near them and turn them into plans.

Signing in: on the sign-in screen, enter appreview@wearecomuna.com, tap to get a code, then enter the 8-digit code above. This review account skips the emailed code. You can also browse as a guest without signing in.

Location: Comuna asks for location while in use, to show events nearby and to confirm check-ins. If you decline, you pick a neighborhood by hand and everything else works. Checking in only counts within about 600 m of the event, so it can't be tested from outside Los Angeles; the rest of the app (map, Top 4, saving plans, sharing, passport, leaderboard, adding an event) works anywhere.

Native features: location through iOS's own permission prompt, push notification reminders an hour before saved plans, Sign in with Apple and Google, and the iOS share sheet for inviting friends.

User-generated content: people can add events and write reviews. Events people submit appear for others only after our team approves them. Every shared event has a Report option: it disappears for the person who reported it straight away, and once two people report it, it's hidden for everyone until we review it. We can block people who post abusive content from sharing more.

Account deletion: Profile > Delete account deletes the account and its data immediately.
```

## Still to do before submitting

- [ ] Confirm `REVIEW_CODE` is set in Supabase and try signing in with it on the final TestFlight build.
- [ ] Privacy policy: add Sign in with Apple / Google and push notifications (it doesn't mention them yet), and
      change "monthly leaderboard" now that the boards are all-time.
- [ ] Website: change "monthly leaderboard" / "points this month" on the home and Passport pages.
- [ ] Take the screenshots on the final build.
- [ ] After approval: put the App Store ID in the website's Smart App Banner (commented out in the home page's `<head>`).
