# Design review, September 2026

A look at the whole project before the first store release, asking one
question: after eight days, 115 merged pull requests and several changes of
direction, is the design still one you would choose today? Where it is not,
this proposes what to change, including breaking changes to the data model
and the API, and in what order.

The short answer: the foundations are right and worth keeping. What has bent
is the seams between them. Each new feature was bolted on where it was
cheapest at the time, so the same idea now lives in several places (two ways
to call the backend, three copies of the sign-in code, four copies of the
option lists, six ways to build a post's URL), and two editorial surfaces
exist that nobody wants to use. None of that is hard to fix, and all of it
is easier to fix now than after release.

The review covers the app (`lib/`), the Cloud Functions (`functions/`), the
website (`site/`), the Studio and App SDK app (`studio/`, `apps/`), the three
static pages (`web/`), the infrastructure (`infra/`, `.github/`) and the
docs, as of `main` with #114 merged and #115 open.

## 1. How the project got here

| Date | What was added | Where it left a mark |
|---|---|---|
| Sep 2 | Flutter app reading a Ghost blog; Firebase sign-in; Shopify store | `Post.tags`, `excerpt`, `featureImage` are Ghost's names |
| Sep 3 | Ghost members, then Firebase members; account page on Hosting; submissions as Ghost drafts, email via SMTP then Mailgun | Callables for members and submissions |
| Sep 4 | Submissions stored for review; review page; REST API on the submissions site; posting queues; SafeSearch; rename to bikes.pizza; Sanity replaces Ghost; Astro website; dev environment; Pulumi | The API lives at `submissions.<domain>/api`; `pizzapredator` ids survive in the production project, bundle ids and one Hosting site |
| Sep 5 | Usernames, member documents in Sanity, admin claim + 2FA, bike/pizza details, Post details app, shop pages | `member` mirror documents; option lists copied per language; a third editorial surface |
| Sep 6-8 | Passkeys (web, then app, then as a second factor); delete account; admin users page | Sign-in, 2FA and passkey code copied into each web page |
| Sep 10 | News feed; tablet split view; light theme; image sizing | `PostFeed` grows an `all` pseudo-feed |
| Sep 14 | Editing posts (members' edits reviewed); tablet admin screens | The submissions collection becomes a union of two document kinds; the app speaks REST and callables |

Sizes today: app 10.6k lines (48 files) with 4.3k lines of tests; functions
3.2k lines (22 modules, 129 tests); website 3.3k; the three static pages
4.7k; Studio schema 0.5k; Post details app 0.6k; Pulumi 0.7k.

## 2. What is right and should stay

- **Sanity for public content, Firebase for identity and private state.**
  Posts and products are public, cacheable and read by three clients; the
  Sanity CDN serves them with no server in the way. Members, submissions,
  passkeys and settings are private and need transactions; Firestore is the
  right place. This split is the best decision in the project and every
  proposal below preserves it.
- **A static website rebuilt on change.** Astro plus a rebuild webhook, with
  the 5-minute gate, is the right shape for a few posts a day.
  `FUTURE_FEATURES.md` already records when that would change.
- **The app reads Sanity directly.** A paged GROQ query against the CDN is
  simpler and faster than a backend endpoint for reads, and it keeps the
  backend to writes and admin.
- **Pure functions with injected dependencies in the backend.** Every module
  in `functions/` except the wiring is testable without Firebase, and 129
  tests prove it. Keep this style; extend it to the wiring.
- **Two environments, deployed by merge and by release**, with Workload
  Identity and no stored keys.
- **Review before publish**, queues, Vision checks, the admin claim with a
  mandatory second factor. The policy is sound; only its plumbing is
  duplicated.

## 3. Findings, ranked by how much they constrain what comes next

### F1. Two transports to one backend, and the same operation on both

The app calls the backend through Firebase callables for members, passkeys
and new submissions (`lib/account/member_service.dart`,
`lib/auth/passkey_service.dart`, `lib/submissions/submission_service.dart`)
and through REST for post editing and everything admin (`lib/api/`,
`lib/posts/`, `lib/admin/`). The website's account page uses callables
only; the review and admin pages use REST plus two callables for passkey
sign-in. Each transport has its own exception type, error-code switch and
session-expiry flag in the app (`MemberException`, `SubmissionException`,
`PasskeyException`, `ApiException`) and its own `describe()` in each web
page.

Creating a submission and reviewing one exist on both transports. The
`reviewSubmission` callable has no client at all and, worse, checks only
the admin claim (`adminFromClaims`) where the REST route demands a second
factor: it is a way around the 2FA rule. Five REST routes have no caller
either (`GET /api/me`, the queue items/length/add/submit-next routes).

**Proposal:** one transport, REST. Move members, passkeys and submissions
onto `/api`, delete the callables, and give the app one `ApiClient` and one
exception type, the web one `api()` helper. The pre-sign-in passkey calls
become unauthenticated REST endpoints (`POST /api/passkeys/sign-in/options`,
`POST /api/passkeys/sign-in`). Delete the unused routes.

### F2. The API's home is an accident of history

The REST API is reached through a Hosting rewrite on the submissions site
and, since the admin page, a second rewrite on the admin site. The app and
the website therefore call `https://submissions.bikes.pizza/api/...` for
things that have nothing to do with submissions, `cors({origin: true})` is
needed because the website is a different origin, and `PUBLIC_API_URL` has
to be threaded through builds and Pulumi.

**Proposal:** serve the API from the main site, `https://bikes.pizza/api/**`
(and `bikes-pizza.dev/api/**`), with one rewrite on the `home` target. The
website then calls its own origin (no CORS, no `PUBLIC_API_URL`), the app's
`ApiConfig.baseUrl` becomes the site URL it already knows, and the admin
site stops needing a rewrite. Keep the old rewrites for one release as
aliases, then remove them.

### F3. Three web pages, one sign-in flow copied three times

`web/public/app.js`, `web/review/review.js` and `web/admin/admin.js` share
about 270 lines of passkey and second-factor code nearly verbatim (the
review and admin copies differ in four cosmetic lines), plus `api()`,
`describe()`, `show`/`say`/`busy`, the admin+2FA gate, the same HTML shell
and 448 identical CSS lines. There is no build step, so copy-paste is the
only way to share, and no CI check covers `web/review` or `web/admin`.
Every `index.html` hard-codes production URLs, so the development
deployments link back to bikes.pizza. The username rule is copied into two
of the pages by hand.

**Proposal:** one small Vite project in `web/` producing two pages from
shared modules (`auth.ts`, `passkeys.ts`, `second-factor.ts`, `api.ts`, one
stylesheet): the **account** page and one **admin** page that merges the
submissions review and user administration (two tabs, one sign-in). The
account page is built into the website at `/account/` as it is today; the
standalone `account` Hosting target goes away. That takes the Hosting sites
from four to two per environment (home, admin) and removes the `review`
target and the `submissions.` domain, with the tablet admin screens (#115)
as the day-to-day surface and the web admin as the fallback. Add
`npm run build` and `astro check`-style type checking for `web/` to the PR
checks.

### F4. One collection holding two kinds of document, with a fuzzy state machine

`submissions/{id}` now holds new posts and, since #114, `kind: "edit"`
records with extra fields (`post`, `changes`) and edit-only rules scattered
through `submissions.js` and `serialise`. Status names are muddled:
`approved` means "posted" for a queued post, "a Sanity draft exists" for a
drafted one, and "applied" for an edit; the review page labels it
"Posted". The "Save as draft" action exists so a post can be finished in
Studio, which you have said you do not want to use.

**Proposal:** rename the collection to `reviews` and make the two kinds
explicit and symmetrical:

```
reviews/{id}
  type:      "post" | "edit"
  target:    null | { postId, slug, title, feed, url }     (edits only)
  feed, submittedBy: { uid, username, email }, createdAt
  content:   { title, story, image: {...} | null, details: {...} }   (what the post should read after this)
  changes:   ["title", "story", "image", "details"]                  (edits only)
  status:    "pending" | "queued" | "publishing" | "published" | "rejected"
  queue:     { at, byEmail, note, postedAt, lastError } | null
  decision:  { action, at, byEmail, note, postId, postUrl } | null
  checks:    { safeSearch, people }
```

"Draft" goes away as a review action. In its place the admin review screen
lets the reviewer **edit the content before approving** (title, story,
details), which is what "save as draft, fix in Studio" was for. Applying an
edit and publishing a post become one code path: write `content` to the
post (create or patch). The status vocabulary is then the same for both
kinds and matches what the screens say.

### F5. A member is spread over four stores

Firebase Auth holds the account, `members/{uid}` the profile,
`usernames/{key}` the reservation, and Sanity holds a `member` document
(`{uid, username}`) that posts reference so the website can print
usernames at build time. Renames are synced to Sanity "best effort" with a
comment that the next publish will fix it; `tools/backfill_post_authors.py`
exists because posts once lacked the reference; the Studio field is
read-only; the Post details app exists partly to set it.

**Proposal:** denormalize the credit onto the post:
`credit: { uid, username }` (plus the typed name as `credit.name` in place
of `submittedBy`). A rename patches the member's posts (a handful, one
GROQ query, then the usual rebuild); the `member` document type,
`authors.js`, the backfill tool and the read-only Studio field all go. The
website's `/member/<username>/` pages and the app's "Posts by" list filter
on `credit.uid` instead of a reference. The uid is already public through
the `member` documents, so nothing new is exposed.

### F6. Facts that must agree across four languages are copied by hand

| Fact | Copies | Machine-checked |
|---|---|---|
| Bike/pizza option lists | Studio TS, Dart maps, functions JS, (site and Post details import the TS) | functions ↔ Studio only, by regex |
| Feed names and labels | `functions/submission.js`, `schedule.js`, `index.js`, `lib/models/post_feed.dart`, three label maps in `lib/`, `site/src/lib/sanity.ts` | no |
| Post URL shape (`/post/` vs `/news/`) | six implementations; `functions/post.js` `createPost` and `admin_users.js` ignore the news case | no |
| Username rule | `functions/account.js`, `lib/account/member_service.dart`, `web/public/app.js`, `web/admin/admin.js`, prose in HTML | no |
| Image CDN parameters | seven string literals across `lib/` and `web/`; the site uses `@sanity/image-url` | no |
| Posting schedule | `functions/schedule.js` and `docs/api.md` | no |

**Proposal:** a `contract/` directory holding one JSON file per fact
(`feeds.json`, `bike-options.json`, `pizza-options.json`, `rules.json` with
the username pattern and URL templates, `schedule.json`) and a generator
(`tool/contract/generate.mjs`) that writes `studio/schemaTypes/options.ts`,
`functions/contract.js`, `lib/contract.dart` and `site/src/lib/contract.ts`.
A PR check regenerates and fails on a diff. Sanity's schema imports the
generated TS, so the option lists still reach the Studio and the website
without cross-package imports.

### F7. Three editorial surfaces, two of them unwanted

The bike and pizza details are editable in the Studio form, in the Post
details App SDK app and, since #114, in the app. The App SDK app's only
unique power is setting the member link (read-only in Studio by choice).
Writing News and fixing imported posts still require Studio.

**Proposal:** retire `apps/post-details` once the app's admin edit screen
can set the credit (trivial after F5). Add "Write a news post" to the
tablet admin (title, image, story as paragraphs, publish now or schedule),
and an admin-only "Edit as administrator" that can also change the feed,
slug and publish date. Studio stays deployed as the schema owner and the
fallback for rich formatting, with the `visionTool` and multi-workspace
setup as they are; nothing new gets built in it. The Ghost import script
moves to `tool/` with the other one-off tools or is deleted.

### F8. The app threads services by hand and has grown four shapes of "a post"

`BikesPizzaApp` and `HomeShell` each declare the same ten service
parameters; `PostListScreen` takes eight; six of them are nullable purely as
feature flags, so "is this feature available" is re-derived at every level.
`Post`, `PostSummary`, `EditablePost` and `EditedPost` are four
representations bridged by hand inside a widget. `Post` still carries
Ghost's `tags`, `hasTag`, `excerpt` and `featureImage`. `store_screen.dart`
doubles as a widget library. `widget_test.dart` is 2.9k lines with nine
fakes in one file.

**Proposal:** an `AppServices` object provided once through an inherited
widget (`Services.of(context)`), screens taking only their data arguments;
one `Post` model named after the Sanity fields (`feed`, `image`, `body`,
`summary`, `credit`, `details`) used by the feed, the editor and the admin
screens, with the API returning the same shape the app's GROQ projection
does; `PostListScreen` split into the list, the split-view container and
the submit bar; shared store widgets moved to `widgets/`; tests split by
feature with the fakes in `test/fakes/`.

### F9. Two identities, three naming schemes

The production Firebase project, its submissions Hosting site, the Android
`applicationId`, the iOS bundle id, the Kotlin package path, the AASA file,
the Pulumi display name and the functions package name all still say
`pizzapredator`; new resources say `bikes-pizza`; the app says
`bikes_pizza`/`bikesPizza` (snake on Android, camel on iOS). Leftovers:
`pizza_predator.iml`, the retired `com.pizzapredator.pizzaPredator` iOS
registration in `google-services.json`, `description: "A new Flutter
project."` in `pubspec.yaml`, sibling `tool/` and `tools/` directories.

**Proposal:** the Firebase project id cannot change and its Auth users are
real, so it stays; everything else can be made consistent now. Bundle ids
are the one decision with a deadline: changing them (for example to
`pizza.bikes.app` on both platforms) means a new App Store Connect record
and re-doing TestFlight, the AASA/assetlinks files, Pulumi config and the
Google sign-in registrations, roughly a day, and it is only possible before
the first release. If the current ids are acceptable, keep them and only
clean the leftovers.

### F10. Infrastructure is half captured

The `dev` stack is imported; `prod` is config only, so `pulumi up` on it
would fail; state lives in one `~/.pulumi`; DNS is manual on both; the two
Sanity webhooks and their PAT are hand-made; Pulumi manages 8 of the 16
variables `deploy.yml` reads and production's live at repository level
where the program cannot see them; `GITHUB_DISPATCH_TOKEN` is a
hand-created secret; the local debug keystore fingerprint is registered on
production. `docs/firebase.md` still opens by saying there is one project.
Every merge to `main` redeploys functions and all four Hosting sites.

**Proposal:** finish what `infra/TODO.md` lists before the refactor touches
Hosting sites (F2, F3): GCS state backend, import prod, manage DNS, a
`pulumi preview` PR check. Move production's variables onto the
`production` environment so both stacks look alike. Script the Sanity
webhooks (Sanity has an HTTP API for them) or at least document them in the
program's TODO. Path-filter the development deploy.

### F11. Smaller defects worth fixing early

- `functions/post.js` `createPost` builds `/post/<slug>/` for every feed; a
  published news submission would get a wrong URL (only reachable if news
  ever accepts submissions, but `postUrl` sits two functions above it).
- `site/src/components/PostGrid.astro` and `FeaturedRow.astro` use
  `GalleryPost` without importing it; `AccountButton.astro` reads a
  `displayName` that `SiteUser` does not have. Both hidden because the site
  has no `astro check` in CI.
- `studio/scripts/import-ghost-post.ts` falls back to `feed: 'blog'`, a
  value no list knows.
- `deleteAccount` accepts an unverified account by design; document it
  next to the endpoint when it moves to REST.
- The website reads `submitButton` twice (REST and a Firestore listener)
  and caches it a third time in `localStorage`.
- `functions/errors.js`, `index.js`, `submission_store.js` and `mail.js`
  have no tests; the authorization rules and every Firestore query live
  there.
- No PR check covers `firebase.json`, the rules files, `.firebaserc` or the
  native projects.

## 4. Target design

```
                    ┌──────────────── Sanity (content, public) ────────────────┐
                    │ post {title, slug, feed, publishedAt, image, summary,      │
                    │       body, details{bike|pizza}, credit{uid,username,name},│
                    │       source}            product, productVariant (Connect) │
                    └───────────────▲─────────────────────────▲─────────────────┘
                 reads via CDN      │ writes                   │ reads at build
                                    │                          │
   ┌──────────────┐   REST /api   ┌─┴──────────────────────┐   ┌┴─────────────┐  webhook  ┌────────────┐
   │ Flutter app  │──────────────►│ Cloud Functions        │   │ Astro site   │◄──────────│ rebuild    │
   │ feeds, store,│               │ one Express API        │   │ + /account/  │           │ workflow   │
   │ account,     │               │ scheduled queue runners│   │ + /api/** ──►│           └────────────┘
   │ tablet admin │               └─┬──────────────────────┘   └──────────────┘
   └──────────────┘                 │ Firestore (private): members, usernames,
   ┌──────────────┐   REST /api     │ reviews, passkeys, passkeyChallenges, settings
   │ Admin web    │─────────────────┘ Storage: reviews/{id}/photo.jpg, thumb.jpg
   │ (fallback)   │
   └──────────────┘
   Studio: schema owner and fallback editor.   contract/: generated facts for all four languages.
```

- **Sanity post**: `image` (was `mainImage`), `summary` (was `excerpt`),
  `details` (was `bike`/`pizza`, keyed by feed), `credit` (replaces
  `submittedBy` + `author`), no `member` type.
- **Firestore**: `reviews` (F4) replaces `submissions`; the rest unchanged.
- **API** (`docs/api.md` rewritten): `/api/account`, `/api/passkeys/...`,
  `/api/reviews...` (create, list, get, decide, queue), `/api/posts...`
  (mine, get, patch, and admin-only create for news), `/api/users...`,
  `/api/settings`. Same error envelope as today. Served at
  `<site>/api/**`.
- **Clients**: the app with `Services.of(context)`, one `ApiClient`, Sanity
  CDN reads and Shopify checkout; the website with the account page built
  in; one admin web app.
- **Editorial**: everything day-to-day in the app's tablet admin; Studio
  as fallback; no App SDK app.
- **Contract**: `contract/*.json` generated into each language and checked
  in CI.
- **Infra**: two Hosting sites per environment (home, admin); Pulumi
  complete for both stacks with CI preview.

## 5. Migration plan

Ordered so each phase is one to three pull requests that leave `main`
deployable, with the breaking changes grouped where a migration script is
needed. Estimates are working days.

| Phase | What | Breaking? | Size |
|---|---|---|---|
| 0. Hygiene | Delete `reviewSubmission` and `submitPost` callables' unused twins and the five dead routes; fix the news URL in `createPost`; `astro check` in CI; PR checks for `web/`, `firebase.json`, rules; Ghost importer fallback; delete `.iml` files and template text; merge `tools/` into `tool/` | no | 0.5 |
| 1. Contract | `contract/` JSON, generator, generated files replace the four copies of options/feeds/rules/URLs; CI diff check | no | 1 |
| 2. One transport | Members, passkeys and submissions on REST; app and web on one client; callables deleted; API moves to `<site>/api/**` (Pulumi rewrite + firebase.json; old rewrites kept one release) | API: yes (additive first, then removal) | 2 |
| 3. Data model | `reviews` collection with `type`/`content`/`status` (migration script for pending items; old ones can be left); `credit` on posts (script patches every post, deletes `member` docs); Studio schema renames (`image`, `summary`, `details`, `credit`); app `Post` model rename; site projection rename | yes (Sanity documents, Firestore) | 2 |
| 4. Web consolidation | `web/` as a Vite project; account + admin pages from shared modules; account built into the site; `review` target and `submissions.` domain retired (Pulumi); Hosting sites 4 → 2 | infra: yes | 1.5 |
| 5. Editorial | Credit editable in the admin edit screen; "Write a news post" in tablet admin; retire `apps/post-details` (workflow, README); Studio kept | no | 1 |
| 6. App structure | `AppServices` scope; screen splits; store widgets to `widgets/`; tests split by feature | no | 1 |
| 7. Identity | Bundle ids (if chosen), leftovers, consistent Hosting target names | yes if bundle ids change | 0.5-1 |
| 8. Infra | GCS state, import prod, DNS managed, Pulumi CI preview, production variables on the environment, webhooks scripted, dev deploy path filters | no | 1 |

Phases 0 and 1 can start now. Phase 8 should land before phases 2 and 4,
since both change Hosting and DNS and it is better to make those changes
through a program that already matches production. Phases 3 and 5 depend on
each other only through the credit field, so 3 goes first. Everything else
is independent.

## 6. Decisions needed

1. **Bundle ids** (F9): change to one consistent id on both platforms now,
   at the cost of a new App Store Connect record, or keep
   `com.pizzapredator.bikesPizza` / `com.pizzapredator.bikes_pizza` forever.
2. **Where the API lives** (F2): `bikes.pizza/api/**` as proposed, or a
   dedicated `api.bikes.pizza` site. The former needs no new domain.
3. **Keep a web admin at all** (F3): one merged admin page as the fallback
   to the tablet screens, or tablet-only with the web pages deleted. The
   proposal keeps one page.
4. **Drop "Save as draft"** (F4) in favor of editing before approval in the
   review screen.
5. **Denormalize the credit** (F5) and drop the `member` document type.
6. **News from the app** (F7): write news in the tablet admin as plain
   paragraphs (with Studio for anything richer), or keep news in Studio.

## 7. What this review does not recommend

- Replacing Sanity with Firestore, or the static site with a server. Both
  would be more work for less.
- A monorepo tool or shared TypeScript packages across `site/`, `web/`,
  `studio/` and `functions/`. The contract generator gives the sharing that
  matters with none of the toolchain.
- Versioning the API. Before release there is one client per platform and
  the app can be updated with the backend.
- A new production Firebase project to shed the `pizzapredator` id. It
  holds real accounts.
