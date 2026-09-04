# bikes.pizza

Companion iPhone/Android app for [pizzapredator.com](https://www.pizzapredator.com),
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
| `GHOST_CONTENT_API_KEY`    | Full blog archive via the Ghost Content API        |
| `SHOPIFY_STORE_DOMAIN`     | Store host for the Storefront API (see below)      |
| `SHOPIFY_STOREFRONT_TOKEN` | Public Storefront API access token                 |

`GHOST_CONTENT_API_KEY` is required; the app refuses to start without it.
Leave the Shopify values empty to disable the store (the Store tab then
shows a placeholder).

## Data sources

The blog runs on Ghost (Ghost Pro). The app reads it through the **Ghost
Content API**: full archive, paging, infinite scroll, and server-side tag
filtering. Create a key in Ghost Admin (Settings → Integrations → Add
custom integration → copy *Content API key*), put it in `config/local.json`
as `GHOST_CONTENT_API_KEY`, and pass the file at build/run time:

```sh
flutter run --dart-define-from-file=config/local.json
flutter build ipa --dart-define-from-file=config/local.json
flutter build appbundle --dart-define-from-file=config/local.json
```

Content API keys grant read-only access to public content, so they are not
secret in Ghost's model, but the key is still kept out of the repo. Without
it the app throws on startup with a message naming the missing define.

## Member submissions

The Submit Pizza / Submit Bike form (`lib/screens/submit_screen.dart`) asks
for a main photo (camera or library, scaled to 2048px on the device), a
title, who it is from, and a description or story. Submitting calls the
`submitPost` Cloud Function, which normalises the photo (rotation, 2048px
long edge, JPEG), checks it with Google Cloud Vision SafeSearch (a photo
that fails is refused with a message and nothing is stored), makes a
thumbnail, stores both in Cloud Storage under
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

**Publishing** renders `functions/templates/submission_post.md`, a Markdown
file with a front-matter block (`title`, `tags`, `feature_image`) and
Mustache placeholders, uploads the photo to Ghost, and creates the post as
published or as a draft. Available placeholders: `title`, `from`,
`description`, `feed` (`pizza`/`bikes`), `noun` (`pizza`/`bike`), `tag`
(`pizza`/`biking`), `image_url`, `submitted_on` (YYYY-MM-DD). Body text is
HTML-escaped so a member cannot inject markup; the front matter is not,
since it fills plain fields. The `#submission` tag is always added. The
submitter's email is never available to the template.

Posts are attributed to a dedicated Ghost staff account (its email in
`SUBMISSION_AUTHOR_EMAIL`); if that account does not exist, Ghost's default
author is used and a warning is logged. The staff account is a Ghost login
only; it has nothing to do with Firebase, which only handles members.

The email goes out through Mailgun's HTTP API. Configure once per
Firebase project:

```sh
# Secret:
firebase functions:secrets:set MAILGUN_API_KEY
# Not secret, in functions/.env and as repository variables for the deploy
# workflow: MAILGUN_DOMAIN (a verified sending domain, or the sandbox domain
# for tests), SUBMISSION_NOTIFY_EMAIL (recipient), SUBMISSION_AUTHOR_EMAIL
# (staff account), optionally SUBMISSION_FROM_EMAIL (sender),
# MAILGUN_API_BASE (EU-region accounts only) and REVIEW_PAGE_URL.
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

## Ghost members (same accounts as the app)

Every Firebase user is also a Ghost member, so signing up in the app
subscribes people to the newsletter just like signing up on the website.
Ghost cannot verify Firebase users itself, so Cloud Functions bridge the two
(`functions/index.js`, `functions/ghost.js`), all requiring a signed-in user
with a verified email:

- `ghostMember` / `updateGhostMember` read and change the member's name and
  newsletter subscriptions. The app's Settings → Account → Manage account
  screen (`lib/account/`) uses them, and adds a password change for
  email/password accounts.
- `ghostSignInUrl` returns a one-time Ghost sign-in URL. Only the website's
  account page uses it (below); the app does not link to the website, since
  it shows the same public content itself.

The Firebase user ↔ Ghost member link is stored in Firestore (`users/{uid}`,
server-only) after the first sign-in, so the two are matched by ID from then
on and an email change on either side does not create a duplicate member.

Password accounts must verify their email first (Settings shows a
"Verify your email" tile); Google and Apple accounts are verified already.
Newsletter subscription for members created this way follows the Ghost
site's defaults, the same as signing up on the website.

Setup, once per Firebase project:

```sh
cd functions && npm install && cd ..
cp functions/.env.example functions/.env   # set GHOST_ADMIN_API_URL
firebase functions:secrets:set GHOST_ADMIN_API_KEY   # paste the Admin API key
firebase deploy --only functions
```

The Ghost Admin API key and URL come from a custom integration in Ghost
Admin (Settings → Integrations). The key is a secret and lives only in
Secret Manager; the same integration's Content API key goes in
`config/local.json` for the app.

Run the function's unit tests with `npm test` inside `functions/`.

## Website sign-up (same accounts as the app)

Ghost Pro cannot run code, so website sign-ups are routed through a small
account page hosted on Firebase Hosting (`web/public/`). It signs people in
with Firebase Auth (email/password, Google, or Apple once a Services ID is
configured; see `docs/firebase.md`), then calls the same
`ghostSignInUrl` function and sends the browser to the resulting URL, so
they land on pizzapredator.com as a member. New email accounts must verify
their address before that hand-off happens.

The same page is the members' account screen (`?mode=account`): it shows the
email and sign-in method, lets them edit their name and newsletter choices
(through the `ghostMember` and `updateGhostMember` functions, which update
the Ghost member), and, for email/password accounts, change their password
or request a reset email. Sign out ends both the Firebase session and, via
Portal's own sign-out route, the Ghost one.

`web/ghost-code-injection.html` is a snippet for Ghost Admin → Settings →
Code injection → Site header. It redirects Ghost's own Sign in / Subscribe /
Account buttons and `#/portal/signin|signup|account` links to the account
page (with a `mode` and a return path `r`), so Portal's own account screen
is never shown; only its sign-out route is left to Portal. Ghost does not
let integration keys edit settings, so it is pasted by hand: run

```sh
tools/ghost_code_injection.py
```

which fills in the account page URL and copies the snippet to the clipboard,
then paste it into Ghost Admin → Settings → Code injection → Site header
(replacing any earlier copy between the marker comments) and save.

Both pages read their Firebase config from Hosting's reserved
`/__/firebase/init.json`, so nothing project-specific is committed. They are
Hosting sites (targets `account` and `review` in `firebase.json`, mapped
to site IDs in `.firebaserc`), so each serves its page from `/`. Preview
locally with `firebase emulators:start --only hosting` (uses the live
Firebase project for sign-in) and deploy with `firebase deploy --only hosting`.

Deploys also happen automatically when a GitHub release is published (or by
running the "Deploy to Firebase" workflow by hand). The workflow authenticates
without any stored key: GitHub's OIDC token is exchanged for a deploy-only
service account via Workload Identity Federation. It needs a `production`
environment and three repository variables (`GCP_WORKLOAD_IDENTITY_PROVIDER`,
`GCP_DEPLOY_SERVICE_ACCOUNT`, `GHOST_ADMIN_API_URL`). See `docs/firebase.md`
for the cloud-side setup.

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
  data/ghost_content_api_repository.dart
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
(`.github/workflows/pr-checks.yml`). Publishing a GitHub release deploys the
Cloud Functions and the account page (`.github/workflows/deploy-firebase.yml`);
app store release workflows will be added later.

Adding or renaming tabs: edit `PostFeed` in `lib/models/post_feed.dart` and
the `NavigationDestination` list in `lib/main.dart`.

App icon: the source files live in `assets/icon/` (`icon.png` for Android's
legacy launcher icon, `icon_ios.png` as an opaque square for iOS, and
`icon_android_fg.png`, the padded foreground of the Android adaptive icon;
its background colour is set in `pubspec.yaml`). After replacing them run
`dart run flutter_launcher_icons` to regenerate the platform icon sets, and
discard the change the tool makes to `ios/Runner.xcodeproj/project.pbxproj`
(it rewrites an unrelated build setting).
