# The iPhone app

The App Store app ("Comuna: Neighborhood Events", bundle ID `com.wearecomuna.app`) is the same `index.html`, packaged
with [Capacitor](https://capacitorjs.com). Nothing about the web app changes:

- `scripts/build-ios.mjs` copies the app into `ios-web/` and adds two scripts to that copy: Capacitor, and `native.js`,
  which switches location to the native iOS version (Comuna's own permission prompt) and sharing to the iOS share sheet.
- `ios/` is the Xcode project. Its settings: iPhone only, portrait only, the location prompt's wording, and
  "no special encryption" (so App Store Connect doesn't ask about export compliance).
- The service worker isn't used in the app; the app's files are already on the phone.

The app's files are inside the app, so **a change to `index.html` reaches iPhone users only with a new App Store
build**. Changes in Supabase (events, badges, rules) show up straight away, as on the web.

## One-time setup on the Mac

1. Install **Xcode** from the Mac App Store, open it once, and let it install its extras.
2. Install **Node.js** (the LTS version from nodejs.org).
3. Get the code: `git clone https://github.com/Comuna-Events/Comuna-app.git`, then `cd Comuna-app` and `npm install`.
4. In Xcode, go to **Xcode > Settings > Accounts** and sign in with your Apple Developer Apple ID.

## Build and try it

1. `npm run ios` (copies the latest app into the Xcode project), then `npm run ios:open` (opens Xcode).
2. In Xcode, click **App** in the left column > the **App** target > **Signing & Capabilities**. Tick
   **Automatically manage signing** and pick your name as the **Team**.
3. To try it: plug in your iPhone (or pick a simulator at the top of the window) and press **▶**. The first time on
   a real phone, approve it on the phone under Settings > General > VPN & Device Management, and turn on
   Settings > Privacy & Security > Developer Mode.

## Reminders (push notifications)

After someone saves their first plan, the app asks to send notifications. An hour before each saved plan starts,
`supabase/functions/send-reminders` sends "starts at 6:30 PM … check in when you get there", and tapping it opens the
event. The database runs it every 10 minutes (`supabase/push.sql`). It needs an Apple push key, once:

1. On developer.apple.com > **Certificates, IDs & Profiles** > **Keys** > **+**: name it `Comuna push`, tick
   **Apple Push Notifications service (APNs)**, then **Continue** > **Register** > **Download**. Apple lets you
   download the `.p8` file only once, so keep it safe.
2. In Supabase > **Edge Functions** > **Secrets**, add `APNS_KEY_ID` (the key's Key ID), `APNS_TEAM_ID` (your Team ID,
   top right of the developer site) and `APNS_KEY` (open the `.p8` in TextEdit and paste all of it).

The Xcode project already has the Push Notifications capability (`ios/App/App/App.entitlements`).

## App Review sign-in

Apple's reviewers can't receive emailed codes, so `appreview@wearecomuna.com` takes a fixed 8-digit code instead
(`supabase/functions/review-login`). Set the code as the `REVIEW_CODE` secret in Supabase > Edge Functions >
Secrets, and give both in App Store Connect > the app's version > **App Review Information** > **Sign-in required**
(user name: the address; password: the code). If a reviewer deletes the account, signing in again makes a new one.

## Upload to the App Store

1. `npm run ios`, so the build has the latest app.
2. In Xcode, pick **Any iOS Device (arm64)** at the top, then **Product > Archive**.
3. When the Organizer window opens: **Distribute App > App Store Connect > Distribute**.
4. About 15 minutes later the build appears in App Store Connect under **TestFlight**. Install the **TestFlight** app
   on your phone to try it, then add the build to the version on the **App Store** tab and **Submit for Review**.

For each update after that, raise the **Version** (e.g. 1.0 → 1.1) on the App target's **General** tab, then archive
and upload again. Uploading a second build of the same version needs a higher **Build** number instead.
