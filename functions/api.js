// REST API for submissions, served at https://submissions.bikes.pizza/api/
// through a Hosting rewrite to the `api` function (see index.js). Every
// request carries a Firebase ID token as `Authorization: Bearer <token>`.
//
//   GET  /api/submissions               admin; ?status=&limit=&after=
//
// "admin" means a user with the `admin` claim whose token was minted after
// a second factor (see secondFactorAdminFromClaims in errors.js): the
// review and admin pages make administrators enrol an authenticator app.
//   GET  /api/submissions/:id           admin
//   POST /api/submissions/:id/review    admin; {action, note}
//   POST /api/submissions               verified user; same body as submitPost
//   GET  /api/queue/:feed/countdown-time {feed, length, nextPostAt, seconds, countdown, clock}
//   POST /api/queue/:feed/remove        admin; {id}
//   GET  /api/site/settings             public (no token); {submitButton}
//   POST /api/site/settings             admin; {submitButton: boolean}
//   GET  /api/posts                     verified user; the posts credited to them
//   GET  /api/posts/:id                 the credited member, or an admin
//   PATCH /api/posts/:id                same; {title?, story?, image?, images?, bike?, pizza?}
//   DELETE /api/posts/:id               admin; takes the post off the site
//   GET  /api/admin/posts               admin; ?feed=news — the feed's posts, newest first
//   POST /api/admin/posts               admin; {title, story?, storyFormat?, image?, publishedAt?} — writes a news post
//   POST /api/admin/uploads             admin; {image} — a picture for inside a story; {url, width, height}
//   GET  /api/admin/users               admin; ?page=&pageSize= — by most recent post
//   GET  /api/admin/users/:uid          admin
//   PATCH /api/admin/users/:uid         admin; {username?, email?, newsletters?}
//   DELETE /api/admin/users/:uid        admin
//
// The admin page (web/admin/) reaches these through the same rewrite on its
// own Hosting site.
//
// Errors are JSON: {"error": {"code": "...", "message": "..."}}.

import cors from "cors";
import express from "express";

import { ValidationError } from "./account.js";
import { AppError, actorFromClaims, secondFactorAdminFromClaims, userFromClaims } from "./errors.js";

export const STATUS_FOR_CODE = {
  "invalid-argument": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "failed-precondition": 409,
  unavailable: 503,
};

// The main photo and up to IMAGE_MAX_EXTRA more, base64, plus the text
// fields; Cloud Run stops requests at 32 MB anyway, so clients downscale
// photos before sending (the contract's IMAGE_MAX_EDGE).
export const BODY_LIMIT = "32mb";

/**
 * Builds the Express app.
 *
 * `verifyToken(idToken)` resolves to the token's claims or rejects.
 * `service` exposes create(data, user), list(query), get(id),
 * review(input, admin) and a `queue` with info(feed) and
 * remove(input, admin), a
 * `site` with settings() and updateSettings(data, admin), `users`
 * with list(query), get(uid), update(uid, data, admin) and remove(uid,
 * admin), and `posts` with mine(user), get(id, actor) and update(id, data,
 * actor); see index.js for the wiring.
 */
export function createApi({ verifyToken, service, log = () => {} }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(cors({ origin: true, methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["Authorization", "Content-Type"] }));
  app.use(express.json({ limit: BODY_LIMIT }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((body) => res.json(body), next);

  // Read by the website at page load, so it needs no token and no caching.
  app.get(
    "/api/site/settings",
    wrap(async (req, res) => {
      res.set("Cache-Control", "no-store");
      return service.site.settings();
    }),
  );

  const api = express.Router();
  api.use(authMiddleware(verifyToken));

  api.post(
    "/site/settings",
    wrap((req) => service.site.updateSettings(req.body, secondFactorAdminFromClaims(req.claims))),
  );

  api.get(
    "/submissions",
    wrap((req) => {
      secondFactorAdminFromClaims(req.claims);
      return service.list(req.query);
    }),
  );

  api.post(
    "/submissions",
    wrap((req) => service.create(req.body, userFromClaims(req.claims))),
  );

  api.get(
    "/submissions/:id",
    wrap((req) => {
      secondFactorAdminFromClaims(req.claims);
      return service.get(req.params.id);
    }),
  );

  api.post(
    "/submissions/:id/review",
    wrap((req) => service.review({ ...req.body, id: req.params.id }, secondFactorAdminFromClaims(req.claims))),
  );

  const queue = service.queue;
  api.get(
    "/queue/:feed/countdown-time",
    wrap((req) => {
      userFromClaims(req.claims);
      return queue.info(req.params.feed);
    }),
  );
  api.post(
    "/queue/:feed/remove",
    wrap((req) => queue.remove({ ...req.body, feed: req.params.feed }, secondFactorAdminFromClaims(req.claims))),
  );

  // Editing posts: the credited member, or an admin whose session passed
  // a second factor (actorFromClaims); the service decides per post.
  const posts = service.posts;
  if (posts) {
    api.get("/posts", wrap((req) => posts.mine(userFromClaims(req.claims))));
    api.get("/posts/:id", wrap((req) => posts.get(req.params.id, actorFromClaims(req.claims))));
    api.patch("/posts/:id", wrap((req) => posts.update(req.params.id, req.body, actorFromClaims(req.claims))));
    if (posts.remove) api.delete("/posts/:id", wrap((req) => posts.remove(req.params.id, secondFactorAdminFromClaims(req.claims))));
    if (posts.list) api.get("/admin/posts", wrap((req) => posts.list(req.query, secondFactorAdminFromClaims(req.claims))));
    if (posts.create) api.post("/admin/posts", wrap((req) => posts.create(req.body, secondFactorAdminFromClaims(req.claims))));
    if (posts.upload) api.post("/admin/uploads", wrap((req) => posts.upload(req.body, secondFactorAdminFromClaims(req.claims))));
  }

  const users = service.users;
  if (users) {
    api.get(
      "/admin/users",
      wrap((req) => {
        secondFactorAdminFromClaims(req.claims);
        return users.list(req.query);
      }),
    );
    api.get(
      "/admin/users/:uid",
      wrap((req) => {
        secondFactorAdminFromClaims(req.claims);
        return users.get(req.params.uid);
      }),
    );
    api.patch(
      "/admin/users/:uid",
      wrap((req) => users.update(req.params.uid, req.body, secondFactorAdminFromClaims(req.claims))),
    );
    api.delete(
      "/admin/users/:uid",
      wrap((req) => users.remove(req.params.uid, secondFactorAdminFromClaims(req.claims))),
    );
  }

  app.use("/api", api);

  app.use((req, res) => {
    res.status(404).json({ error: { code: "not-found", message: "No such endpoint." } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const { code, message } = describe(error);
    if (code === "unavailable") log("api request failed", { path: req.path, error: String(error?.stack ?? error) });
    res.status(STATUS_FOR_CODE[code]).json({ error: { code, message } });
  });

  return app;
}

function authMiddleware(verifyToken) {
  return async (req, res, next) => {
    try {
      const [scheme, token] = (req.get("authorization") ?? "").split(" ");
      if (scheme !== "Bearer" || !token) throw new AppError("unauthenticated", "Sign in first.");
      try {
        req.claims = await verifyToken(token);
      } catch {
        throw new AppError("unauthenticated", "Your session has expired. Sign in again.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Maps any error to an API code and a message safe to show. */
export function describe(error) {
  if (error instanceof AppError && error.code in STATUS_FOR_CODE) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ValidationError) return { code: "invalid-argument", message: error.message };
  if (error?.type === "entity.too.large") {
    return { code: "invalid-argument", message: `The request is too large (limit ${BODY_LIMIT}).` };
  }
  if (error?.type === "entity.parse.failed") {
    return { code: "invalid-argument", message: "The request body is not valid JSON." };
  }
  return { code: "unavailable", message: "Something went wrong. Please try again." };
}
