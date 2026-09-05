# bikes.pizza

Companion iPhone/Android app for [bikes.pizza](https://bikes.pizza/),
built with Flutter.

## What it does

Five bottom-bar tabs:

| Tab      | Content                                                        |
|----------|----------------------------------------------------------------|
| Blog     | Every post, newest first, with title and thumbnail             |
| Pizza    | Posts tagged `pizza`                                           |
| Bikes    | Posts tagged `biking` or `off-road-biking`                     |
| Store    | Shopify product grid and checkout (placeholder if unconfigured) |
| Settings | Account (sign-in, name, newsletters, password), theme          |

Tapping a post opens it in-app with the hero image and full HTML body. A
toolbar button opens the post in the browser.

Signed-in members (verified email) see a "Submit Pizza" / "Submit Bike"
button under the Pizza and Bikes lists, between the list and the tab bar.
It is not shown on a post. See "Member submissions" below.

## Build-time configuration

Values that identify external services are passed at build time rather
than committed. Copy `config/local.example.json` to `config/local.json`,
fill it in (it is git-ignored), and pass it to Flutter:

```sh
flutter run --dart-define-from-file=config/local.json
```

| Key                        | Purpose                                            |
|----------------------------|----------------------------------------------------|
| `SHOPIFY_STORE_DOMAIN`     | Store host for the Storefront API (see below)      |
| `SHOPIFY_STOREFRONT_TOKEN` | Public Storefront API access token                 |

Leave the Shopify values empty to disable the store (the Store tab then
shows a placeholder).

## Data sources

Posts live in Sanity (see the Sanity section below). The app reads the public
dataset directly through Sanity's API CDN with a GROQ query
(`lib/data/sanity_post_repository.dart`): newest first, paged, and filtered
by the `feed` field for the Pizza and Bikes tabs (the Blog tab is every
post). Post bodies are Portable Text and are converted to HTML on the device
(`lib/data/portable_text_html.dart`) for the existing HTML renderer; images
come from Sanity's image CDN with size and format parameters. The project
and dataset identifiers are in `lib/config.dart` and can be overridden with
`--dart-define=SANITY_PROJECT_ID=...` / `SANITY_DATASET=...`. No key is
needed because the dataset is public.

## Website and Studio

`studio/` is the Sanity Studio for the `post` content model (title, slug,
feed, main image, excerpt, Portable Text body, `submittedBy`, and a record
of where a post came from), hosted at https://bikes-pizza.sanity.studio/.
See `studio/README.md` for running it, deploying the schema, and importing
posts from the old Ghost site.

`site/` is the public website at https://bikes.pizza/, an Astro site that
renders the posts as a photo gallery (the Astro Frame Shift theme by Ema
Suriano, adapted). It is statically built from the public dataset (no
token) and served by the `home` Hosting target; the "Deploy website"
workflow rebuilds it when Sanity content changes (setup in
`docs/firebase.md`). Its header has a "Submit a bike or pizza" button that
opens the same submission flow as the app (`/submit/`, posting to the REST
API; signed-out visitors are sent to sign in first). The button and the form
can be switched off from the review page's "Website submit button" checkbox
(the `submitButton` site setting, `docs/api.md`), for when submissions
should come only through the app and a Sign in / Account
button backed by the same Firebase Auth users as the app. The build copies
the account page (`web/public/`) into `dist/account/` so the site and the
account page share one origin and one Firebase session. See
`site/README.md`.

## Member submissions

The Submit Pizza / Submit Bike form (`lib/screens/submit_screen.dart`) asks
for a main photo (camera or library, scaled to 2048px on the device), a
title, who it is from, and a description or story. Submitting calls the
`submitPost` Cloud Function, which normalises the photo (rotation, 2048px
long edge, JPEG), checks it with Google Cloud Vision (SafeSearch, then
face detection and object localisation so that photos of people are
refused; a photo that fails is refused with a message and nothing is
stored), makes a thumbnail, stores both in Cloud Storage under
`submissions/{id}/`, writes a `submissions/{id}` document in Firestore with
status `pending`, and emails a configured address with a link to the review
page. Nothing reaches the blog at this point.

**Review page**: `web/review/`, its own Hosting site served at
https://submissions.bikes.pizza/. It works through the REST API at
`/api/` on the same site (`functions/api.js`, documented in `docs/api.md`),
which the app can use too.
Only Firebase users with the `admin` custom claim can open it; grant it
with `tools/grant_admin.py you@example.com` (revoke with `--revoke`). It
lists submissions as a paginated table with thumbnails and Pending / Posted
/ Rejected / All filters. Opening a row shows the full photo and story, and
offers Queue to post, Save as draft, or Reject. Queued submissions wait in a
per-feed queue and go live one at a time on a fixed schedule (bikes at
8am, 12pm, 4pm and 8pm Central; pizza at 9am, 1pm, 5pm and 9pm), run by
scheduled functions; the page shows each queue's length and the time to
its next post, and the API exposes the queues under `/api/queue/`.

**Publishing** (`functions/post.js`) uploads the photo to Sanity as an
image asset and creates a `post` document: title, a slug made from the title
plus a suffix from the submission id, the feed, the description as Portable
Text paragraphs, `submittedBy` (the name the member gave), and
`source: {system: "submission", id}`. "Queue to post" publishes it when its
turn comes; "Save as draft" creates it as a Sanity draft for editing in the
Studio. The submitter's email never reaches the post. The website's Sanity
webhook then rebuilds bikes.pizza so the post appears.

Configure once per Firebase project: an Editor API token for the Sanity
project, stored as the `SANITY_WRITE_TOKEN` secret
(`firebase functions:secrets:set SANITY_WRITE_TOKEN`). The project, dataset
and site URL default to the repo's; `functions/.env.example` lists the
overrides.

The email goes out through Mailgun's HTTP API. Configure once per
Firebase project:

```sh
# Secret:
firebase functions:secrets:set MAILGUN_API_KEY
# Not secret, in functions/.env and as repository variables for the deploy
# workflow: MAILGUN_DOMAIN (a verified sending domain, or the sandbox domain
# for tests), SUBMISSION_NOTIFY_EMAIL (recipient), optionally
# SUBMISSION_FROM_EMAIL (sender), MAILGUN_API_BASE (EU-region accounts only)
# and REVIEW_PAGE_URL.
```

Without a key, domain and recipient, the submission is still stored and the
email is skipped with a warning in the function logs. Mailgun sandbox
domains only deliver to recipients authorized in Mailgun.

## Store (Shopify)

The Store tab reads the catalogue through Shopify's Storefront GraphQL API
using a public access token, which Shopify designs to ship inside client
apps (it can only read products and create carts). Tapping **Buy now**
creates a cart with the chosen variant and opens Shopify's hosted checkout
in an in-app browser. If the user is signed in, their email pre-fills the
checkout so the order lands on the matching Shopify customer.

To get the two values: in Shopify admin go to **Settings → Apps and sales
channels → Develop apps**, create an app, grant it the
`unauthenticated_read_product_listings` and `unauthenticated_write_checkouts`
Storefront API scopes, install it, and copy the *Storefront API access
token*. The store domain is the host the app calls the Storefront API on:
the shop's `*.myshopify.com` address, or a custom domain connected to the
store (Settings → Domains) once its DNS and SSL are live. Checkout always
opens on whichever domain is primary in Shopify, regardless of this value.

## Firebase

The app uses Firebase Authentication for
user accounts. Email + password sign-in lives under Settings → Account.
The generated config (`lib/firebase_options.dart`, `android/app/google-services.json`,
`ios/Runner/GoogleService-Info.plist`) identifies the app to Firebase and is
safe to commit; access is controlled by Firebase security rules, not by
keeping these files private.

To re-register apps or refresh the config:

```sh
dart pub global activate flutterfire_cli
flutterfire configure --platforms=ios,android
```

In the Firebase console, **Authentication → Sign-in method** must have
*Email/Password*, *Google*, and *Apple* enabled. Google sign-in on Android
also needs the signing key's SHA fingerprints registered on the Firebase
Android app. The `AuthService` facade in `lib/auth/auth_service.dart`
wraps all three providers. Sign in with Apple is offered on iOS only.

See `docs/firebase.md` for an outline of how the Firebase project is
structured and the console steps needed to rebuild it.

## Members

Every Firebase user has a member profile in Firestore (`members/{uid}`,
server-only): name and newsletter choices. Two Cloud Functions, both
requiring a signed-in user with a verified email, are the only way in:

- `member` returns the profile (email, name, and every newsletter with a
  subscribed flag), creating it with defaults on first use. New members
  start subscribed to the one newsletter (`functions/members.js`).
- `updateMember` changes the name and/or the set of newsletters.

The app's Settings → Account → Manage account screen (`lib/account/`) and
the website's account page use them; the app adds a password change for
email/password accounts. Password accounts must verify their email first
(Settings shows a "Verify your email" tile); Google and Apple accounts are
verified already. Newsletter sending is not part of this app yet; the flag
records the choice.

Run the functions' unit tests with `npm test` inside `functions/`.

## Website sign-up (same accounts as the app)

Website sign-ups go through the account page (`web/public/`), which the
website serves at https://bikes.pizza/account/ (see the Sanity section) and
which is also its own Hosting site. It signs people in with Firebase Auth
(email/password, Google, or Apple once a Services ID is configured; see
`docs/firebase.md`) and sends them back to the site. New email accounts must
verify their address first.

The same page is the members' account screen (`?mode=account`): it shows the
email and sign-in method, lets them edit their name and newsletter choices
(through the `member` and `updateMember` functions) and, for email/password
accounts, change their password or request a reset email.

Both pages read their Firebase config from Hosting's reserved
`/__/firebase/init.json`, so nothing project-specific is committed. They are
Hosting sites (targets `account` and `review` in `firebase.json`, mapped
to site IDs in `.firebaserc`), so each serves its page from `/`. Preview
locally with `firebase emulators:start --only hosting` (uses the live
Firebase project for sign-in) and deploy with `firebase deploy --only hosting`.

There are two Firebase projects. Production (bikes.pizza,
submissions.bikes.pizza) only changes when a GitHub release is published (or
when the "Deploy to production" workflow is run by hand). Every merge to
`main` deploys the same code to the development project, served at
https://bikes-pizza.dev/ and https://submissions.bikes-pizza.dev/, with its
own Firestore, Auth users and Cloud Functions, and built from the
`development` Sanity dataset. The workflows authenticate without any stored
key: GitHub's OIDC token is exchanged for a deploy-only service account via
Workload Identity Federation, configured per GitHub environment
(`production`, `development`). See `docs/firebase.md` for the cloud-side
setup and the list of variables. `firebase deploy --project dev` deploys to
the development project from a machine.

## Project layout

```
lib/
  main.dart                     app + bottom navigation shell
  config.dart                   site URL and API key wiring
  app_settings.dart             persisted preferences (theme mode)
  auth/auth_service.dart        AuthService facade + Firebase implementation
  auth/sign_in_screen.dart      email/password sign-in and account creation
  firebase_options.dart         generated by flutterfire configure
  models/post.dart              normalised Post model
  models/post_feed.dart         Blog / Pizza / Bikes feed definitions
  data/post_repository.dart     PostRepository interface + backend selection
  data/sanity_post_repository.dart
  data/portable_text_html.dart      Portable Text to HTML for the renderer
  screens/post_list_screen.dart list with pull-to-refresh + infinite scroll
  screens/post_detail_screen.dart
  screens/settings_screen.dart
  screens/store_screen.dart     Shopify product grid, or placeholder
  screens/product_detail_screen.dart
  store/product.dart            Product / variant / money models
  store/store_repository.dart   StoreRepository + Shopify Storefront client
  widgets/post_tile.dart        title + thumbnail row
test/                           unit tests for both backends, widget tests
```

## Development

```sh
flutter pub get
dart format lib test   # CI fails if this would change anything
flutter analyze
flutter test
flutter run            # pick a connected device / simulator
```

Formatting, `flutter analyze`, `flutter test`, and the Cloud Functions unit
tests run on GitHub Actions for every pull request targeting `main`
(`.github/workflows/pr-checks.yml`). Merging to `main` deploys the Cloud
Functions, the website and the account page to the development project
(`.github/workflows/deploy-dev.yml`); publishing a GitHub release deploys
them to production (`.github/workflows/deploy-firebase.yml`). Both call
`.github/workflows/deploy.yml`. App store release workflows will be added
later.

Adding or renaming tabs: edit `PostFeed` in `lib/models/post_feed.dart` and
the `NavigationDestination` list in `lib/main.dart`.

App icon: the source files live in `assets/icon/` (`icon.png` for Android's
legacy launcher icon, `icon_ios.png` as an opaque square for iOS, and
`icon_android_fg.png`, the padded foreground of the Android adaptive icon;
its background colour is set in `pubspec.yaml`). After replacing them run
`dart run flutter_launcher_icons` to regenerate the platform icon sets, and
discard the change the tool makes to `ios/Runner.xcodeproj/project.pbxproj`
(it rewrites an unrelated build setting).
