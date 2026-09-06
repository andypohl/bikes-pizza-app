# Future features

Ideas that have been thought through but deliberately not built yet. Each
entry says what it would give us, what it would cost, and when it would be
worth doing, so the decision can be revisited without redoing the thinking.

## Render the website at the edge

**Today.** The website is static: Astro runs its GROQ queries against
Sanity on the GitHub Actions runner and writes plain HTML, which Firebase
Hosting serves from its CDN. Content changes reach the site through a
rebuild (the Sanity webhook and the post queues trigger the "Rebuild
website" workflow). Parts of a page that must be fresh are "islands" that
query Sanity or Firebase from the browser, search being the first.

**The idea.** Render pages on request instead, on Cloudflare Workers
(Astro's Cloudflare adapter), querying Sanity each time. Cloudflare's cache
sits in front of the Worker and Sanity's API CDN behind it, so traffic
spikes are still absorbed; the Sanity webhook purges the cache rather than
rebuilding. Every page is then always current, with no rebuild step.

**What it costs.** About a day to set up: the adapter, a Worker deployment
alongside (or instead of) Firebase Hosting for the apex, cache headers and
a purge call in the webhook, and moving the account page copy. Afterwards
there is one more running thing to operate, and page freshness depends on
cache policy rather than on a build having finished.

**When it is worth it.** When the site needs per-visit content across
whole pages: comments, likes, personalisation, or content that changes
more often than a rebuild can follow. For a few posts a day and islands
for the live parts, static pages remain the better trade: faster first
paint, nothing to keep running, and unkillable when a post gets shared.

# Bundle ID change

**Today.** The app was born as Pizza Predator, and its store identifiers
still say so: the iOS bundle ID is `com.pizzapredator.pizzaPredator` and
the Android package name is `com.pizzapredator.pizza_predator`. The app is
now bikes.pizza. The intended identifiers are `com.pizzapredator.bikesPizza`
(iOS) and `com.pizzapredator.bikes_pizza` (Android; segments cannot contain
hyphens, so the underscore is right).

**When.** Before the first store submission. After that a bundle ID is
permanent: changing it means a brand-new listing, with reviews, ratings and
installs starting over. Nothing in production depends on it, so there is no
rush beyond that deadline.

**What it touches.** Three layers, because Firebase and the sign-in
providers are keyed by these identifiers.

1. The Flutter project.
   - iOS: `PRODUCT_BUNDLE_IDENTIFIER` in `ios/Runner.xcodeproj/project.pbxproj`
     (six occurrences, including the `RunnerTests` target).
   - Android: `applicationId` and `namespace` in `android/app/build.gradle.kts`,
     and `MainActivity.kt` moves from the `pizza_predator` package directory
     to `bikes_pizza`.
   - The Dart package name (`name: pizza_predator` in `pubspec.yaml`, imported
     by four files) is internal and independent; renaming it to `bikes_pizza`
     is tidy but optional.
2. Firebase, both projects.
   - Register new iOS and Android apps under the new identifiers in both
     projects, re-adding the Android SHA fingerprints for Google sign-in. The
     old registrations can stay until the new builds are proven, then go.
   - Regenerate the config: both `GoogleService-Info.plist` files (`ios/Runner/`
     and `ios/dev/`), both `google-services.json` files (`android/app/` and
     `android/app/src/debug/`), `lib/firebase_options.dart` and
     `lib/firebase_options_dev.dart`, and the app IDs in `firebase.json`
     (`flutterfire configure`, or the registration script docs/firebase.md
     describes).
   - The development project's registrations should go through Pulumi
     (`infra/index.ts` manages only the web app today; add the Apple and
     Android apps). Production is set by hand with matching values, as with
     the rest of production until it is imported.
3. Apple and Google consoles.
   - Apple Developer: register the new App ID with the Sign in with Apple
     capability and attach it to the existing Services ID, so the Apple
     provider keeps working.
   - Firebase's Google provider creates the iOS OAuth client per bundle ID
     when the app is registered, and the Android one per package plus SHA;
     check both after registering.
   - The Firebase API key restrictions (allowed bundle IDs, allowed Android
     applications; see docs/firebase.md) need the new values.

**Effects.** Debug installs on the simulators become a different app, so
they show as fresh installs and need signing in again. Members notice
nothing: bundle IDs matter only to the stores and to the app's own backend
registrations. The account page, website and functions are unaffected.

**Effort.** About a session, most of it in the consoles. The repo side and
the development project registrations (through Pulumi) can be done and
verified on both simulators first, leaving a short checklist for the Apple
Developer and production console steps.
