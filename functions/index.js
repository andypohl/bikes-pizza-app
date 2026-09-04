// Cloud Functions for the PizzaPredator app.
//
// All three callables require a Firebase user with a verified email and work
// on the Ghost member linked to that user. The link is stored in Firestore
// (users/{uid}) so later email changes on either side do not break it; see
// link.js.
//
// ghostSignInUrl:    one-time URL that opens the Ghost site as a signed-in
//                    member, without a magic-link email.
// ghostMember:       the member's profile (name, email, newsletter choices)
//                    for the hosted account page.
// updateGhostMember: changes the member's name and/or newsletters.
// submitPost:        turns a member's bike/pizza submission (photo + text)
//                    into a draft post and emails the author about it.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { ValidationError, profile, validateUpdate } from "./account.js";
import { GhostAdminClient, GhostApiError } from "./ghost.js";
import { firestoreStore, resolveMember } from "./link.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { buildPost, createDraft, notificationEmail, validateSubmission } from "./submission.js";

initializeApp();

// Set with `firebase functions:secrets:set GHOST_ADMIN_API_KEY`.
const ghostAdminApiKey = defineSecret("GHOST_ADMIN_API_KEY");
// Set in functions/.env (see .env.example); not a secret.
const ghostAdminApiUrl = defineString("GHOST_ADMIN_API_URL");

// SMTP URL for the notification email (see mail.js); set with
// `firebase functions:secrets:set SMTP_URL`. Anything that is not an
// smtp:// or smtps:// URL disables the email.
const smtpUrl = defineSecret("SMTP_URL");
// Who to tell about new submissions; set in functions/.env. Empty disables
// the email.
const notifyEmail = defineString("SUBMISSION_NOTIFY_EMAIL", { default: "" });
// Email of the Ghost staff account that submission drafts are attributed
// to; set in functions/.env. Empty leaves Ghost's default author.
const authorEmail = defineString("SUBMISSION_AUTHOR_EMAIL", { default: "" });

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
  return { uid: auth.uid, email, name };
}

/**
 * Runs `work` with the caller's Ghost member, translating failures into
 * callable errors. `what` names the operation for logs and messages.
 */
async function withMember(request, what, work) {
  const user = verifiedUser(request);
  const ghost = new GhostAdminClient({
    url: ghostAdminApiUrl.value(),
    key: ghostAdminApiKey.value(),
  });
  try {
    const member = await resolveMember(user, { store: firestoreStore(getFirestore()), ghost });
    return await work({ user, ghost, member });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ValidationError) throw new HttpsError("invalid-argument", error.message);
    if (error instanceof GhostApiError && error.type === "ValidationError") {
      throw new HttpsError("invalid-argument", error.message);
    }
    logger.error(`${what} failed`, { uid: user.uid, message: error.message });
    throw new HttpsError("unavailable", `Could not ${what} right now.`);
  }
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

export const submitPost = onCall(
  { ...options, secrets: [ghostAdminApiKey, smtpUrl], memory: "512MiB", timeoutSeconds: 120 },
  (request) =>
    withMember(request, "send your submission", async ({ user, ghost }) => {
      const submission = validateSubmission(request.data);
      const imageUrl = await ghost.uploadImage(submission.image);
      const post = await createDraft(
        ghost,
        buildPost({ ...submission, imageUrl, authorEmail: authorEmail.value().trim() }),
        (message) => logger.warn(message),
      );
      logger.info("submission drafted", {
        uid: user.uid,
        feed: submission.feed,
        postId: post.id,
        author: post.primary_author?.email ?? null,
      });

      let notified = false;
      const to = notifyEmail.value().trim();
      if (to && isMailConfigured(smtpUrl.value())) {
        try {
          const mail = notificationEmail({
            ...submission,
            userEmail: user.email,
            post,
            adminUrl: ghostAdminApiUrl.value(),
          });
          await sendMail({ smtpUrl: smtpUrl.value(), to, replyTo: user.email, ...mail });
          notified = true;
        } catch (error) {
          // The draft exists either way; do not fail the submission.
          logger.warn("submission email failed", { uid: user.uid, message: error.message });
        }
      } else {
        logger.warn("submission email skipped: SMTP_URL or SUBMISSION_NOTIFY_EMAIL not set");
      }
      return { postId: post.id, notified };
    }),
);
