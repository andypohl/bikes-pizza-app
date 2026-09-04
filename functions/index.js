// Cloud Functions for the PizzaPredator app.
//
// All entry points require a Firebase user with a verified email. The member
// callables work on the Ghost member linked to that user (users/{uid} in
// Firestore; see link.js). Submissions are stored for review and, on
// approval, posted to Ghost (submissions.js); they are reachable both as
// callables and through the REST API in api.js.
//
// ghostSignInUrl:    one-time URL that opens the Ghost site as a signed-in
//                    member, without a magic-link email.
// ghostMember:       the member's profile (name, email, newsletter choices)
//                    for the hosted account page.
// updateGhostMember: changes the member's name and/or newsletters.
// submitPost:        stores a bike/pizza submission (photo + text) in
//                    Firestore and Storage and emails the reviewer.
// reviewSubmission:  admin only; publishes or drafts an approved submission
//                    to Ghost from the Markdown template, or rejects it.
// api:               HTTPS; the REST API behind /api/ on the submissions
//                    Hosting site (list, fetch, review, create).

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { ValidationError, profile, validateUpdate } from "./account.js";
import { createApi } from "./api.js";
import { AppError, adminFromClaims, userFromClaims } from "./errors.js";
import { GhostAdminClient, GhostApiError } from "./ghost.js";
import { processImage } from "./images.js";
import { firestoreStore, resolveMember } from "./link.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { notificationEmail } from "./submission.js";
import { firestoreSubmissionStore } from "./submission_store.js";
import * as subs from "./submissions.js";

initializeApp();

// Set with `firebase functions:secrets:set GHOST_ADMIN_API_KEY`.
const ghostAdminApiKey = defineSecret("GHOST_ADMIN_API_KEY");
// Set in functions/.env (see .env.example); not a secret.
const ghostAdminApiUrl = defineString("GHOST_ADMIN_API_URL");

// Mailgun sends the notification email (see mail.js). The API key is set
// with `firebase functions:secrets:set MAILGUN_API_KEY`; the rest lives in
// functions/.env. Without a real key, domain and recipient the email is
// skipped.
const mailgunApiKey = defineSecret("MAILGUN_API_KEY");
const mailgunDomain = defineString("MAILGUN_DOMAIN", { default: "" });
const mailgunApiBase = defineString("MAILGUN_API_BASE", { default: "https://api.mailgun.net" });
// Who to tell about new submissions.
const notifyEmail = defineString("SUBMISSION_NOTIFY_EMAIL", { default: "" });
// Sender; empty means postmaster@<MAILGUN_DOMAIN>.
const fromEmail = defineString("SUBMISSION_FROM_EMAIL", { default: "" });
// Email of the Ghost staff account that approved posts are attributed to;
// empty leaves Ghost's default author.
const authorEmail = defineString("SUBMISSION_AUTHOR_EMAIL", { default: "" });
// Link put in the notification email; empty means the submissions site.
const reviewPageUrl = defineString("REVIEW_PAGE_URL", { default: "" });

const options = { region: "us-central1", secrets: [ghostAdminApiKey] };
const heavy = { memory: "512MiB", timeoutSeconds: 120 };

/** The signed-in, verified user behind a callable request, or throws. */
const verifiedUser = (request) => userFromClaims(request.auth && { uid: request.auth.uid, ...request.auth.token });
/** A verified user who also carries the `admin` custom claim. */
const adminUser = (request) => adminFromClaims(request.auth && { uid: request.auth.uid, ...request.auth.token });

function ghostClient() {
  return new GhostAdminClient({
    url: ghostAdminApiUrl.value(),
    key: ghostAdminApiKey.value(),
  });
}

/** Translates failures inside `work` into callable errors. */
async function guarded(uid, what, work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof AppError) throw new HttpsError(error.code, error.message);
    if (error instanceof ValidationError) throw new HttpsError("invalid-argument", error.message);
    if (error instanceof GhostApiError && error.type === "ValidationError") {
      throw new HttpsError("invalid-argument", error.message);
    }
    logger.error(`${what} failed`, { uid, message: error.message });
    throw new HttpsError("unavailable", `Could not ${what} right now.`);
  }
}

/** Runs `work` with the caller's Ghost member. */
function withMember(request, what, work) {
  return guarded(request.auth?.uid, what, async () => {
    const user = verifiedUser(request);
    const ghost = ghostClient();
    const member = await resolveMember(user, { store: firestoreStore(getFirestore()), ghost });
    return work({ user, ghost, member });
  });
}

export const ghostSignInUrl = onCall(options, (request) =>
  withMember(request, "sign you in on the website", async ({ user, ghost, member }) => {
    const redirectTo =
      typeof request.data?.redirectTo === "string" ? request.data.redirectTo : undefined;
    const url = await ghost.signInUrl(member.id, { redirectTo });
    logger.info("ghost sign-in url issued", {
      uid: user.uid,
      created: member.created,
      linked: member.linked,
    });
    return { url, created: member.created };
  }),
);

export const ghostMember = onCall(options, (request) =>
  withMember(request, "load your account", async ({ ghost, member }) => {
    return profile(member, await ghost.listNewsletters());
  }),
);

export const updateGhostMember = onCall(options, (request) =>
  withMember(request, "save your changes", async ({ user, ghost, member }) => {
    const newsletters = await ghost.listNewsletters();
    const allowed = profile(member, newsletters).newsletters;
    const patch = validateUpdate(request.data, allowed);
    const updated = await ghost.updateMember(member.id, patch);
    logger.info("ghost member updated", { uid: user.uid, fields: Object.keys(patch) });
    return profile(updated, newsletters);
  }),
);

// ---- submissions -----------------------------------------------------------

const store = () => firestoreSubmissionStore(getFirestore(), getStorage().bucket());

function reviewUrl() {
  return reviewPageUrl.value().trim() || "https://submissions.pizzapredator.com/";
}

async function notify(submission, user) {
  const to = notifyEmail.value().trim();
  const domain = mailgunDomain.value().trim();
  const apiKey = mailgunApiKey.value();
  if (!to || !isMailConfigured({ apiKey, domain })) {
    logger.warn(
      "submission email skipped: MAILGUN_API_KEY, MAILGUN_DOMAIN or SUBMISSION_NOTIFY_EMAIL not set",
    );
    return false;
  }
  try {
    const mail = notificationEmail({ ...submission, userEmail: user.email, reviewUrl: reviewUrl() });
    await sendMail({
      apiKey,
      domain,
      apiBase: mailgunApiBase.value(),
      from: fromEmail.value().trim() || `postmaster@${domain}`,
      to,
      replyTo: user.email,
      ...mail,
    });
    return true;
  } catch (error) {
    // The submission is stored either way; do not fail it.
    logger.warn("submission email failed", { uid: user.uid, message: error.message });
    return false;
  }
}

/** The submission operations, bound to Firestore, Storage, Ghost and Mailgun. */
const service = {
  create: (data, user) =>
    subs.createSubmission(data, user, { store: store(), processImage, notify, log: logger.info }),
  review: (input, admin) =>
    subs.reviewSubmission(subs.parseReview(input), admin, {
      store: store(),
      ghost: ghostClient(),
      authorEmail: authorEmail.value().trim(),
      warn: (message) => logger.warn(message),
      log: logger.info,
    }),
  list: (query) => subs.listSubmissions(subs.parseListQuery(query), { store: store() }),
  get: (id) => subs.getSubmission(id, { store: store() }),
};

export const submitPost = onCall(
  { region: "us-central1", secrets: [mailgunApiKey], ...heavy },
  (request) =>
    guarded(request.auth?.uid, "send your submission", () =>
      service.create(request.data, verifiedUser(request)),
    ),
);

export const reviewSubmission = onCall({ ...options, ...heavy }, (request) =>
  guarded(request.auth?.uid, "review the submission", () =>
    service.review(request.data, adminUser(request)),
  ),
);

export const api = onRequest(
  { region: "us-central1", secrets: [ghostAdminApiKey, mailgunApiKey], ...heavy },
  createApi({
    verifyToken: (token) => getAuth().verifyIdToken(token),
    service,
    log: (message, data) => logger.error(message, data),
  }),
);
