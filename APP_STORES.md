# Releasing the app to the stores

How a release of the bikes.pizza app reaches the App Store and Google
Play. The website, functions and Studio are deployed by GitHub Actions
when a release is published (see README.md); the app builds are made and
uploaded by hand from a Mac, as described here. Nothing in this file is
automated on purpose.

## Before either store

- Merge the version-bump pull request and publish the GitHub release
  (`vX.Y.Z`). The bump sets `version: X.Y.Z+N` in `pubspec.yaml`; `N` is
  the build number both stores see, and each upload needs a higher one.
- Build from a clean checkout of `main` at that tag, with the local
  config file the app is built with:

  ```sh
  git checkout vX.Y.Z
  flutter pub get
  ```

  `config/local.json` (git-ignored; see README, "Build-time
  configuration") must be present. Release builds use the production
  Firebase project automatically (`lib/main.dart`); no flag is needed.

## iOS: App Store Connect

One-time setup on a new Mac:

1. Sign in to Xcode with the Apple Developer account (Xcode, Settings,
   Accounts).
2. Open `ios/Runner.xcworkspace`, select the Runner target, Signing &
   Capabilities, tick "Automatically manage signing" and choose the
   company team. Xcode creates the distribution certificate and
   provisioning profile, and confirms the App ID's capabilities (Sign in
   with Apple, Associated Domains).

Each release:

1. Build the archive:

   ```sh
   flutter build ipa --dart-define-from-file=config/local.json
   ```

   This produces `build/ios/archive/Runner.xcarchive` and an `.ipa` under
   `build/ios/ipa/`. (Product, Archive in Xcode with "Any iOS Device"
   selected does the same.)
2. Upload it. Either open the archive in Xcode's Organizer (Window,
   Organizer), press Distribute App, choose App Store Connect and follow
   the prompts; or use the Transporter app from the Mac App Store and
   drop the `.ipa` on it.
3. The build appears in App Store Connect under the app's TestFlight tab
   after processing (a few minutes). Install it on a phone through
   TestFlight and check the release there first. Passkeys in particular
   can only be tried on a real device.
4. To ship: App Store Connect, the app, the plus button next to the
   version list, create version X.Y.Z, pick the build, write the "What's
   New" text (the GitHub release notes are a good start), and Submit for
   Review. Reviews usually take a day or two.

Notes:

- `ios/Runner/Info.plist` declares `ITSAppUsesNonExemptEncryption` as
  false (the app only uses HTTPS, which is exempt from export
  compliance), so App Store Connect does not ask the encryption question
  on every upload.
- The Associated Domains entitlement makes Apple fetch
  `/.well-known/apple-app-site-association` from the website; a change
  to that file can take up to a day to reach devices through Apple's
  CDN (docs/firebase.md, "Passkeys in the apps").

## Android: Google Play

One-time setup: an upload key. Play's app signing re-signs what you
upload with a key Google holds, and the first upload's key becomes the
app's upload key from then on, so it must be a key kept for that purpose,
not the debug keystore.

1. Make the keystore, outside the repository, and keep it and its
   password somewhere safe (losing it means asking Google to reset the
   upload key):

   ```sh
   keytool -genkey -v -keystore ~/keys/bikes-pizza-upload.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```

2. Copy `android/key.properties.example` to `android/key.properties`
   (git-ignored) and fill in the path, the passwords and the alias.
   `android/app/build.gradle.kts` reads that file and signs release
   builds with the key; when the file is missing it falls back to the
   debug key and prints a warning, so a bundle built without it must not
   be uploaded.

Each release:

1. Build the bundle:

   ```sh
   flutter build appbundle --dart-define-from-file=config/local.json
   ```

   The result is `build/app/outputs/bundle/release/app-release.aab`.
2. In Play Console, the app, Testing, Internal testing, Create new
   release. Upload the bundle, add release notes, review and roll out.
   Testers on the internal list get it within minutes; use it to check
   the build on a real phone.
3. When it is good, promote the same release to Production (Release,
   Production, Create new release, or "Promote release" from the
   internal track) and roll out. Google's review is usually hours, up to
   a few days.

After the **first** upload of a new package name, Play shows the app
signing key it generated under Setup, App signing. Its SHA-1 and SHA-256
must be registered before Google sign-in and passkeys work in store
builds, in these places (docs/firebase.md has the details):

- the Android app registration in both Firebase projects (development
  through the Pulumi config lists `androidSha1Hashes` /
  `androidSha256Hashes`, production with
  `firebase apps:android:sha:create`), then `flutterfire configure` to
  refresh `google-services.json`;
- `site/public/.well-known/assetlinks.json` (the SHA-256);
- the `PASSKEY_ORIGINS` variable (`android:apk-key-hash:` plus the
  SHA-256 as base64url; the Pulumi program derives it for development,
  production is set by hand on the GitHub environment).

## Store listing (first release of the renamed app)

Both consoles need, once: screenshots for the required device sizes, the
short and full descriptions, the app icon, a category, a privacy policy
URL, and the privacy questionnaire (App Store "App Privacy", Play "Data
safety"). Both also ask whether the app offers account deletion; it does,
from the app's Settings screen and the website's account page.
