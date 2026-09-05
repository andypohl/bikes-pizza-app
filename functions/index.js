// Cloud Functions for the bikes.pizza app.
//
// All entry points require a Firebase user with a verified email. Member
// profiles live in Firestore (members/{uid}; see members.js). Submissions
// are stored for review and, on approval, published to Sanity as posts
// (submissions.js, post.js); they are reachable both as callables and
// through the REST API in api.js.
//
// member:            the member's profile (name, email, newsletter choices)
//                    for the account page and the app.
// updateMember:      changes the member's name and/or newsletters.
// submitPost:        checks a bike/pizza submission's photo with Google
//                    Vision (SafeSearch, and no people or faces), stores it
//                    (photo + text) in Firestore and Storage and emails the
//                    reviewer.
// reviewSubmission:  admin only; queues, drafts (in Sanity) or rejects a
//                    pending submission.
//                    Each run that posts something then asks GitHub to
//                    rebuild the website (rebuild.js).
// api:               HTTPS; the REST API behind /api/ on the submissions
//                    Hosting site (list, fetch, review, create, queues,
//                    site settings such as the website's submit button).
// postBikesQueue,    scheduled; post the oldest queued submission of the
// postPizzaQueue:    feed at its posting times (schedule.js).

import { GoogleAuth } from "google-auth-library";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { ValidationError, profile, validateUpdate } from "./account.js";
import { createApi } from "./api.js";
import { AppError, adminFromClaims, userFromClaims } from "./errors.js";
import { processImage } from "./images.js";
import { NEWSLETTERS, firestoreMemberStore, loadMember, updateMember as applyMemberUpdate } from "./members.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { inspectImage } from "./vision.js";
import { requestRebuild } from "./rebuild.js";
import { TIME_ZONE, cronFor } from "./schedule.js";
import { notificationEmail } from "./submission.js";
import { SanityClient } from "./sanity.js";
import { firestoreSiteSettings, getSettings, updateSettings } from "./site_settings.js";
import { firestoreSubmissionStore } from "./submission_store.js";
import * as subs from "./submissions.js";

initializeApp();

// Approved submissions become posts in Sanity. The token (an Editor token
// for the project) is set with `firebase functions:secrets:set
// SANITY_WRITE_TOKEN`; the identifiers are plain parameters with defaults.
const sanityWriteToken = defineSecret("SANITY_WRITE_TOKEN");
const sanityProjectId = defineString("SANITY_PROJECT_ID", { default: "" });
const sanityDataset = defineString("SANITY_DATASET", { default: "" });
const SANITY_API_VERSION = "2025-02-19";
const SANITY_DEFAULTS = { projectId: "nva9b0ia", dataset: "production" };
// The website that renders the posts; published posts link there.
const siteUrlParam = defineString("SITE_URL", { default: "" });
const siteUrl = () => siteUrlParam.value().trim() || "https://bikes.pizza";

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
// Link put in the notification email; empty means the submissions site.
const reviewPageUrl = defineString("REVIEW_PAGE_URL", { default: "" });

// The website is static: after a post is published, the "Rebuild website"
// workflow has to run. The token is a fine-grained GitHub personal access
// token for the repository with "Contents: read and write", set with
// `firebase functions:secrets:set GITHUB_DISPATCH_TOKEN` (the same token the
// Sanity webhook uses); a placeholder value skips the request.
const githubDispatchToken = defineSecret("GITHUB_DISPATCH_TOKEN");
const githubRepository = defineString("GITHUB_REPOSITORY", { default: "" });
/** Which environment's site to rebuild: production builds from the `production` dataset. */
const siteEnvironment = () => ((sanityDataset.value().trim() || SANITY_DEFAULTS.dataset) === "production" ? "production" : "development");
const rebuildWebsite = (reason) =>
  requestRebuild(
    { repository: githubRepository.value().trim() || undefined, environment: siteEnvironment(), reason },
    { token: githubDispatchToken.value(), log: logger.info },
  );

const heavy = { memory: "512MiB", timeoutSeconds: 120 };

/** The signed-in, verified user behind a callable request, or throws. */
const verifiedUser = (request) => userFromClaims(request.auth && { uid: request.auth.uid, ...request.auth.token });
/** A verified user who also carries the `admin` custom claim. */
const adminUser = (request) => adminFromClaims(request.auth && { uid: request.auth.uid, ...request.auth.token });

function sanityClient() {
  return new SanityClient({
    projectId: sanityProjectId.value().trim() || SANITY_DEFAULTS.projectId,
    dataset: sanityDataset.value().trim() || SANITY_DEFAULTS.dataset,
    apiVersion: SANITY_API_VERSION,
    token: sanityWriteToken.value(),
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
    logger.error(`${what} failed`, { uid, message: error.message });
    throw new HttpsError("unavailable", `Could not ${what} right now.`);
  }
}

/** Runs `work` with the caller's member record. */
function withMember(request, what, work) {
  return guarded(request.auth?.uid, what, async () => {
    const user = verifiedUser(request);
    const store = firestoreMemberStore(getFirestore());
    const member = await loadMember(user, { store });
    return work({ user, store, member });
  });
}

const memberOptions = { region: "us-central1" };

export const member = onCall(memberOptions, (request) =>
  withMember(request, "load your account", async ({ member }) => profile(member, NEWSLETTERS)),
);

export const updateMember = onCall(memberOptions, (request) =>
  withMember(request, "save your changes", async ({ user, store }) => {
    const patch = validateUpdate(request.data, NEWSLETTERS);
    const updated = await applyMemberUpdate(user, patch, { store });
    logger.info("member updated", { uid: user.uid, fields: Object.keys(patch) });
    return profile(updated, NEWSLETTERS);
  }),
);

// ---- submissions -----------------------------------------------------------

const store = () => firestoreSubmissionStore(getFirestore(), getStorage().bucket());

function reviewUrl() {
  return reviewPageUrl.value().trim() || "https://submissions.bikes.pizza/";
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

// Cloud Vision (vision.js) is called with the function's own service account.
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const safeSearch = (bytes) => inspectImage(bytes, { getToken: () => googleAuth.getAccessToken() });

/** The submission operations, bound to Firestore, Storage, Vision, Sanity and Mailgun. */
const service = {
  create: (data, user) =>
    subs.createSubmission(data, user, { store: store(), processImage, safeSearch, notify, log: logger.info }),
  review: (input, admin) =>
    subs.reviewSubmission(subs.parseReview(input), admin, {
      store: store(),
      sanity: sanityClient(),
      siteUrl: siteUrl(),
      log: logger.info,
    }),
  list: (query) => subs.listSubmissions(subs.parseListQuery(query), { store: store() }),
  get: (id) => subs.getSubmission(id, { store: store() }),
  site: {
    settings: () => getSettings({ store: firestoreSiteSettings(getFirestore()) }),
    updateSettings: (data, admin) =>
      updateSettings(data, admin, { store: firestoreSiteSettings(getFirestore()), log: logger.info }),
  },
  queue: {
    info: (feed) => subs.queueInfo(feed, { store: store() }),
    items: (feed) => subs.queueItems(feed, { store: store() }),
    add: (input, admin) => subs.enqueue(input, admin, { store: store(), log: logger.info }),
    remove: (input, admin) => subs.dequeue(input, admin, { store: store(), log: logger.info }),
    submitNext: (feed) =>
      subs.submitNext(feed, {
        store: store(),
        sanity: sanityClient(),
        siteUrl: siteUrl(),
        log: logger.info,
      }),
  },
};

export const submitPost = onCall(
  { region: "us-central1", secrets: [mailgunApiKey], ...heavy },
  (request) =>
    guarded(request.auth?.uid, "send your submission", () =>
      service.create(request.data, verifiedUser(request)),
    ),
);

export const reviewSubmission = onCall({ region: "us-central1", secrets: [sanityWriteToken], ...heavy }, (request) =>
  guarded(request.auth?.uid, "review the submission", () =>
    service.review(request.data, adminUser(request)),
  ),
);

/**
 * Posts a feed's oldest queued submission at each of its scheduled times,
 * then asks GitHub to rebuild the website so the post appears.
 */
const queueRunner = (feed) =>
  onSchedule(
    {
      schedule: cronFor(feed),
      timeZone: TIME_ZONE,
      region: "us-central1",
      secrets: [sanityWriteToken, githubDispatchToken],
      retryCount: 2,
      ...heavy,
    },
    async () => {
      const result = await service.queue.submitNext(feed);
      logger.info("queue run", { feed, posted: result.posted?.id ?? null, remaining: result.length });
      if (result.posted) await rebuildWebsite(`${feed} queue posted ${result.posted.id}`);
    },
  );

export const postBikesQueue = queueRunner("bikes");
export const postPizzaQueue = queueRunner("pizza");

export const api = onRequest(
  { region: "us-central1", secrets: [sanityWriteToken, mailgunApiKey], ...heavy },
  createApi({
    verifyToken: (token) => getAuth().verifyIdToken(token),
    service,
    log: (message, data) => logger.error(message, data),
  }),
);
