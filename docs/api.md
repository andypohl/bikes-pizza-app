# Submissions REST API

The review page and, in future, the app talk to submissions through a small
REST API served at `https://submissions.bikes.pizza/api/`. It is the
`api` Cloud Function (`functions/api.js`), reached through a Hosting rewrite
on the submissions site, and shares its logic with the `submitPost`
callable (`functions/submissions.js`).

## Authentication

Every request carries a Firebase ID token:

```
Authorization: Bearer <ID token>
```

The token's account must have a verified email. Endpoints marked *admin*
also need the `admin` custom claim (granted with `tool/grant_admin.py`).
A missing or expired token gets `401`; a verified account without the claim
gets `403`.

## Errors

Failures are JSON with an HTTP status and a stable code:

```json
{ "error": { "code": "not-found", "message": "That submission no longer exists." } }
```

| Status | Code                  | When                                              |
|--------|-----------------------|---------------------------------------------------|
| 400    | `invalid-argument`    | Bad field, filter, cursor, action or body         |
| 401    | `unauthenticated`     | No token, or it could not be verified             |
| 403    | `permission-denied`   | Admin endpoint without the claim                  |
| 404    | `not-found`           | Unknown submission or endpoint                    |
| 409    | `failed-precondition` | Unverified email; submission already posted       |
| 503    | `unavailable`         | Firestore, Storage or another dependency failed   |

Messages are safe to show to the person.

## Endpoints

### `GET /api/submissions` (admin)

Lists submissions, newest first.

| Query    | Meaning                                                    |
|----------|------------------------------------------------------------|
| `status` | `pending`, `approved` or `rejected`; omit for all           |
| `limit`  | Page size, 1 to 50 (default 20)                            |
| `after`  | The `nextCursor` of the previous page                      |

Response: `{ "items": [Submission, ...], "nextCursor": "<id>" | null }`.
Pass `nextCursor` back as `after` to get the following page.

### `GET /api/submissions/{id}` (admin)

One `Submission`.

### `POST /api/submissions/{id}/review` (admin)

Body: `{ "action": "publish" | "reject", "note": "optional, ≤1000 chars" }`.

- `publish` puts the submission at the back of its feed's queue (see
  Queues) and returns `{ "status": "queued", "id", "position", "feed",
  "length", "nextPostAt", "seconds", "countdown", "clock" }`.
- `reject` returns `{ "status": "rejected" }`.

Only pending submissions can be reviewed; anything else answers `409`.

### `POST /api/submissions`

Creates a submission for the signed-in member (the same body the
`submitPost` callable takes):

```json
{
  "feed": "pizza" | "bikes",
  "title": "…",
  "from": "…",
  "description": "optional",
  "image": { "data": "<base64>", "contentType": "image/jpeg" | "image/png" | "image/webp" },
  "images": [ { "data": "<base64>", "contentType": "…" }, ... ]
}
```

`image` is the main photo; `images` (optional) are up to four additional
pictures, in the order they should appear. Each may be up to 8 MB before
encoding, but the whole request must stay under 32 MB, so clients scale
photos down first (2048 px on the long side; the app and the website
both do). Every photo is checked with Google Cloud Vision before anything
is stored, the main one first and then the additional ones in order:
SafeSearch first, then face detection and object localisation, since
photos of people are not wanted. One that fails answers `400` with the
message "Your photo failed Google SafeSearch inspection. Please choose a
different photo." or "Your photo seems to show a person or a face. Please
choose a photo of just the bike or the pizza." (see `functions/vision.js`
for the thresholds); for an additional picture the message starts with
"Additional photo 2" instead of "Your photo", so the member knows which
one to swap. Returns `{ "submissionId", "notified" }`, where `notified`
says whether the reviewer email went out.

## Queues

Approved submissions do not go live immediately. Each feed has a queue
that posts its oldest entry at fixed times in Central Time
(America/Chicago, so daylight saving is followed):

| Feed    | Posting times          |
|---------|------------------------|
| `bikes` | 8am, 12pm, 4pm, 8pm    |
| `pizza` | 9am, 1pm, 5pm, 9pm     |

Scheduled functions post at those times. A slot with an empty queue posts
nothing. If posting fails, the entry stays
at the front of the queue with `queue.lastError` set and is retried at the
next slot.

`{feed}` below is `pizza` or `bikes`; anything else is a `400`.

### `GET /api/queue/{feed}/countdown-time`

Any verified account. When the feed next posts and how long that is:

```json
{
  "feed": "bikes",
  "length": 2,
  "nextPostAt": "2026-09-04T17:00:00.000Z",
  "seconds": 5400,
  "countdown": "1h 30m 0s",
  "clock": "01:30:00"
}
```

`countdown` drops leading zero units (`"32m 14s"`, `"14s"`); `clock` is
always `HH:MM:SS`. The next slot is reported even when the queue is empty.

### `POST /api/queue/{feed}/remove` (admin)

Body `{ "id" }`. Takes a queued submission back to pending. Returns
`{ "status": "pending", "id", ...countdown fields }`. Not queued: `409`.

## Submission

```json
{
  "id": "…",
  "kind": "post" | "edit",
  "post": null | { "id", "slug", "title", "feed", "url", "imageUrl" },
  "changes": null | { "title"?, "story"?, "bike"?, "pizza"?, "image": boolean, "images": boolean },
  "feed": "bikes",
  "title": "1991 Trek 970",
  "from": "Ada",
  "description": "…",
  "status": "pending" | "queued" | "posting" | "approved" | "rejected",
  "createdAt": "2026-09-04T16:00:00.000Z",
  "submittedBy": { "uid": "…", "email": "…" },
  "image": { "width": 2048, "height": 1536, "photoUrl": "https://…", "thumbUrl": "https://…" },
  "images": [
    { "kept": false, "width": 2048, "height": 1536, "photoUrl": "https://…", "thumbUrl": "https://…",
      "safeSearch": { … }, "people": { … } },
    ...
  ],
  "safeSearch": { "adult": "VERY_UNLIKELY", "spoof": "UNLIKELY", "medical": "VERY_UNLIKELY", "violence": "VERY_UNLIKELY", "racy": "UNLIKELY" },
  "people": { "faces": 0, "faceConfidence": 0, "persons": 1, "personScore": 0.2 },
  "queue": null | {
    "at": "…", "by": "<uid>", "byEmail": "…", "note": "…",
    "postedAt": "…" | null, "lastError": "…" | null
  },
  "review": null | {
    "action": "publish" | "reject",
    "at": "…", "by": "<uid>", "byEmail": "…", "note": "…",
    "postId": "…" | null, "postUrl": "…" | null, "postStatus": "published" | null
  }
}
```

`safeSearch` and `people` are what Vision saw in the main photo; each
entry of `images` (the additional pictures, in order) carries its own.

A submission of kind `edit` is a member's request to change one of their
published posts (see Posts): `post` names the post, `changes` holds the
new values (`image: true` means a new main photo, held at `photoUrl`;
`images: true` means the additional pictures change), and `title` and
`description` read as the post would after the edit. When the additional
pictures change, `images` is the list as the post would have it: a
picture the post already has appears with `"kept": true` and its
published rendition URLs (no Vision fields), a new one with `"kept":
false` and its held upload. On review, `publish` applies the edit to the
post right away (no queue; the reply is the `"status": "approved"` shape
with the post's id and URL), `reject` drops it, and the queue endpoints
refuse it. Its `image` URLs are null when the main photo is not changing.

`photoUrl` and `thumbUrl` are Cloud Storage download links carrying a
per-submission token, so they work in an `<img>` or an image widget without
further authentication. Treat them as private: anyone holding the link can
open the photo.

## Posts

Members can edit the posts credited to them (the `author` reference on a
post, set when a submission is published) from the app; administrators can
edit any post. For these endpoints "admin" means the `admin` claim on a
token minted after a second factor, as elsewhere; an admin signed in
without one is treated as an ordinary member. A post the caller may not
edit answers `404`, the same as one that does not exist.

A member's edit does not change the post: it is stored as a submission of
kind `edit` (see Submission below), the reviewer is emailed, and the
change reaches the post when the review page applies it. An
administrator's edit is applied at once.

### `GET /api/posts`

The caller's published posts, newest first:

```json
{ "posts": [Post summary, ...] }
```

Each summary is `{ "id", "slug", "feed", "title", "publishedAt", "url",
"summary", "image", "details", "credit", "gallery" }`: `id` is the slug
(the Firestore document id), `url` the post's page on the website and
`image` the post's photo as stored on the post (`base`, `sizes`,
`formats`, `width`, `height`, `blur`, `focus`; see Posts in Firestore
below) plus `url`, the largest JPEG, for clients that want one picture,
and `images` the additional pictures in the same shape.

### `GET /api/posts/{id}`

The post as its editor sees it: the summary fields plus

```json
{
  "story": "First paragraph.\n\nSecond paragraph.",
  "storyFormat": "text",
  "storyHasFormatting": false,
  "bike": { "brand": "GT", "year": "1990s", "color": "", "type": "mtb" } | null,
  "pizza": { "style": "detroit" } | null,
  "images": [ { "base", "version", "sizes", …, "url" }, ... ],
  "pendingEdit": null | { "id": "<submission id>", "createdAt": "…" }
}
```

`images` are the post's additional pictures in order, each like `image`
with `url` added; `version` is what an edit sends back to keep one.

`story` is the body as written and `storyFormat` how: `text` (what members
write: paragraphs separated by blank lines) or `markdown` (what
administrators may write). `storyHasFormatting` is true for Markdown;
a member saving a new story over it turns it back into plain text. `bike` is present on bike posts and `pizza` on pizza
posts, each with every field, empty when not set; the values are the ones
in `contract/options.json`.
`pendingEdit` names the edit of this post that is waiting for review, if
there is one (a member may not send another until it is reviewed).

### `PATCH /api/posts/{id}`

Asks for changes to the fields given, leaving the rest alone:

```json
{
  "title": "…",
  "story": "…",
  "storyFormat": "text" | "markdown",
  "image": { "data": "<base64>", "contentType": "image/jpeg" | "image/png" | "image/webp" },
  "images": [ { "keep": "<version>" } | { "data": "<base64>", "contentType": "…" }, ... ],
  "bike": { "brand": "…", "year": "…", "color": "…", "type": "…" },
  "pizza": { "style": "…" }
}
```

`images` replaces the additional pictures as a whole with the list given,
in that order, at most four: `keep` names a picture the post already has
by its `version`, anything else is a new upload. Leaving a picture out
drops it; an empty list removes them all; a `version` the post no longer
has answers `400`. New uploads are treated like a new `image` below.

`storyFormat` may only be sent by an administrator (a member's story is
always text). `bike` and `pizza` replace the post's details as a whole: send every field,
with an empty string to clear one. A new `image` or additional picture
(8 MB max before encoding, 32 MB for the whole request) goes through the
same pipeline as a submission's photo (rotation fixed, 2048px long edge,
JPEG) and, for members, the same Google Cloud Vision checks, with the same
`400` messages, an additional picture's naming it ("Additional photo 2
…"); every new photo is checked before any is stored. Administrators'
photos are not inspected. The slug, and so the URL, never changes.

For a member the reply is `{ "status": "pending", "submissionId",
"notified" }`, `notified` saying whether the reviewer email went out; a
second edit while one is pending answers `409`. For an administrator it
is `{ "status": "applied", "post": … }` with the post as `GET
/api/posts/{id}` now reads. Unknown fields, details for the wrong feed, an
unknown option value or an empty title answer `400`. The website is rebuilt
once the post changes.

## Posts in Firestore

Published posts live in Firestore at `posts/{slug}` and are readable by
anyone through Firestore's REST endpoint (the security rules allow reads
of documents whose `status` is `published`; a list query must filter on
it). The website builds from them and the app reads them that way; the
API above is only for editing.

```
slug, feed, title, publishedAt (ISO), status: "published",
changedAt (ISO),           when the post was published or last edited; the
                           app's unread counters watch it
summary,                   one line for lists
body, bodyFormat,          as written: "text" | "markdown"
html,                      rendered from body when it was written
image: null | { base, version, width, height, sizes, formats, blur, focus }
images: [ same shape, ... ]  additional pictures, in order; empty for most posts
details: null | { brand, year, color, type } | { style }
credit: null | { uid, username, name }
source: null | { system: "submission" | "ghost", id, url }
createdAt, updatedAt
```

A photo's renditions (the main one's and each additional picture's
alike) are in Cloud Storage at
`posts/{slug}/{version}/{width}.{jpg|webp}` for each width in `sizes`,
plus `tile.jpg`/`tile.webp` (an 800×600 crop around `focus` for the
gallery); `base` is the URL prefix to append a file name to, followed by
`?alt=media`. `blur` is a data URI of a 20-pixel JPEG to show while a
rendition loads. Rendition paths never change (the version is a hash of the
photo), so they are cached for a year.

## Site settings

Settings the website reads when a page loads. Reading needs no token;
changing them needs the `admin` claim.

### `GET /api/site/settings`

```json
{ "submitButton": true }
```

`submitButton` says whether bikes.pizza shows the "Submit a bike or pizza"
button and accepts submissions on `/submit/` (when off, that page explains
that website submissions are closed and points at the app). Served with
`Cache-Control: no-store`.

### `POST /api/site/settings`

Body: any subset of the settings, each with a value of the right type, for
example `{ "submitButton": false }`. Returns the full settings. Unknown keys
or wrong types answer `400`. The review page has a "Website submit button"
checkbox in its header that calls this.
