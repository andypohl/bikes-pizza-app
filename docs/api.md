# Submissions REST API

The review page and, in future, the app talk to submissions through a small
REST API served at `https://submissions.pizzapredator.com/api/`. It is the
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
| 503    | `unavailable`         | Ghost, Storage or another dependency failed       |

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

`publish` and `draft` create the Ghost post from the Markdown template and
return `{ "status": "approved", "postId", "postUrl", "postStatus" }`;
`reject` returns `{ "status": "rejected" }`. A submission that was already
posted answers `409`.

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

The image may be up to 8 MB before encoding. Returns
`{ "submissionId", "notified" }`, where `notified` says whether the
reviewer email went out.

## Submission

```json
{
  "id": "…",
  "feed": "bikes",
  "title": "1991 Trek 970",
  "from": "Ada",
  "description": "…",
  "status": "pending" | "approved" | "rejected",
  "createdAt": "2026-09-04T16:00:00.000Z",
  "submittedBy": { "uid": "…", "email": "…" },
  "image": { "width": 2048, "height": 1536, "photoUrl": "https://…", "thumbUrl": "https://…" },
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
