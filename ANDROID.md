# The Android app

The Google Play app ("Comuna: Neighborhood Events", package `com.wearecomuna.app`) is the same `index.html` as the
website and the iPhone app, packaged with [Capacitor](https://capacitorjs.com). See [IOS.md](IOS.md) for how the
packaging works; Android uses the same `ios-web/` copy and the same `native.js`.

What's different on Android:

- **Sign-in:** the email code and **Continue with Google** (the phone's Google account picker). No Sign in with
  Apple: Apple's rule that apps with Google sign-in must also offer Apple only applies to the App Store.
- **Directions** open Google Maps straight away (no Apple Maps to choose).
- **The back button and back gesture** close what's open, then go back a screen; on the first screen the app goes to
  the background, as Android apps do.
- **Reminders** go through Firebase Cloud Messaging instead of Apple's push service. Phones before Android 13 allow
  notifications without asking, so the app still waits for "Remind me" before sending any.
- `android/` is the Android Studio project: portrait only, the location and notification permissions, Comuna's icon
  (with a themed version for Android 13's matching icons) and the green launch screen.

Like the iPhone app, **a change to `index.html` reaches Android users only with a new Play build**.

## One-time setup on the Mac

1. Install **Android Studio** from developer.android.com/studio, open it once and let it install the Android SDK.
2. Node.js and the code are the same as for iPhone (IOS.md). After pulling, run `npm install`.

## Build and try it

1. `npm run android` (copies the latest app into the Android project), then `npm run android:open` (opens Android
   Studio). The first time, Android Studio downloads a lot; wait for "Gradle sync" to finish at the bottom.
2. To try it on a phone: on the phone, Settings > About phone > tap **Build number** 7 times, then Settings >
   System > Developer options > turn on **USB debugging**. Plug it in, allow the computer, pick the phone at the top
   of Android Studio and press **▶**. Or pick an emulator from **Device Manager**.

Google sign-in and reminders need the setup below; everything else works straight away.

## Google sign-in

Google checks that the app asking is really Comuna by its signing key's fingerprint (SHA-1). There are two keys, so
two Android clients:

1. **Your upload key** (signs the builds you upload, step 1 of "Upload to Google Play" below). Find its SHA-1 with
   `keytool -list -v -keystore ~/comuna-upload.jks -alias upload` and copy the `SHA1:` line.
2. **Google's app signing key** (Google re-signs what people download from Play). After your first upload: Play
   Console > the app > **Test and release > Setup > App signing** (or **App integrity**), and copy the **SHA-1
   certificate fingerprint** under "App signing key certificate".
3. For **each** SHA-1: console.cloud.google.com > the same project as the iPhone app > **Google Auth Platform >
   Clients > Create client > Android**. Package name `com.wearecomuna.app`, paste the SHA-1, **Create**. There's
   nothing to copy back: the app uses the existing web client ID in `native.js`, and Supabase already accepts it.
4. Debug builds (▶ from Android Studio) use a third key. To sign in with Google on those too, add one more Android
   client with the SHA-1 from `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`.

If "Continue with Google" says something went wrong, the SHA-1 for that build isn't added yet.

## Reminders (push notifications)

Android reminders go through Firebase. Until `android/app/google-services.json` exists, the app hides reminders
(registering without it would close the app).

1. console.firebase.google.com > **Add project** > pick the existing Google Cloud project (the one with the sign-in
   clients) > Google Analytics off > **Create**.
2. **Add app > Android**, package name `com.wearecomuna.app`, nickname `Comuna Android` > **Register app** >
   **Download google-services.json**. Put it in `android/app/` and commit it (it identifies the app; it isn't a
   secret). Skip the remaining Firebase steps: the project already has them.
3. **Project settings** (gear) > **Service accounts** > **Generate new private key** > **Generate key**. Keep the
   downloaded `.json` file safe: it can send notifications as Comuna.
4. Supabase > **Edge Functions** > **Secrets** > add `FCM_SERVICE_ACCOUNT`, and paste the whole service account
   `.json` file (not google-services.json).
5. `npm run android` and build again.

To check the secret, run the `send-reminders?check` call from `supabase/push.sql`: under `android`,
`INVALID_ARGUMENT` means it works (the test sends to a made-up phone).

## Upload to Google Play

You need a Google Play developer account (play.google.com/console, $25 once). A new **personal** account has to run
a **closed test with at least 12 testers for 14 days in a row** before it can publish to everyone, so start that as
soon as possible.

1. **Make the upload key (once).** In Android Studio: **Build > Generate Signed App Bundle or APK > Android App
   Bundle > Next > Create new…**. Save it as `~/comuna-upload.jks` (outside the project folder), set a password, alias
   `upload`, your name, 25+ years. **Back it up** (with the password) somewhere safe: every future update must be
   signed with it. (If it's ever lost, Play support can reset it, but it takes days.)
2. **Build.** Raise **versionCode** by 1 and set **versionName** in `android/app/build.gradle` (versionCode must
   go up with every upload; versionName is what people see, e.g. 1.0). `npm run android`, then **Build > Generate
   Signed App Bundle or APK > Android App Bundle**, pick the key, **release**, **Create**. The file lands in
   `android/app/release/app-release.aab`.
3. **Create the app** in Play Console: **Create app**, name "Comuna: Neighborhood Events", App, Free, accept the
   declarations.
4. **Closed test.** **Test and release > Testing > Closed testing > Create track** (or use "Alpha"). **Testers**:
   create an email list with at least 12 Google accounts (friends, family, early users) and copy the opt-in link for
   them. **Create new release**, upload the `.aab`, release name `1.0 (1)`, notes, **Save > Review > Start rollout**.
   Testers open the opt-in link, tap **Become a tester**, then install from the Play Store link. The 14 days start
   once 12 have opted in; they need to keep it installed.
5. **Store listing and the app content forms** (Play Console > **Grow users > Store presence** and **Policy and
   programs > App content**): see the answers in the shared store-assets folder.
6. **Production.** After 14 days, Play Console > **Dashboard** > **Apply for production** (a short questionnaire
   about the test). Once approved, **Production > Create new release**, promote the tested build, **Start rollout**.

For each update after that: raise `versionCode` (and `versionName`), build, upload to the track you want.
