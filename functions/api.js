// REST API for submissions, served at https://submissions.bikes.pizza/api/
// through a Hosting rewrite to the `api` function (see index.js). Every
// request carries a Firebase ID token as `Authorization: Bearer <token>`.
//
//   GET  /api/me                        who the token belongs to
//   GET  /api/submissions               admin; ?status=&limit=&after=
//   GET  /api/submissions/:id           admin
//   POST /api/submissions/:id/review    admin; {action, note}
//   POST /api/submissions               verified user; same body as submitPost
//   GET  /api/queue/:feed               admin; the queue in posting order
//   GET  /api/queue/:feed/length        {feed, length}
//   GET  /api/queue/:feed/countdown-time {feed, length, nextPostAt, seconds, countdown, clock}
//   POST /api/queue/:feed/add           admin; {id, note}
//   POST /api/queue/:feed/remove        admin; {id}
//   POST /api/queue/:feed/submit-next   admin; posts the oldest entry now
//   GET  /api/site/settings             public (no token); {submitButton}
//   POST /api/site/settings             admin; {submitButton: boolean}
//
// Errors are JSON: {"error": {"code": "...", "message": "..."}}.

import cors from "cors";
import express from "express";

import { ValidationError } from "./account.js";
import { AppError, adminFromClaims, userFromClaims } from "./errors.js";

export const STATUS_FOR_CODE = {
  "invalid-argument": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "failed-precondition": 409,
  unavailable: 503,
};

// Base64 of an 8 MB photo plus the text fields.
export const BODY_LIMIT = "12mb";

/**
 * Builds the Express app.
 *
 * `verifyToken(idToken)` resolves to the token's claims or rejects.
 * `service` exposes create(data, user), list(query), get(id),
 * review(input, admin) and a `queue` with info(feed), items(feed),
 * add(input, admin), remove(input, admin) and submitNext(feed), and a
 * `site` with settings() and updateSettings(data, admin); see index.js for
 * the wiring.
 */
export function createApi({ verifyToken, service, log = () => {} }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(cors({ origin: true, methods: ["GET", "POST"], allowedHeaders: ["Authorization", "Content-Type"] }));
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
    wrap((req) => service.site.updateSettings(req.body, adminFromClaims(req.claims))),
  );

  api.get("/me", wrap((req) => userFromClaims(req.claims)));

  api.get(
    "/submissions",
    wrap((req) => {
      adminFromClaims(req.claims);
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
      adminFromClaims(req.claims);
      return service.get(req.params.id);
    }),
  );

  api.post(
    "/submissions/:id/review",
    wrap((req) => service.review({ ...req.body, id: req.params.id }, adminFromClaims(req.claims))),
  );

  const queue = service.queue;
  api.get(
    "/queue/:feed",
    wrap((req) => {
      adminFromClaims(req.claims);
      return queue.items(req.params.feed);
    }),
  );
  api.get(
    "/queue/:feed/length",
    wrap(async (req) => {
      userFromClaims(req.claims);
      const { feed, length } = await queue.info(req.params.feed);
      return { feed, length };
    }),
  );
  api.get(
    "/queue/:feed/countdown-time",
    wrap((req) => {
      userFromClaims(req.claims);
      return queue.info(req.params.feed);
    }),
  );
  api.post(
    "/queue/:feed/add",
    wrap((req) => queue.add({ ...req.body, feed: req.params.feed }, adminFromClaims(req.claims))),
  );
  api.post(
    "/queue/:feed/remove",
    wrap((req) => queue.remove({ ...req.body, feed: req.params.feed }, adminFromClaims(req.claims))),
  );
  api.post(
    "/queue/:feed/submit-next",
    wrap((req) => {
      adminFromClaims(req.claims);
      return queue.submitNext(req.params.feed);
    }),
  );

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
