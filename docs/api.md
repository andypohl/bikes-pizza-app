# Submissions REST API

The review page and, in future, the app talk to submissions through a small
REST API served at `https://submissions.bikes.pizza/api/`. It is the
`api` Cloud Function (`functions/api.js`), reached through a Hosting rewrite
on the submissions site, and shares its logic with the `submitPost` and
`reviewSubmission` callables (`functions/submissions.js`).

## Authentication

Every request carries a Firebase ID token:

```
Authorization: Bearer <ID token>
```

The token's account must have a verified email. Endpoints marked *admin*
also need the `admin` custom claim (granted with `tools/grant_admin.py`).
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
| 503    | `unavailable`         | Sanity, Storage or another dependency failed      |

Messages are safe to show to the person.

## Endpoints

### `GET /api/me`

Who the token belongs to: `{ "uid", "email", "name", "admin" }`.

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

Body: `{ "action": "publish" | "draft" | "reject", "note": "optional, ≤1000 chars" }`.

- `publish` puts the submission at the back of its feed's queue (see
  Queues) and returns `{ "status": "queued", "id", "position", "feed",
  "length", "nextPostAt", "seconds", "countdown", "clock" }`.
- `draft` creates a Sanity draft right away and
  returns `{ "status": "approved", "postId", "postUrl", "postStatus" }`.
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
  "image": { "data": "<base64>", "contentType": "image/jpeg" | "image/png" | "image/webp" }
}
```

The image may be up to 8 MB before encoding. The photo is checked with
Google Cloud Vision before anything is stored: SafeSearch first, then face
detection and object localisation, since photos of people are not wanted.
One that fails answers `400` with the message "Your photo failed Google
SafeSearch inspection. Please choose a different photo." or "Your photo
seems to show a person or a face. Please choose a photo of just the bike or
the pizza." (see `functions/vision.js` for the thresholds). Returns `{ "submissionId", "notified" }`, where
`notified` says whether the reviewer email went out.

## Queues

Approved submissions do not go live immediately. Each feed has a queue
that posts its oldest entry at fixed times in Central Time
(America/Chicago, so daylight saving is followed):

| Feed    | Posting times          |
|---------|------------------------|
| `bikes` | 8am, 12pm, 4pm, 8pm    |
| `pizza` | 9am, 1pm, 5pm, 9pm     |

Scheduled functions call the same code as `submit-next` at those times. A
slot with an empty queue posts nothing. If posting fails, the entry stays
at the front of the queue with `queue.lastError` set and is retried at the
next slot.

`{feed}` below is `pizza` or `bikes`; anything else is a `400`.

### `GET /api/queue/{feed}/length`

`{ "feed", "length" }`, the number of submissions waiting. Any verified
account may call this.

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

### `GET /api/queue/{feed}` (admin)

The queue in posting order: the countdown fields above plus
`"items": [Submission with "position" starting at 1, ...]`.

### `POST /api/queue/{feed}/add` (admin)

Body `{ "id", "note": "optional" }`. Queues a pending submission of that
feed; the same thing the review `publish` action does. Returns the
`"status": "queued"` shape above. A submission of the other feed is a
`400`; one that is not pending is a `409`.

### `POST /api/queue/{feed}/remove` (admin)

Body `{ "id" }`. Takes a queued submission back to pending. Returns
`{ "status": "pending", "id", ...countdown fields }`. Not queued: `409`.

### `POST /api/queue/{feed}/submit-next` (admin)

Posts the oldest queued submission to the blog now, without waiting for
the schedule. Returns `{ "posted": Submission | null, ...countdown fields }`;
`posted` is `null` when the queue was empty. A failure at Sanity answers
`503` and leaves the entry queued.

## Submission

```json
{
  "id": "…",
  "feed": "bikes",
  "title": "1991 Trek 970",
  "from": "Ada",
  "description": "…",
  "status": "pending" | "queued" | "posting" | "approved" | "rejected",
  "createdAt": "2026-09-04T16:00:00.000Z",
  "submittedBy": { "uid": "…", "email": "…" },
  "image": { "width": 2048, "height": 1536, "photoUrl": "https://…", "thumbUrl": "https://…" },
  "safeSearch": { "adult": "VERY_UNLIKELY", "spoof": "UNLIKELY", "medical": "VERY_UNLIKELY", "violence": "VERY_UNLIKELY", "racy": "UNLIKELY" },
  "people": { "faces": 0, "faceConfidence": 0, "persons": 1, "personScore": 0.2 },
  "queue": null | {
    "at": "…", "by": "<uid>", "byEmail": "…", "note": "…",
    "postedAt": "…" | null, "lastError": "…" | null
  },
  "review": null | {
    "action": "publish" | "draft" | "reject",
    "at": "…", "by": "<uid>", "byEmail": "…", "note": "…",
    "postId": "…" | null, "postUrl": "…" | null, "postStatus": "published" | "draft" | null
  }
}
```

`photoUrl` and `thumbUrl` are Cloud Storage download links carrying a
per-submission token, so they work in an `<img>` or an image widget without
further authentication. Treat them as private: anyone holding the link can
open the photo.

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
