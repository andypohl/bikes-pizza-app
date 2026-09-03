# PizzaPredator

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
| Settings | Account (email, Google, Apple sign-in), theme, data source      |

Tapping a post opens it in-app with the hero image and full HTML body. A
toolbar button opens the post in the browser.

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
| `SHOPIFY_STORE_DOMAIN`     | `your-store.myshopify.com`                         |
| `SHOPIFY_STOREFRONT_TOKEN` | Public Storefront API access token                 |

Leave a value empty to disable that integration: the blog falls back to
RSS and the Store tab shows a placeholder.

## Data sources

The blog runs on Ghost (Ghost Pro). The app talks to it one of two ways:

1. **Ghost Content API** (preferred). Full archive, paging, infinite scroll,
   server-side tag filtering. Requires a Content API key.
2. **RSS feeds** (fallback, no key needed). Ghost only exposes the 15 most
   recent posts per feed, so the lists are capped at 15.

To use the Content API, create a key in Ghost Admin
(Settings → Integrations → Add custom integration → copy *Content API key*)
and pass it at build/run time:

```sh
flutter run --dart-define=GHOST_CONTENT_API_KEY=your_key_here
flutter build ipa --dart-define=GHOST_CONTENT_API_KEY=your_key_here
flutter build appbundle --dart-define=GHOST_CONTENT_API_KEY=your_key_here
```

Without the define the app silently uses RSS. The Settings tab shows which
source is active.

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
token*. The store domain is the `*.myshopify.com` address of the shop.

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

## Website member sign-in (Ghost)

Signed-in users can open pizzapredator.com as a logged-in Ghost member from
Settings → Account, without a magic-link email. Ghost cannot verify Firebase
users itself, so a Cloud Function bridges the two:

1. The app calls the `ghostSignInUrl` callable function
   (`lib/ghost/ghost_session_service.dart`).
2. The function checks the Firebase user has a verified email, then uses the
   Ghost Admin API to find or create the member with that email and asks
   Ghost for a one-time sign-in URL (`functions/index.js`, `functions/ghost.js`).
3. The app opens that URL in an in-app browser; Ghost sets its member cookie.

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
with Firebase Auth (email/password or Google), then calls the same
`ghostSignInUrl` function and sends the browser to the resulting URL, so
they land on pizzapredator.com as a member. New email accounts must verify
their address before that hand-off happens.

`web/ghost-code-injection.html` is a snippet for Ghost Admin → Settings →
Code injection → Site header. It redirects Ghost's own Sign in / Subscribe
buttons and `#/portal/signin|signup` links to the account page (with a
`mode` and a return path `r`). Portal keeps handling the account screen for
members who are already signed in. Install or update it with:

```sh
tools/ghost_code_injection.py --credentials path/to/ghost-creds.txt
```

The page reads its Firebase config from Hosting's reserved
`/__/firebase/init.json`, so nothing project-specific is committed. Preview
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
  data/rss_post_repository.dart
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
