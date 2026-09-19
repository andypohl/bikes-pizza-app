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
| Search   | One request when Search is pressed: members, then posts by title, details and story |
| Store    | Product grid from Shopify, a cart, and Shopify checkout      |
| Settings | Account (sign-in, username, newsletters, password, deletion), Posts (edit what you posted), theme |
| Admin    | For signed-in administrators: review submissions and manage users |

Tapping a post opens it in-app with the hero image and full HTML body. A
toolbar button opens the post in the browser.

Signed-in members (verified email) see a "Submit Pizza" / "Submit Bike"
button under the Pizza and Bikes lists, between the list and the tab bar.
It is not shown on a post. See "Member submissions" below.

## Shared facts (the contract)

Facts that the app, the Cloud Functions and the website must agree on
live once, as JSON in `contract/`: the feeds (labels, nouns,
whether they take submissions, posting hours), the option lists for a
post's bike and pizza details, the reaction palettes (the questions a
member answers about a post and the options to pick from; add a palette
or an option there), the username rule, the shape of a post's URL and
the image limits. `node tool/contract/generate.mjs` writes the
language-specific copies (`functions/contract.js`, `lib/contract.dart`,
`site/src/lib/contract.ts`), which are committed; a pull-request check fails when they are out of date. Change
the JSON, run the generator, commit both.

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

Leave the Shopify values empty and checkout uses the store's cart
permalink instead of the Storefront API (the Store tab works either way;
see Store below).

## Data sources

Posts live in the `posts` collection of the Firebase project the build
signs in to (production for release builds, development for the rest; see
`main.dart`), the same documents the website is built from. The app reads
them over Firestore's REST API without credentials
(`lib/data/firestore_post_repository.dart`; the security rules make
published posts readable by anyone): newest first, paged, filtered by the
`feed` field for the Pizza and Bikes tabs, and by `credit.uid` for the
list of one member's posts. Post bodies come as HTML rendered when the post
was written; photos come from Cloud Storage as the renditions made on
publish (`PostImage.url` picks the width that fits). The store's products
come from Shopify's Storefront API (see Store below).

## Website

`site/` is the public website at https://bikes.pizza/, an Astro site that
renders the posts as a photo gallery (the Astro Frame Shift theme by Ema
Suriano, adapted). It is statically built from the `posts` collection in
Firestore, read over REST without credentials, with photos served from
Cloud Storage; the functions ask the "Deploy website" workflow to rebuild
it whenever a post is published or changed. It is served by the `home`
Hosting target. Its header has a "Submit a bike or pizza" button that
opens the same submission flow as the app (`/submit/`, posting to the REST
API; signed-out visitors are sent to sign in first). The button and the form
can be switched off from the review page's "Website submit button" checkbox
(the `submitButton` site setting, `docs/api.md`), for when submissions
should come only through the app and a Sign in / Account
button backed by the same Firebase Auth users as the app. The build copies
the account page (`web/public/`) into `dist/account/` so the site and the
account page share one origin and one Firebase session. See
`site/README.md`.

## Unread posts

The News, Pizza and Bikes tabs (and All on tablets) show how many of
their posts have not been opened since they were published or last
edited, each such post carries a blue dot, and the app icon shows the sum
of the tabs. `lib/posts/unread_tracker.dart` keeps the state on the
device: a baseline (first run of the app, moved forward as posts are
read) and, for the posts after it, when each was last opened. The counts
come from one Firestore query for posts whose `changedAt` (set by the
functions on publish and on every edit) is after the baseline, run when
the app starts and whenever it comes back to the front. Opening a post
from a list marks it read; a news article is read once it has been on
screen for a few seconds. The icon badge goes through
`lib/posts/app_badge.dart` (the app_badge_plus plugin, plus a small
channel in the iOS app delegate that asks for the badge permission the
first time there is something to show). There is no push: the numbers
refresh when the app runs.

## Reactions

Under a bike or pizza post's details, signed-in members answer the
feed's fixed questions by tapping a chip: for a pizza, "I've had this
pizza" (yes / no) and "This pizza has fantastic" (crust, cheese, sauce,
toppings, price); for a bike, "This bike looks" (stylish, comfortable,
fast, rugged) and "My favorite part of this bike is its" (wheels, frame,
gears/derailleurs, shifters, brakes, paint, bars, seat, pedals). Each
palette takes one pick; tapping another swaps it and tapping the picked
one takes it back. Chips show how many members picked each option, and
hovering a chip (or holding it, on touch) names up to ten of them at
random. The palettes are in `contract/reactions.json`; each carries a
`pick` field ("one" now; "many" is understood by the functions and the
app for palettes that should take several). The tallies live on the post
document, so the app has them with the post and nothing is fetched until
someone signs in; the member's own picks and the names come from the
REST API (`docs/api.md`, `functions/reactions.js`,
`lib/widgets/reactions_panel.dart`). Members who are signed out see the
tallies only; news posts have no palettes.

## Comments

Signed-in members with a username comment on bike and pizza posts:
top-level comments with one level of replies, likes, `@mentions`, a
five-minute edit window and a report button; the post's author can
switch comments off on their post and delete any comment under it.
Every comment is screened before anyone sees it: the admin's banned
word list refuses it, Google's Cloud Natural Language moderation
(`functions/moderate.js`; the API is enabled through `infra/`) refuses
it at a high toxicity score and holds it for review at a middling one
or when it looks political, and a suspicious word list holds it too;
two reports from different members hide a comment until an admin
looks. The admin page's Comments tab works the pending and reported
queues and edits the word lists.

In the app the thread sits under the post (`lib/widgets/comments_panel.dart`,
over `lib/posts/comment_service.dart`): the count, the comments oldest
first with their first three replies ("Show N more replies", "Load more
comments"), like buttons whose counts open the list of who liked, Reply,
and a menu with Edit (own comment, five minutes), Delete (own comment, or
any on the member's own post, or an admin) and Report with the contract's
reasons. The composer has bold, italic and link buttons that insert the
Markdown markers and shows the character count; a held comment shows in
place as "Waiting for review". Signed out, the panel shows the count and a
hint to sign in; a post whose author switched comments off (the Comments
switch on the edit screen) says so. List tiles show the count and, from
the unread tracker, "N new" for comments written since the post was last
opened on this device; a comment that mentions the member makes the post
fully unread again (dot, tab counter, icon badge), through the mention
notices the tracker fetches with its changes query. Comments never count
as an edit of the post. Settings → Manage account → "Export my data"
shares everything the member has as a JSON file. On the website
(`site/src/components/Comments.astro`, `site/src/scripts/comments.ts`)
the post page carries the count from build time, and once the Firebase
session is known shows either "Sign in to read the comments" (the
account page shares the origin, so the session is visible) or the live
thread from the API with the same reply, like, edit, delete and report
controls and a composer; coming back to the tab refreshes the thread.
Gallery tiles show the count on hover. The design is in
`docs/community-design.md`, the endpoints in `docs/api.md`, the rules
(lengths, windows, thresholds, report reasons) in
`contract/comments.json`, and the functions in `functions/comments.js`
(the service), `functions/comment_text.js` (the Markdown subset and the
mention and link rewrites) and `functions/comment_store.js` (Firestore).
Deleting an account removes the member's comments, likes, reactions and
notices; `GET /api/me/export` hands a member everything they have.

## Profiles

Every username is a link to the member's profile: when they joined (the
Firebase user's creation time, copied onto the member record), the
location they chose to share (a free-text field on the account screen
and page, sixty characters, checked against the banned word list) and
how many pizzas and bikes they have posted, each opening those posts.
The profile is public: `GET /api/members/{username}` needs no token
(`functions/profiles.js`), and `…/posts?feed=` pages the member's posts
in one feed. In the app (`lib/screens/profile_screen.dart`,
`lib/posts/profile_service.dart`) the credit line on a post, a comment's
author and the names in the likes sheet open it, the counts open a
filtered post list ("Pizzas by ada_bikes"), and Settings → "Your
profile" shows members their own. On the website `/member/<username>/`
is the profile: the header (`site/src/components/ProfileHeader.astro`,
filled from the API by `site/src/scripts/profile.ts`) over the member's
posts by feed; members without posts have no built page, so a Hosting
rewrite serves `/member/index.html`, which reads the username from the
path. The Message button and the "allow direct messages" switch come
with direct messages.

## Search

`GET /api/search?q=` (`functions/search.js`, the shape in
`docs/api.md`) answers one request with four groups in a fixed order:
members whose username starts with what was typed, posts whose title
matches, posts whose structured details match (a bike's brand, decade,
color and type, a pizza's style, by value or option name), and posts
whose story contains every word. A post is listed once, in the best
group it qualifies for, newest first. There is no index server: every
post document carries a `search` field (`functions/search_index.js`)
with the prefixes of its title and detail words and the whole words of
its story, written on publish and on every edit, and the endpoint runs
one Firestore query on it plus a prefix query on the username
reservations. Titles and details match from two letters on; a story
needs the whole word, since prefixes of a whole story would bloat the
index. Existing posts get their field from `node backfill_search.js
<project-id>` in `functions/` (run once per project; development is
done, production is due at the next release). In the app the Search
tab (`lib/screens/search_screen.dart`, `lib/posts/search_service.dart`)
is a text box and a Search button: nothing is sent while typing, and
pressing Search or the keyboard's search key makes the one request.
The four groups follow, each row opening the profile or the post as a
feed would, with a line of the story under a text match. On the website
the box in the fixed bar at the top of every page
(`site/src/components/SearchBar.astro`) is a plain GET form: Enter
opens `/search/?q=`, a static page that `site/src/scripts/search.ts`
fills from the same endpoint with the same four groups, members linking
to their profiles and posts to their pages.

## Direct messages

Members message each other one on one (`functions/threads.js`,
`functions/thread_store.js`; the design in `docs/community-design.md`,
the endpoints in `docs/api.md`). Two members share one thread that
holds everything they have said to each other, divided into numbered
conversations (a conversation ends when the two agree to continue by
email, which is the next pull request). The app reads threads and
messages live from Firestore, whose rules let a thread's two members
read it, and writes through the API: a message goes through the comment
text pipeline and the screening (banned words and strong toxicity
refuse it; nothing is held, since nobody reviews private messages),
moves the other member's unread count and the thread's preview, and is
refused while either member has blocked the other. Members can edit a
message for five minutes and delete it any time ("Message deleted" for
both), block and unblock each other (a block freezes the thread with an
event line, hides the Message button on the profile and hides the
blocked member's comments from the blocker) and report a thread, which
is the only way an admin can read it. One message every two seconds,
500 a day, 20 new threads a day. Deleting an account deletes every
thread the member was in, both sides' messages included, leaving the
other member a marker that says the conversation is gone; usernames on
threads follow renames; the export carries the member's messages.

In the app (`lib/messages/thread_service.dart`,
`lib/messages/message_tracker.dart`, `lib/screens/messages_screen.dart`,
`lib/screens/thread_screen.dart`) an envelope button in the app bar of
the feed screens carries the unread total and opens the thread list
(the other member, the newest message's preview and time, the unread
count in bold); a thread is one bottom-aligned list of bubbles with
"Load older messages" at the top, event lines centered, own messages
editable for five minutes and deletable on long press, and a composer
with the same toolbar as comments; the menu offers Block and Report.
Above the composer, "Continue this conversation in email" asks the
other member (after a warning that the asker's address will be shown);
the other side sees a card with Agree and Not now, the asker "Waiting
for … to agree" with Cancel, and agreeing sends the email and ends the
conversation with an event line. A
profile's Message button opens the thread with that member; Settings →
Blocked members lists blocks with Unblock; the account screen has
"Allow direct messages". Threads and messages arrive live through the
Firestore SDK (`cloud_firestore`, the app's one direct Firestore read
for member data), the writes go through the API, and the app icon's
badge counts unread messages with unread posts.

Either member can ask to continue the current conversation by email;
the other has to agree, and both are warned that their address will be
shown. On agreement (`functions/thread_email.js`, `agreeEmail` in
`functions/threads.js`) the app emails the conversation's newest ten
messages to the member who agreed, drawn as chat bubbles in an HTML
part (the asker's on the right in the app's teal; real, selectable
text) with a plain-text part alongside, from the Mailgun sender with
Reply-To set to the asker, and a "Previous messages" link to the
website's read-only thread page (`/messages/<thread>/`,
`site/src/pages/messages/index.astro` and
`site/src/scripts/thread_page.ts`, served through a Hosting rewrite;
it needs the site's Firebase session and says so when the thread is
gone because the other member deleted their account). The conversation
ends with an "(conversation continued by email)" line and the next
message starts a new one. The privacy page describes the address
sharing.

## Member submissions

The Submit Pizza / Submit Bike form (`lib/screens/submit_screen.dart`) asks
for a main photo (camera or library, scaled to 2048px on the device), up
to four additional pictures ("Additional pictures", the same picker), a
title, who it is from, and a description or story. Submitting calls the
`submitPost` Cloud Function, which normalises each photo (rotation, 2048px
long edge, JPEG), checks each with Google Cloud Vision (SafeSearch, then
face detection and object localisation so that photos of people are
refused; a photo that fails is refused with a message naming which one,
and nothing is stored), makes thumbnails, stores them in Cloud Storage under
`submissions/{id}/`, writes a `submissions/{id}` document in Firestore with
status `pending`, and emails a configured address with a link to the review
page. Nothing reaches the blog at this point.

**Editing posts.** A member can change a post they are credited to (the
`author` reference set when their submission was published): Settings →
Posts lists them, and an open post shows an Edit button in its app bar
(`lib/widgets/edit_post_button.dart`) to the member who posted it and to
administrators. The edit screen (`lib/screens/edit_post_screen.dart`)
takes a new photo, title, description or story, and the structured
details (a bike's brand, year, color and type, a pizza's style, the same
choices as the Post details app); only what changed is sent, through the
REST API's `/api/posts` endpoints (`docs/api.md`, `functions/posts.js`,
reached with `lib/api/api_client.dart`). A member's edit is reviewed like
a new post: it is stored as a pending submission of kind `edit`, the
reviewer is emailed, and the post changes only when the review page
applies it (one pending edit per post; the screen says so meanwhile). An
administrator's edit is applied at once. A story written by an editor in
Markdown (headings, lists or links) is edited as plain text and, if
changed, saved as plain paragraphs; the screen warns about that.

**Admin.** For a signed-in administrator, on any device, the bottom bar
gains an Admin tab (`admin_screen.dart`) with the same two tools as the
web pages, on the same REST API (`lib/admin/`): **Review submissions** (`submissions_screen.dart`)
lists the queues, the website submit button switch, the submissions by
status with paging, and each one in full with Queue to post / Apply edit,
Save as draft, Reject and Remove from queue; **Manage users**
(`users_screen.dart`) lists every account by most recent post and opens
one for editing the username, email and newsletters, sending a password
reset, or deleting it after an "Are you sure?". In landscape the chosen
row opens beside the list, as posts do. The API requires the admin to
have signed in with a second factor (an authenticator code or a passkey);
without one the screens say so and point at Settings → Manage account.

**Review page**: `web/review/`, its own Hosting site served at
https://submissions.bikes.pizza/. It works through the REST API at
`/api/` on the same site (`functions/api.js`, documented in `docs/api.md`),
which the app can use too.
Only Firebase users with the `admin` custom claim can open it; grant it
with `tool/grant_admin.py you@example.com` (revoke with `--revoke`).
Reviewers must also use two-factor authentication: on first sign-in the
page shows a QR code to scan with an authenticator app and asks for a
code, and every sign-in afterwards asks for the code; the API refuses admin
tokens without it. It
lists submissions as a paginated table with thumbnails and Pending / Posted
/ Rejected / All filters. Opening a row shows the full photo and story, and
offers Queue to post, Save as draft, or Reject. A member's edit of a
published post appears in the same list marked "Edit", with what changed
and a link to the post; Apply edit writes it to the post right away (there
is no draft or queue for an edit), Reject drops it. Queued submissions wait in a
per-feed queue and go live one at a time on a fixed schedule (bikes at
8am, 12pm, 4pm and 8pm Central; pizza at 9am, 1pm, 5pm and 9pm), run by
scheduled functions; the page shows each queue's length and the time to
its next post, and the API exposes the queues under `/api/queue/`.

**Publishing** (`functions/post.js`, `functions/submissions.js`) makes the
photo's renditions (`functions/renditions.js`: WebP and JPEG at several
widths, a 4:3 tile and a blurred placeholder, in Cloud Storage under
`posts/{slug}/{version}/`) and writes the `posts/{slug}` document in
Firestore: title, a slug made from the title plus a suffix from the
submission id, the feed, the description as the body (plain text, rendered
to HTML at write time), a summary, the details, the credit (`uid`,
`username`, `name`; see Members) and `source: {system: "submission", id}`.
"Queue to post" publishes it when its turn comes. The submitter's email
never reaches the post. The functions then ask GitHub to rebuild
bikes.pizza so the post appears (`functions/rebuild.js`). The site URL
and environment come from `functions/.env` (`functions/.env.example`).

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

Both the website (`/shop/`, see `site/README.md`) and the app's Store tab
read the products of the Shopify store through the Storefront GraphQL API
(the website at build time, the app live), so they show the same
catalogue; checkout happens on Shopify.

The Store tab (`lib/screens/store_screen.dart`, `lib/store/`) reads the
products with the store domain and public access token the build carries
(see below), and lays them out like the website's shop: a chip per Shopify product type with "All products" first,
and a grid with the name and price under each photo. A product page has a
quantity and two buttons: **Add to cart** puts that many in the cart (the
Store tab's badge goes up by that many; the cart does not open) and **Buy
it now** goes straight to Shopify's checkout with that many of this item,
first asking whether to bring the cart along when it is not empty. The
cart lives on the device (`lib/store/cart.dart`, shared preferences) and
has its own screen, whose quantity controls reflect what is in it, with a
Checkout for everything.

Checkout goes through Shopify's Storefront GraphQL API when the build
carries the store domain and a public access token (which Shopify designs
to ship inside client apps: it can only read products and create carts).
That lets the signed-in member's email pre-fill the checkout so the order
lands on the matching Shopify customer. Without those values the Store tab
has no products, and checking out a cart uses the store's cart permalink
instead (`SHOPIFY_STORE_URL`, default `https://shop.bikes.pizza`), which
needs no token. The website's build reads the same two values from its
GitHub environment: the `SHOPIFY_STORE_DOMAIN` variable (`infra/`) and the
`SHOPIFY_STOREFRONT_TOKEN` secret (set by hand, see `infra/README.md`).

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
server-only): email, username and newsletter choices. Names are not kept.
Three Cloud Functions are the only way in; the first two require a
signed-in user with a verified email:

- `member` returns the profile (email, username, and every newsletter with
  a subscribed flag), creating it with defaults on first use. New members
  start subscribed to the one newsletter (`functions/members.js`).
- `updateMember` changes the username and/or the set of newsletters.
- `deleteAccount` deletes the caller's Firebase user and member record
  (freeing the username), the same as an admin deleting them. Posts they
  published stay, credited as they were. Any signed-in user may call it,
  verified or not, so an account that never verified can still remove
  itself.

Usernames are 3 to 24 letters, digits or underscores and unique regardless
of case; each is reserved at `usernames/{lowercased}` in the same
transaction that stores it, so two members can never share one. A member
without a username (Google and Apple sign-ins, and accounts from before
usernames existed) is asked to choose one: on the website right after
signing in, in the app on the account screen. Creating a password account
asks for the username and the newsletter choice up front; because the
member functions need a verified email, those wait on the device (browser
`localStorage`, or the app's preferences) and are sent once the email is
verified. The username is the default credit on the submission form.

**Usernames on posts.** Each submitted post carries its credit (the
member's account id, username and the name they typed), so the website
and the app read it with the post. A rename updates the credit on every
post of that member (`updateMember` does it and asks for a site rebuild). The credit on a post links to everything the
member has posted: `/member/<username>/` on the website, a "Posts by"
list in the app. Posts whose member has not chosen a username yet show the
typed credit instead. `tool/backfill_post_authors.py` adds the reference
to posts published before this existed.

The app's Settings → Account → Manage account screen (`lib/account/`) and
the website's account page use them; the app adds a password change for
email/password accounts. Password accounts must verify their email first
(Settings shows a "Verify your email" tile); Google and Apple accounts are
verified already. Newsletter sending is not part of this app yet; the flag
records the choice. Both screens also offer two-factor authentication, off
by default: turning it on walks through adding bikes.pizza to an
authenticator app (QR code, or on the phone a button that opens the app)
and every sign-in afterwards, on the website and in the app, asks for the
app's code. Turning it off removes the factor after an "Are you sure?".

**Passkeys.** The account page also lets a member add a passkey on the
device they are using (Face ID, Touch ID or the screen lock; up to ten per
account, each named after the browser and device, removable from the
list) and offers "Sign in with a passkey" on its sign-in screen. A passkey
sign-in is verified by the `passkey*` Cloud Functions
(`functions/passkeys.js`, WebAuthn) and ends in a Firebase custom token;
that path is not subject to Firebase's multi-factor step, so on an account
with two-factor authentication on the passkey takes the place of the
authenticator code. It does so however the sign-in started: signing in
with Apple, Google or a password on a device that holds a passkey for the
account finishes with the passkey and never asks for a code, and the code
step is what a device without one gets (with a button to try a passkey
anyway). The app offers the same: "Sign in with a passkey" on its sign-in
screen and a Passkeys section on Manage account
(`lib/auth/passkey_service.dart`, on the `passkeys` package); the platform
trust it needs is described in `docs/firebase.md`. The review and admin
pages sign in with a passkey too, since a passkey counts as their required
second factor; passkeys are added and removed on the account page only.
Both also offer "Delete account", at the very bottom (in the app, at the
end of the Settings screen): after a confirmation it calls
`deleteAccount` and signs the member out.

Run the functions' unit tests with `npm test` inside `functions/`.

## Website sign-up (same accounts as the app)

Website sign-ups go through the account page (`web/public/`), which the
website serves at https://bikes.pizza/account/ (see Website above) and
which is also its own Hosting site. It signs people in with Firebase Auth
(email/password, Google, or Apple once a Services ID is configured; see
`docs/firebase.md`) and sends them back to the site. New email accounts must
verify their address first.

The same page is the members' account screen (`?mode=account`): it shows the
email and sign-in method, lets them edit their username and newsletter choices
(through the `member` and `updateMember` functions) and, for email/password
accounts, change their password or request a reset email.

**Admin page**: `web/admin/`, its own Hosting site served at
https://admin.bikes.pizza/ (https://admin.bikes-pizza.dev/ for the
development project), with three sections. **News** is where news posts are
written: a list of the news on the site and a dialog with the title, the
publish date, an optional photo and the story in a WYSIWYG editor over
Markdown (Toast UI Editor 3.2.2, MIT, a copy under `web/admin/vendor/`
with its license; its toolbar offers only
what the site renders, and pictures dropped into the story are uploaded
through `/api/admin/uploads` to `posts/inline/` in Storage); publishing,
saving an edit or removing a post rebuilds the website, and the app picks
the change up from Firestore (the endpoints are `/api/admin/posts` and
`/api/posts/{id}`, `functions/posts.js`). **Users** is for keeping an eye
on who has signed up and removing stale accounts. Same sign-in rule as
the review page (the `admin` claim and a second factor) and the same
`/api/` rewrite; the user endpoints are under `/api/admin/users`
(`functions/admin_users.js`). It lists every Firebase user, ordered by
their most recent post: username, newsletter status, post count and the
latest post. Opening a user shows the email, how they sign in (Email,
Google, Apple), verification, join and last sign-in dates and their posts;
username, email and newsletter are editable, with Save enabled only once
something changed and Close never asking about unsaved edits. Email
accounts get a Reset password button (Firebase emails the usual reset
link). Two-factor authentication is required, as on the review page.
Delete user, in red, asks "Are you sure?" and then removes the Auth
user and the member profile, freeing the username; the member's posts
stay, credited as they were. **Comments** is the review desk for
comments: three queues (waiting for review, reported, recent) as a
table of the comment, its post, what the screening saw (the hold
reason, matched words, the moderation scores at or above 30%, report
reasons) and Approve or Restore and Remove buttons (`/api/admin/comments`,
`functions/comments.js`); under it the banned and suspicious word lists,
one entry per line, saved through `/api/admin/moderation`.

All three pages read their Firebase config from Hosting's reserved
`/__/firebase/init.json`, so nothing project-specific is committed. They are
Hosting sites (targets `account`, `review` and `admin` in `firebase.json`,
mapped to site IDs in `.firebaserc`), so each serves its page from `/`. Preview
locally with `firebase emulators:start --only hosting` (uses the live
Firebase project for sign-in) and deploy with `firebase deploy --only hosting`.

There are two Firebase projects. Production (bikes.pizza,
submissions.bikes.pizza) only changes when a GitHub release is published (or
when the "Deploy to production" workflow is run by hand). Every merge to
`main` deploys the same code to the development project, served at
https://bikes-pizza.dev/ and https://submissions.bikes-pizza.dev/, with its
own Firestore, Auth users, Storage and Cloud Functions. The workflows
authenticate without any stored key: GitHub's OIDC token is exchanged for a deploy-only service account via
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
  data/post_repository.dart     PostRepository interface
  data/firestore_post_repository.dart   posts over Firestore's REST API
  data/firestore.dart           Firestore REST client and value decoder
  screens/post_list_screen.dart list with pull-to-refresh + infinite scroll
  screens/post_detail_screen.dart
  screens/edit_post_screen.dart edit a post (photo, title, story, details)
  screens/my_posts_screen.dart  Settings > Posts: the member's posts
  widgets/edit_post_button.dart Edit button for the poster and admins
  posts/post_editor.dart        PostEditor on the REST API's /api/posts
  api/api_client.dart           REST API client (ID token, JSON, errors)
  admin/admin_service.dart      AdminService on the review and admin endpoints
  admin/admin_screen.dart       the Admin tab's menu
  admin/submissions_screen.dart review submissions (queues, actions)
  admin/users_screen.dart       manage users
  screens/settings_screen.dart
  screens/store_screen.dart     Shopify product grid, or placeholder
  screens/product_detail_screen.dart
  store/product.dart            Product / variant / money models
  store/store_repository.dart   StoreRepository + Shopify Storefront client
  widgets/post_tile.dart        title + thumbnail row
test/                           unit tests for both backends, widget tests
functions/                      Cloud Functions (submissions, members, REST API)
site/                           Astro website
web/                            account page and submissions review page
infra/                          Pulumi program for the cloud resources (dev, prod stacks)
```

## Development

```sh
flutter pub get
dart format lib test   # CI fails if this would change anything
flutter analyze
flutter test
flutter run            # pick a connected device / simulator
```

Debug and profile builds (simulators, devices while developing) use the
development Firebase project, `bikes-pizza-dev`, and its posts, so nothing
done from a simulator touches bikes.pizza's users, posts or submissions. Release builds, the ones that go to the app stores,
use production. The choice is made at start-up from the build mode
(`lib/main.dart`, `lib/config.dart`); the native config files for both
projects are in the repo (`android/app/src/debug/` and `ios/dev/` for
development), and an Xcode build phase bundles the right iOS plist per
configuration. Sign in on a debug build with an account created on
bikes-pizza.dev; Google sign-in there waits on the Google provider being
enabled on the dev project.

Formatting, `flutter analyze`, `flutter test`, the Cloud Functions unit
tests, the infrastructure typecheck, the contract check and a build of the
website run on GitHub Actions for pull requests targeting `main`
(`.github/workflows/pr-checks.yml`). Each check runs only when the files
it covers changed, so a docs-only pull request finishes in seconds; shared
inputs such as the contract trigger every check that consumes them, and a
change to the workflow itself runs all of them. Merging to `main` deploys the Cloud
Functions, the website and the account page to the development project
(`.github/workflows/deploy-dev.yml`); publishing a GitHub release deploys
them to production (`.github/workflows/deploy-firebase.yml`). Both call
`.github/workflows/deploy.yml`. App store release workflows will be added
later.

The bottom bar has All (every post), Blog, Pizza and Bikes (one feed
each, matching the website's filters), Store and Settings. Adding or
renaming tabs: edit `PostFeed` in `lib/models/post_feed.dart` and the
`NavigationDestination` list in `lib/main.dart`.

App icon: the source files live in `assets/icon/` (`icon.png` for Android's
legacy launcher icon, `icon_ios.png` as an opaque square for iOS, and
`icon_android_fg.png`, the padded foreground of the Android adaptive icon;
its background color is set in `pubspec.yaml`). After replacing them run
`dart run flutter_launcher_icons` to regenerate the platform icon sets, and
discard the change the tool makes to `ios/Runner.xcodeproj/project.pbxproj`
(it rewrites an unrelated build setting).

Launch (splash) screen: the logo above the "bikes.pizza" wordmark (Inter
Light, like the website's title) on the icon's teal, sized to 80% of the
screen's shorter side so it is the same in portrait and landscape.
`tool/splash/render_splash.py` renders it from `assets/icon/icon.png` and
writes the iOS launch image set, the Android drawables (a window
background for Android 11 and older, a logo-only icon for the Android 12+
system splash, which cannot show text) and `assets/splash/splash.png`,
which `lib/splash_screen.dart` draws while the app finishes starting up;
the script's docstring has the commands. Simulators cache the iOS launch
screen, so reinstall the app to see a changed one.
