# The iPhone app

The App Store app ("Comuna: Neighborhood Events", bundle ID `com.wearecomuna.app`) is the same `index.html`, packaged
with [Capacitor](https://capacitorjs.com). Nothing about the web app changes:

- `scripts/build-ios.mjs` copies the app into `ios-web/` and adds two scripts to that copy: Capacitor, and `native.js`,
  which switches location to the native iOS version (Comuna's own permission prompt) and sharing to the iOS share sheet.
- `ios/` is the Xcode project. Its settings: iPhone only, portrait only, the location prompt's wording, and
  "no special encryption" (so App Store Connect doesn't ask about export compliance).
- The service worker isn't used in the app; the app's files are already on the phone.
- The app carries its own copies of the Supabase library and the fonts (the website loads them from the internet), so
  sign-in and syncing work even if the phone has no signal at launch. When you change the supabase-js version in
  `index.html`, change it in `package.json` too; `npm run ios` stops with a message if they differ.

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

iOS shows its "Allow notifications?" prompt only once, so the app asks in its own words first: the "RSVP saved" card
offers "Get a heads-up an hour before?" on a signed-in person's first 3 saves, and only "Remind me" brings up Apple's
prompt. **Profile > Reminders** turns them on or off on this phone (off forgets the phone's token), and when they're
blocked in iPhone Settings it opens Comuna's page there. Guests can't get reminders, since the token needs an account.
An hour before each saved plan starts,
`supabase/functions/send-reminders` sends "starts at 6:30 PM … check in when you get there", and tapping it opens the
event. The database runs it every 10 minutes (`supabase/push.sql`). It needs an Apple push key, once:

1. On developer.apple.com > **Certificates, IDs & Profiles** > **Keys** > **+**: name it `Comuna push`, tick
   **Apple Push Notifications service (APNs)**, then **Continue** > **Register** > **Download**. Apple lets you
   download the `.p8` file only once, so keep it safe.
2. In Supabase > **Edge Functions** > **Secrets**, add `APNS_KEY_ID` (the key's Key ID), `APNS_TEAM_ID` (your Team ID,
   top right of the developer site) and `APNS_KEY` (open the `.p8` in TextEdit and paste all of it).

The Xcode project already has the Push Notifications capability (`ios/App/App/App.entitlements`).

## Sign in with Apple and Google

In the app, the sign-up and sign-in screen offers **Continue with Apple** and **Continue with Google** above the email
code. They use the phone's own sign-in sheets (Face ID for Apple, Google's account picker) through the
`@capgo/capacitor-social-login` plugin. `native.js` gets an identity token, and `index.html` hands it to Supabase
(`signInWithIdToken`). The website keeps the email code only.

Someone who already has an account by email code and picks Apple or Google with the **same email** lands in that same
account (Supabase links them). Apple's **Hide My Email** gives a private relay address instead, so that person gets a
new account.

The Apple button works once steps 1–3 are done. The Google button stays hidden until steps 4–8 are done, because the
Google SDK closes the app if its settings are missing. Apple requires Sign in with Apple whenever Google sign-in is
offered, so never ship Google without it.

**Apple** (developer.apple.com and Supabase)

1. On developer.apple.com > **Certificates, IDs & Profiles** > **Identifiers** > `com.wearecomuna.app`: tick
   **Sign in with Apple** > **Save**. The Xcode project already has the capability (`ios/App/App/App.entitlements`).
   If Xcode then shows a signing error, untick and re-tick **Automatically manage signing** so it fetches a new
   profile.
2. In Supabase > **Authentication** > **Sign In / Providers** > **Apple**: turn it on and put `com.wearecomuna.app` in
   **Client IDs**. Leave the secret key empty: it's only for signing in on a website.
3. So people using Hide My Email still get Comuna's emails: on developer.apple.com > **Services** > **Sign in with
   Apple for Email Communication** > **Configure**, add the domain and address Supabase sends from (Supabase >
   **Authentication** > **Emails** > **SMTP Settings**), and follow Apple's steps to verify the domain (an SPF
   record).

**Google** (console.cloud.google.com and Supabase)

4. Make a project (or pick one), then go to **Google Auth Platform** > **Branding**: app name `Comuna`, your support
   email, `wearecomuna.com` under **Authorized domains**, and the privacy policy link
   (`https://www.wearecomuna.com/privacy`). Under **Audience**, pick **External** and **Publish app**. Until it's
   published, only listed test users can sign in.
5. **Clients** > **Create client** > **iOS**, bundle ID `com.wearecomuna.app`. Copy its **Client ID** and **iOS URL
   scheme** (the client ID reversed, starting `com.googleusercontent.apps.`).
6. **Clients** > **Create client** > **Web application**, name `Comuna Supabase`, and under **Authorized redirect URIs**
   add `https://sjxxiammvvfxcnukkqhg.supabase.co/auth/v1/callback`. Copy its **Client ID** and **Client secret**.
7. In Supabase > **Authentication** > **Sign In / Providers** > **Google**: turn it on. In **Client IDs**, put the web
   client ID, a comma, then the iOS client ID. Paste the web **Client secret**. Leave **Skip nonce checks** off.
8. In the code (already done for Comuna's clients; redo it only if you make new ones. Client IDs aren't secret, so
   they're fine in the repo; the client secret only ever goes in Supabase):
   - `native.js`: fill in `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_WEB_CLIENT_ID`.
   - `ios/App/App/Info.plist`: add the iOS URL scheme from step 5:
     ```xml
     <key>CFBundleURLTypes</key>
     <array>
       <dict>
         <key>CFBundleURLSchemes</key>
         <array>
           <string>com.googleusercontent.apps.YOUR-IOS-CLIENT-ID</string>
         </array>
       </dict>
     </array>
     ```
   Then `npm run ios` and build again.

The first build after adding the plugin downloads Google's sign-in library, so Xcode takes a minute longer. If Xcode
says a package is missing, use **File > Packages > Reset Package Caches**.

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
