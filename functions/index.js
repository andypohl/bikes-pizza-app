// Cloud Functions for the PizzaPredator app.
//
// All callables require a Firebase user with a verified email. The member
// ones work on the Ghost member linked to that user (users/{uid} in
// Firestore; see link.js). The submission ones store member submissions
// for review and, on approval, post them to Ghost.
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

import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { ValidationError, profile, validateUpdate } from "./account.js";
import { GhostAdminClient, GhostApiError } from "./ghost.js";
import { processImage } from "./images.js";
import { firestoreStore, resolveMember } from "./link.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { createPost, loadTemplate, renderPost, templateView } from "./post.js";
import { notificationEmail, submissionRecord, validateSubmission } from "./submission.js";

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
// Link put in the notification email; empty derives it from the project's
// default Hosting site.
const reviewPageUrl = defineString("REVIEW_PAGE_URL", { default: "" });

const options = { region: "us-central1", secrets: [ghostAdminApiKey] };

/** The signed-in, verified user behind a callable request, or throws. */
function verifiedUser(request) {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

  const { email, email_verified: emailVerified, name } = auth.token;
  if (!email) {
    throw new HttpsError("failed-precondition", "Your account has no email address.");
  }
  // Without this check anyone could claim an existing member's email with a
  // password account and act as them.
  if (!emailVerified) {
    throw new HttpsError("failed-precondition", "Verify your email address first.");
  }
  return { uid: auth.uid, email, name, admin: auth.token.admin === true };
}

/** A verified user who also carries the `admin` custom claim. */
function adminUser(request) {
  const user = verifiedUser(request);
  if (!user.admin) throw new HttpsError("permission-denied", "Admins only.");
  return user;
}

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
  const user = verifiedUser(request);
  return guarded(user.uid, what, async () => {
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

const submissions = () => getFirestore().collection("submissions");

function reviewUrl() {
  const configured = reviewPageUrl.value().trim();
  if (configured) return configured;
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  return project ? `https://${project}.web.app/review/` : "";
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

export const submitPost = onCall(
  { region: "us-central1", secrets: [mailgunApiKey], memory: "512MiB", timeoutSeconds: 120 },
  (request) => {
    const user = verifiedUser(request);
    return guarded(user.uid, "send your submission", async () => {
      const submission = validateSubmission(request.data);
      const { full, thumb } = await processImage(submission.image.bytes);

      const doc = submissions().doc();
      const bucket = getStorage().bucket();
      const image = {
        path: `submissions/${doc.id}/photo.jpg`,
        thumbPath: `submissions/${doc.id}/thumb.jpg`,
        contentType: "image/jpeg",
        width: full.width,
        height: full.height,
      };
      const save = (path, bytes) =>
        bucket.file(path).save(bytes, {
          contentType: "image/jpeg",
          resumable: false,
          metadata: { metadata: { submissionId: doc.id, uid: user.uid } },
        });
      await Promise.all([save(image.path, full.bytes), save(image.thumbPath, thumb.bytes)]);

      await doc.set({
        ...submissionRecord(submission, { uid: user.uid, email: user.email, image }),
        createdAt: FieldValue.serverTimestamp(),
      });
      logger.info("submission stored", { uid: user.uid, feed: submission.feed, id: doc.id });

      const notified = await notify(submission, user);
      return { submissionId: doc.id, notified };
    });
  },
);

const REVIEW_ACTIONS = new Set(["publish", "draft", "reject"]);

export const reviewSubmission = onCall(
  { ...options, memory: "512MiB", timeoutSeconds: 120 },
  (request) => {
    const admin = adminUser(request);
    return guarded(admin.uid, "review the submission", async () => {
      const { id, action } = request.data ?? {};
      const note = typeof request.data?.note === "string" ? request.data.note.trim().slice(0, 1000) : "";
      if (typeof id !== "string" || !id) throw new ValidationError("Submission id is required.");
      if (!REVIEW_ACTIONS.has(action)) throw new ValidationError("Unknown review action.");

      const ref = submissions().doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "That submission no longer exists.");
      const data = snap.data();
      if (data.status === "approved") {
        throw new HttpsError("failed-precondition", "That submission was already posted.");
      }

      const reviewedBy = { by: admin.uid, byEmail: admin.email, note };
      if (action === "reject") {
        await ref.update({
          status: "rejected",
          review: { ...reviewedBy, action, at: FieldValue.serverTimestamp() },
        });
        logger.info("submission rejected", { id, by: admin.uid });
        return { status: "rejected" };
      }

      const ghost = ghostClient();
      const [bytes] = await getStorage().bucket().file(data.image.path).download();
      const imageUrl = await ghost.uploadImage({
        bytes,
        contentType: data.image.contentType ?? "image/jpeg",
        filename: `${data.feed}-submission.jpg`,
      });
      const view = templateView({ ...data, createdAt: data.createdAt?.toDate?.() }, { imageUrl });
      const rendered = renderPost(loadTemplate(), view);
      const status = action === "publish" ? "published" : "draft";
      const post = await createPost(
        ghost,
        rendered,
        { status, authorEmail: authorEmail.value().trim() },
        (message) => logger.warn(message),
      );
      await ref.update({
        status: "approved",
        review: {
          ...reviewedBy,
          action,
          at: FieldValue.serverTimestamp(),
          postId: post.id,
          postUrl: post.url ?? null,
          postStatus: post.status ?? status,
        },
      });
      logger.info("submission posted", { id, by: admin.uid, postId: post.id, status: post.status });
      return { status: "approved", postId: post.id, postUrl: post.url ?? null, postStatus: post.status };
    });
  },
);
