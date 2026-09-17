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
  "pizza": { "style": "…" },
  "comments": true | false
}
```

`comments` switches comments on the post on or off. It changes nothing
on the website, so it is applied at once for the post's author as well
as for an administrator, with or without other changes alongside; sent
alone by a member it answers `{ "status": "applied", "post": … }`.

`images` replaces the additional pictures as a whole with the list given,
in that order, at most four: `keep` names a picture the post already has
by its `version`, anything else is a new upload. Leaving a picture out
drops it; an empty list removes them all; a `version` the post no longer
has answers `400`. New uploads are treated like a new `image` below.

`storyFormat` and `publishedAt` (an ISO 8601 instant) may only be sent by
an administrator (a member's story is always text and keeps its date). `bike` and `pizza` replace the post's details as a whole: send every field,
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

### `DELETE /api/posts/{id}` (admin)

Takes a post off the site: its status becomes `removed`, so the website
drops it at the next build and the app stops listing it; the document and
its renditions stay. Returns `{ "removed": "<id>" }`. Needs the second
factor like the other admin endpoints; a member gets `403`.

### `GET /api/posts/{id}/reactions`

The post's reactions, for any verified member. A reaction is an answer
to one of the fixed questions the post's feed asks, each a pick from a
palette of options (`contract/reactions.json`: for a pizza, "I've had
this pizza" and "This pizza has fantastic"; for a bike, "This bike
looks" and "My favorite part of this bike is its"). Every palette takes
one pick at present; the contract's `pick` field ("one" | "many") leaves
room for palettes that take several.

```json
{
  "counts": { "had": { "yes": 12, "no": 3 }, "fantastic": { "crust": 2, "cheese": 4, "sauce": 0, "toppings": 1, "price": 0 } },
  "mine": { "had": ["yes"] },
  "who": { "had": { "yes": { "names": ["ada_bikes", "bob"], "more": 10 }, "no": { "names": [], "more": 3 } }, "fantastic": { … } }
}
```

`counts` has every option of every palette the feed has, zero where
nobody picked it; `mine` the caller's picks, only the palettes they have
answered; `who`, for each option, up to ten usernames of members who
picked it (chosen at random on each call; members without a username
are not named) and how many more picked it. News posts have no palettes
and answer `409`; a removed or unknown post `404`.

### `POST /api/posts/{id}/reactions`

Replaces the caller's picks on the post with `{ "picks": { "<palette>":
["<value>"] } }` (a palette left out, or given an empty list, is
unanswered) and answers as the `GET` does, with everything as it now
stands. Unknown palettes or options, or two picks for a palette that
takes one, are `400`.

### `GET /api/posts/{id}/comments`

A page of the comments under a bike or pizza post, for any verified
member (see `docs/community-design.md` for the design). Top-level
comments come oldest first, `pageSize` (20) at a time, each with its
first `repliesShown` (3) replies and how many replies it has; `?after=`
takes the id of the last top-level comment seen to get the next page.

```json
{
  "count": 12,
  "comments": [
    {
      "id": "c1", "parentId": null, "uid": "u1", "username": "ada_bikes",
      "html": "<p>Great slice, <strong>@bob</strong>!</p>",
      "createdAt": "2026-09-10T10:00:00.000Z", "editedAt": null,
      "status": "published", "removed": false,
      "likeCount": 2, "liked": true, "replyCount": 4, "mine": false,
      "replies": [ { "id": "c2", "parentId": "c1", … } ]
    }
  ],
  "next": "c9"
}
```

`count` is the post's published comments, `liked` whether the caller
likes it and `mine` whether they wrote it (then `text`, the comment as
written, is included too, for editing). A comment held for review
(`status: "pending"`, with `hold`: `"screen"` or `"words"`) is shown only
to its author; a comment the reports took down is shown to nobody; a
removed comment with replies keeps its place as `{ "removed": true,
"html": "", "username": null }`. News posts answer `409`, as does a post
whose comments are switched off (or the sitewide switch, see site
settings); a removed or unknown post `404`.

### `GET /api/posts/{id}/comments/{cid}/replies`

Every visible reply of one top-level comment, oldest first: `{ "id",
"replies": [ … ] }`.

### `POST /api/posts/{id}/comments`

Writes a comment: `{ "text": "…", "parentId": "c1" }` (`parentId` for
a reply; a reply to a reply goes under the same top-level comment).
The text is a Markdown subset (bold, italic, links; `contract/comments.json`
caps it at 1,000 characters): a bare URL becomes `[[link](url)]`, which
reads as "[link]" with the brackets shown around the link, and
`@name` of an existing member is bolded and puts a mention notice under
that member. It is then screened, in order: banned words (the admin's
list) refuse it with `400` and "That comment can't be posted."; Google's
Natural Language moderation scores refuse it at the block threshold
(Toxic, Insult, Profanity, Derogatory, Sexual, Violent at 0.8) or hold
it at the hold threshold (0.5, or Politics at 0.5); suspicious words
hold it. A held comment answers with `status: "pending"` and is shown to
its author as waiting for review. Otherwise it is published at once.
Answers `{ "comment": { … } }` as the `GET` shapes it. One comment per
member every fifteen seconds and two hundred a day (`409` beyond that);
a member without a username gets `409`.

### `PATCH /api/posts/{id}/comments/{cid}`

Replaces the text (`{ "text": "…" }`) of the caller's own comment
within five minutes of writing it, screened again as a new comment is;
`editedAt` is set. After the window, or on someone else's comment, `409`
and `403`.

### `DELETE /api/posts/{id}/comments/{cid}`

Takes a comment down: its author, the author of the post it is under,
or an admin with a second factor. A reply disappears; a top-level
comment with published replies becomes a removed placeholder, without
them it disappears. Answers `{ "removed": "<cid>", "by": "author" |
"postAuthor" | "admin" }`.

### `POST /api/posts/{id}/comments/{cid}/like`

Likes a published comment, or takes the like back: `{ "liked": true,
"likeCount": 3 }`.

### `GET /api/posts/{id}/comments/{cid}/likes`

Who liked it: `{ "likes": [ { "username": "bob", "at": "…" } ] }`,
oldest first.

### `POST /api/posts/{id}/comments/{cid}/report`

Reports a comment with a reason from the contract's list
(`racism`, `misogyny`, `harassment`, `politics`, `spam`, `other`):
`{ "reason": "spam" }`. One report per member per comment, never one's
own (`409`). The second distinct reporter hides the comment until an
admin decides; answers `{ "reported": true, "hidden": false }`.

### `GET /api/me/notices`

The caller's mention notices, oldest first, after `?since=<ISO>` when
given: `{ "notices": [ { "id", "kind": "mention", "post": "<slug>",
"comment": "<cid>", "at": "…" } ] }`. The app's unread tracker fetches
them with its changes query; a post with a notice newer than the last
time it was opened is unread. Notices older than sixty days are deleted
nightly.

### `GET /api/me/export`

Everything the member has, as one JSON document: their record (`member`:
uid, email, username, newsletters, when it was created), the posts
credited to them (`posts`), their comments (`comments`, with the text as
written), likes (`likes`) and reactions (`reactions`), and `exportedAt`.

### `GET /api/admin/comments` (admin)

One of the review queues, `?queue=pending` (held by screening, the
default), `reported` (reported at least once, most reported first) or
`recent` (published, newest first), fifty at most:

```json
{
  "queue": "reported",
  "comments": [
    {
      "id": "c1", "uid": "u1", "username": "ada_bikes", "text": "…", "html": "…",
      "status": "hidden", "hold": "reports", "reportCount": 2, "reports": ["spam", "politics"],
      "screening": { "language": "en", "scores": { "Toxic": 0.12, … }, "matched": [], "reasons": [] },
      "mentions": ["u2"], "post": { "id": "detroit-slice", "title": "Detroit slice", "feed": "pizza", "url": "…" }, …
    }
  ]
}
```

### `POST /api/admin/comments/{id}/{cid}/approve` and `…/remove` (admin)

`approve` publishes a pending or hidden comment (`{id}` is the post),
clearing its reports and sending the mention notices it was waiting to
send; `remove` takes it down as an admin. Answers `{ "comment": { … } }`.

### `GET /api/admin/moderation` and `PUT /api/admin/moderation` (admin)

The word lists the screening uses, `{ "banned": [ … ], "suspicious":
[ … ] }`: words or phrases, matched as whole words regardless of case.
`PUT` replaces both lists (each at most 500 entries of 40 characters)
and answers them normalized.

### `GET /api/admin/posts` (admin)

The news posts on the site, newest first, for the admin page's News
section: `{ "feed": "news", "posts": [Post summary, ...] }` (the same
summary shape as `GET /api/posts`). `?feed=` takes only `news` for now.

### `POST /api/admin/posts` (admin)

Writes a news post and publishes it at once:

```json
{
  "title": "…",
  "story": "Markdown, may be empty",
  "storyFormat": "markdown" | "text",
  "image": { "data": "<base64>", "contentType": "…" },
  "publishedAt": "2026-09-16T10:00:00Z"
}
```

Only `title` is required; `storyFormat` defaults to `markdown`,
`publishedAt` to now, and the photo (not inspected, as with other admin
uploads) is optional. The slug is made from the title plus a random
suffix. Returns `{ "status": "applied", "post": … }` as `GET
/api/posts/{id}` reads it, and the website is rebuilt.

### `POST /api/admin/uploads` (admin)

Stores a picture for use inside a story (the news editor's image button):
body `{ "image": { "data": "<base64>", "contentType": "…" } }`, up to 8 MB
before encoding. The picture is normalized like any upload (rotation
fixed, 2048px long edge, JPEG), kept under `posts/inline/` in Cloud
Storage where it is public and cached like the renditions, and answered
as `{ "url", "width", "height" }` for the Markdown `![alt](url)`. Not
inspected, as with other admin uploads.

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
reactions: { <palette>: { <value>: <count> } }   how many members picked each
                           reaction option; absent until someone reacts
commentCount,              published comments; absent until someone comments
commentedAt (ISO),         when the newest published comment was written
commentTimes: [ISO, ...]   the newest 20 published comment times, newest
                           first; the app counts unseen comments from them
commentsEnabled            false when the post's author switched comments off;
                           absent or true otherwise
createdAt, updatedAt
```

Each member's own picks are under the post at
`posts/{slug}/reactions/{uid}` as `{ uid, username, picks: { <palette>:
[<value>] }, updatedAt }`; the API keeps the post's tallies in step in
the same transaction, and copies the username there (as on `credit`) so
reactors can be named without a lookup each. Those records are not
readable by clients; the API above serves them.

Comments are under the post too, at `posts/{slug}/comments/{id}`:
`{ uid, username, parentId, text, html, mentions, notified, createdAt,
editedAt, status, hold, removedBy, screening, likedBy: [uid],
replyCount, reportCount }`, with each like at `…/likes/{uid}` (`{ uid,
username, at }`) and each report at `…/reports/{uid}` (`{ uid, reason,
at }`). Mention notices are at `members/{uid}/notices/{id}` and the
moderation word lists at `settings/moderation`. None of these are
readable by clients; the comment endpoints serve them. Neither comments
nor reactions touch `changedAt`.

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
{ "submitButton": true, "comments": true }
```

`submitButton` says whether bikes.pizza shows the "Submit a bike or pizza"
button and accepts submissions on `/submit/` (when off, that page explains
that website submissions are closed and points at the app). `comments`
is the sitewide switch for comments on posts: off, every comment
endpoint answers `409`. Served with `Cache-Control: no-store`.

### `POST /api/site/settings`

Body: any subset of the settings, each with a value of the right type, for
example `{ "submitButton": false }`. Returns the full settings. Unknown keys
or wrong types answer `400`. The review page has a "Website submit button"
checkbox in its header that calls this.
