// Cloud Functions for the bikes.pizza app.
//
// All entry points but deleteAccount require a Firebase user with a verified
// email. Member profiles live in Firestore (members/{uid}; see members.js).
// Submissions are stored for review and, on approval, published as posts
// in Firestore with their photo renditions in Storage (submissions.js,
// post.js, post_store.js); they are reachable both as callables and
// through the REST API in api.js.
//
// member:            the member's profile (email, username, newsletters)
//                    for the account page and the app.
// updateMember:      changes the member's username and/or newsletters.
// deleteAccount:     deletes the caller's Firebase user, member record and
//                    passkeys.
// passkeyRegisterOptions, passkeyRegister, passkeys, passkeyRemove:
//                    a member's passkeys (passkeys.js).
// passkeySignInOptions, passkeySignIn:
//                    signing in with a passkey; no user yet. The result is
//                    a custom token with `passkey: true`. Given an email,
//                    the ceremony is scoped to that account, which is how a
//                    passkey stands in for the authenticator code.
// submitPost:        checks a bike/pizza submission's photo with Google
//                    Vision (SafeSearch, and no people or faces), stores it
//                    (photo + text) in Firestore and Storage and emails the
//                    reviewer.
// postBikesQueue,    scheduled; post the oldest queued submission of the
// postPizzaQueue:    feed at its posting times (schedule.js); each run that
//                    posts something then asks GitHub to rebuild the
//                    website (rebuild.js).
// purgeNotices:      scheduled nightly; drops mention notices older than
//                    sixty days (comments.js).
// api:               HTTPS; the REST API behind /api/ on the submissions
//                    Hosting site (list, fetch, review, create, queues,
//                    site settings such as the website's submit button,
//                    user administration, editing published posts
//                    (posts.js), members' reactions to them
//                    (reactions.js) and comments on them (comments.js,
//                    screened with the Natural Language API, moderate.js)).

import { GoogleAuth } from "google-auth-library";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { profile, validateUpdate } from "./account.js";
import * as adminUsers from "./admin_users.js";
import * as webauthn from "@simplewebauthn/server";
import { createApi } from "./api.js";
import { firestoreCommentStore } from "./comment_store.js";
import * as commenting from "./comments.js";
import { AppError, ValidationError, userFromClaims } from "./errors.js";
import { processImage } from "./images.js";
import { NEWSLETTERS, firestoreMemberStore, loadMember, updateMember as applyMemberUpdate } from "./members.js";
import { firestorePostStore } from "./post_store.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { moderateText } from "./moderate.js";
import * as passkeys from "./passkeys.js";
import * as postEditing from "./posts.js";
import * as reactions from "./reactions.js";
import { inspectImage } from "./vision.js";
import { requestRebuild } from "./rebuild.js";
import { TIME_ZONE, cronFor } from "./schedule.js";
import { notificationEmail } from "./submission.js";
import { accountDeletedEmail } from "./account.js";
import { firestoreSiteSettings, getSettings, updateSettings } from "./site_settings.js";
import { firestoreSubmissionStore } from "./submission_store.js";
import * as subs from "./submissions.js";

initializeApp();

// Which environment this deployment is (the workflow writes it): the
// website of the same environment is rebuilt after a post changes.
const siteEnvironmentParam = defineString("SITE_ENVIRONMENT", { default: "development" });
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
// website rebuild workflow accepts); a placeholder value skips the request.
const githubDispatchToken = defineSecret("GITHUB_DISPATCH_TOKEN");
const githubRepository = defineString("GITHUB_REPOSITORY", { default: "" });
const siteEnvironment = () => (siteEnvironmentParam.value().trim() === "production" ? "production" : "development");
const rebuildWebsite = (reason) =>
  requestRebuild(
    { repository: githubRepository.value().trim() || undefined, environment: siteEnvironment(), reason },
    { token: githubDispatchToken.value(), log: logger.info },
  );

const heavy = { memory: "512MiB", timeoutSeconds: 120 };

// Passkeys are bound to the website's domain (the relying party ID), so
// one made on bikes.pizza also works at account.bikes.pizza and in the
// apps. The native apps present their own origins (Android: the signing
// key's hash); list them here, comma-separated, or they are refused.
const passkeyOrigins = defineString("PASSKEY_ORIGINS", { default: "" });

/** The signed-in, verified user behind a callable request, or throws. */
const verifiedUser = (request) => userFromClaims(request.auth && { uid: request.auth.uid, ...request.auth.token });

/** Published posts and their photo renditions (post_store.js). */
const posts = () => firestorePostStore(getFirestore(), getStorage().bucket());
/** The comments under them, the mention notices and the word lists (comment_store.js). */
const comments = () => firestoreCommentStore(getFirestore());

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

// updateMember also renames the member on their posts (and rebuilds the site).
const memberOptions = { region: "us-central1", secrets: [githubDispatchToken] };

export const member = onCall(memberOptions, (request) =>
  withMember(request, "load your account", async ({ member }) => profile(member, NEWSLETTERS)),
);

export const updateMember = onCall(memberOptions, (request) =>
  withMember(request, "save your changes", async ({ user, store }) => {
    const patch = validateUpdate(request.data, NEWSLETTERS);
    const updated = await applyMemberUpdate(user, patch, { store });
    logger.info("member updated", { uid: user.uid, fields: Object.keys(patch) });
    if ("username" in patch) {
      // Best effort: the posts and reactions carry the username; if this
      // fails the admin page can rename again.
      try {
        const changed = await posts().setUsername(user.uid, patch.username);
        if (changed) await rebuildWebsite(`member ${user.uid} renamed`);
      } catch (error) {
        logger.warn("member username not written to their posts", { uid: user.uid, message: error.message });
      }
    }
    return profile(updated, NEWSLETTERS);
  }),
);

/**
 * Deletes the caller's own account: the Firebase user and the member record
 * (which frees the username), the same as an admin deleting them, plus
 * their passkeys. Posts they published stay, credited as they were. Unlike
 * the other callables this does not insist on a verified email: an account
 * that never verified must still be able to remove itself.
 */
export const deleteAccount = onCall({ region: "us-central1", secrets: [mailgunApiKey] }, (request) =>
  guarded(request.auth?.uid, "delete your account", async () => {
    const uid = request.auth?.uid;
    if (!uid) throw new AppError("unauthenticated", "Sign in first.");
    const result = await adminUsers.deleteUser(uid, {
      auth: getAuth(),
      members: firestoreMemberStore(getFirestore()),
      cleanup: removeMemberData,
      notify: notifyDeleted(true),
      log: logger.warn,
    });
    const removed = await passkeys.removeAllPasskeys(uid, passkeyDeps());
    logger.info("account deleted by member", { uid, passkeys: removed });
    return result;
  }),
);

// ---- passkeys ---------------------------------------------------------------

/** What passkeys.js needs: the store, the relying party, the library, token minting. */
const passkeyDeps = () => ({
  store: passkeys.firestorePasskeyStore(getFirestore()),
  rp: passkeys.rpFromSiteUrl(siteUrl()),
  webauthn,
  extraOrigins: passkeyOrigins
    .value()
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  createToken: (uid, claims) => getAuth().createCustomToken(uid, claims),
  // Scopes a sign-in to one account (see passkeys.js); an address with no
  // account looks the same as an account with no passkeys.
  lookupUidByEmail: async (email) => {
    try {
      return (await getAuth().getUserByEmail(email)).uid;
    } catch {
      return null;
    }
  },
  log: logger.info,
});

const passkeyOptions = { region: "us-central1" };

export const passkeyRegisterOptions = onCall(passkeyOptions, (request) =>
  withMember(request, "start adding a passkey", ({ user, member }) =>
    passkeys.registrationOptions(user, member, passkeyDeps()),
  ),
);

export const passkeyRegister = onCall(passkeyOptions, (request) =>
  guarded(request.auth?.uid, "add the passkey", async () => {
    const user = verifiedUser(request);
    const list = await passkeys.register(user, request.data, passkeyDeps());
    logger.info("passkey added", { uid: user.uid, count: list.length });
    return list;
  }),
);

export const passkeyList = onCall(passkeyOptions, (request) =>
  guarded(request.auth?.uid, "load your passkeys", () => passkeys.listPasskeys(verifiedUser(request).uid, passkeyDeps())),
);

export const passkeyRemove = onCall(passkeyOptions, (request) =>
  guarded(request.auth?.uid, "remove the passkey", async () => {
    const user = verifiedUser(request);
    const list = await passkeys.removePasskey(user.uid, request.data, passkeyDeps());
    logger.info("passkey removed", { uid: user.uid, count: list.length });
    return list;
  }),
);

// Signing in: nobody is signed in yet, so these take no user.
export const passkeySignInOptions = onCall(passkeyOptions, (request) =>
  guarded(null, "start the passkey sign-in", () => passkeys.signInOptions(request.data, passkeyDeps())),
);

export const passkeySignIn = onCall(passkeyOptions, (request) =>
  guarded(null, "sign in with the passkey", () => passkeys.signIn(request.data, passkeyDeps())),
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

// Tells an account's owner that the account is gone. Nothing to do when mail
// is not configured; deleteUser treats a failure here as a warning.
function notifyDeleted(requested) {
  return async ({ uid, email }) => {
    const domain = mailgunDomain.value().trim();
    const apiKey = mailgunApiKey.value();
    if (!isMailConfigured({ apiKey, domain })) {
      logger.warn("account deletion email skipped: MAILGUN_API_KEY or MAILGUN_DOMAIN not set", { uid });
      return;
    }
    await sendMail({
      apiKey,
      domain,
      apiBase: mailgunApiBase.value(),
      from: fromEmail.value().trim() || `postmaster@${domain}`,
      to: email,
      ...accountDeletedEmail({ email, siteUrl: siteUrl(), requested }),
    });
    logger.info("account deletion email sent", { uid });
  };
}

// Cloud Vision (vision.js) and the Natural Language API (moderate.js) are
// called with the function's own service account.
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const safeSearch = (bytes) => inspectImage(bytes, { getToken: () => googleAuth.getAccessToken() });
const moderate = (text) => moderateText(text, { getToken: () => googleAuth.getAccessToken() });

/** What comments.js needs: the stores, the screening call, ids and the log. */
const commentDeps = () => ({
  posts: posts(),
  comments: comments(),
  members: firestoreMemberStore(getFirestore()),
  settings: () => getSettings({ store: firestoreSiteSettings(getFirestore()) }),
  moderate,
  newId: () => getFirestore().collection("posts").doc().id,
  siteUrl: siteUrl(),
  log: logger.info,
});

/** What a deleted member left on other people's posts goes with them. */
const removeMemberData = (uid) => commenting.deleteMemberData(uid, commentDeps());

/** What the user-administration endpoints need: Auth admin, members, posts. */
const userAdminDeps = () => ({
  auth: getAuth(),
  members: firestoreMemberStore(getFirestore()),
  posts: posts(),
  newsletters: NEWSLETTERS,
  siteUrl: siteUrl(),
  log: logger.warn,
});

/** The submission operations, bound to Firestore, Storage, Vision and Mailgun. */
const service = {
  create: (data, user) =>
    subs.createSubmission(data, user, { store: store(), processImage, safeSearch, notify, log: logger.info }),
  review: async (input, admin) => {
    const result = await subs.reviewSubmission(subs.parseReview(input), admin, {
      store: store(),
      posts: posts(),
      members: firestoreMemberStore(getFirestore()),
      siteUrl: siteUrl(),
      log: logger.info,
    });
    // An approved edit changes a post at once; a queued post waits for its slot.
    if (result.postStatus === "published") await rebuildWebsite(`edit ${input?.id} applied`);
    return result;
  },
  list: (query) => subs.listSubmissions(subs.parseListQuery(query), { store: store() }),
  get: (id) => subs.getSubmission(id, { store: store() }),
  site: {
    settings: () => getSettings({ store: firestoreSiteSettings(getFirestore()) }),
    updateSettings: (data, admin) =>
      updateSettings(data, admin, { store: firestoreSiteSettings(getFirestore()), log: logger.info }),
  },
  users: {
    list: (query) => adminUsers.listUsers(query, userAdminDeps()),
    get: (uid) => adminUsers.getUser(uid, userAdminDeps()),
    update: async (uid, data, admin) => {
      const result = await adminUsers.updateUser(uid, data, userAdminDeps());
      logger.info("user updated by admin", { uid, by: admin.uid, fields: Object.keys(data ?? {}) });
      if (result.renamed) await rebuildWebsite(`member ${uid} renamed by admin`);
      return result;
    },
    remove: async (uid, admin) => {
      const result = await adminUsers.deleteUser(uid, { ...userAdminDeps(), cleanup: removeMemberData, notify: notifyDeleted(false) });
      logger.info("user deleted by admin", { uid, by: admin.uid });
      return result;
    },
  },
  posts: {
    mine: (user) => postEditing.listMyPosts(user, { posts: posts(), siteUrl: siteUrl() }),
    get: (id, actor) => postEditing.getPost(id, actor, { posts: posts(), siteUrl: siteUrl(), store: store() }),
    // Members' edits become pending submissions (reviewed like new posts);
    // admins' apply at once, and the website is rebuilt.
    update: async (id, data, actor) => {
      const result = await postEditing.updatePost(id, data, actor, {
        posts: posts(),
        store: store(),
        members: firestoreMemberStore(getFirestore()),
        processImage,
        safeSearch,
        notify,
        siteUrl: siteUrl(),
        log: logger.info,
      });
      if (result.status === "applied") await rebuildWebsite(`post ${id} edited by admin`);
      return result;
    },
    // The admin page's news editor: write, list and take down posts.
    list: (query, admin) => postEditing.listPosts(query, admin, { posts: posts(), siteUrl: siteUrl() }),
    create: async (data, admin) => {
      const result = await postEditing.createPost(data, admin, { posts: posts(), processImage, siteUrl: siteUrl(), log: logger.info });
      await rebuildWebsite(`post ${result.post.id} written by admin`);
      return result;
    },
    upload: (data, admin) => postEditing.uploadImage(data, admin, { posts: posts(), processImage, log: logger.info }),
    // Reactions change only tallies on the post, which the app reads live,
    // so the website is not rebuilt for them.
    reactions: (id, user) => reactions.getReactions(id, user, { posts: posts() }),
    react: (id, data, user) =>
      reactions.setReactions(id, data, user, { posts: posts(), members: firestoreMemberStore(getFirestore()), log: logger.info }),
    remove: async (id, admin) => {
      const result = await postEditing.removePost(id, admin, { posts: posts(), log: logger.info });
      await rebuildWebsite(`post ${id} removed by admin`);
      return result;
    },
  },
  // Comments change only the post's counts, which the app reads live and
  // the website picks up at its next rebuild, so nothing is rebuilt here.
  comments: {
    list: (id, query, user) => commenting.listComments(id, query, user, commentDeps()),
    create: (id, data, user) => commenting.createComment(id, data, user, commentDeps()),
    edit: (id, cid, data, user) => commenting.editComment(id, cid, data, user, commentDeps()),
    remove: (id, cid, actor) => commenting.deleteComment(id, cid, actor, commentDeps()),
    replies: (id, cid, user) => commenting.listReplies(id, cid, user, commentDeps()),
    like: (id, cid, user) => commenting.toggleLike(id, cid, user, commentDeps()),
    likes: (id, cid, user) => commenting.listLikes(id, cid, user, commentDeps()),
    report: (id, cid, data, user) => commenting.reportComment(id, cid, data, user, commentDeps()),
    notices: (user, query) => commenting.listNotices(user, query, commentDeps()),
    exportData: (user) => commenting.exportMember(user, commentDeps()),
    queue: (query, admin) => commenting.adminQueue(query, admin, commentDeps()),
    act: (id, cid, action, admin) => commenting.adminAct(id, cid, action, admin, commentDeps()),
    moderation: () => commenting.getModeration(commentDeps()),
    setModeration: (data, admin) => commenting.setModeration(data, admin, commentDeps()),
  },
  queue: {
    info: (feed) => subs.queueInfo(feed, { store: store() }),
    remove: (input, admin) => subs.dequeue(input, admin, { store: store(), log: logger.info }),
    submitNext: (feed) =>
      subs.submitNext(feed, {
        store: store(),
        posts: posts(),
        members: firestoreMemberStore(getFirestore()),
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
      secrets: [githubDispatchToken],
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

/** Drops mention notices older than sixty days, every night. */
export const purgeNotices = onSchedule({ schedule: "every day 04:30", timeZone: TIME_ZONE, region: "us-central1" }, async () => {
  const purged = await commenting.purgeNotices({ comments: comments() });
  logger.info("notices purged", { purged });
});

export const api = onRequest(
  { region: "us-central1", secrets: [mailgunApiKey, githubDispatchToken], ...heavy },
  createApi({
    verifyToken: (token) => getAuth().verifyIdToken(token),
    service,
    log: (message, data) => logger.error(message, data),
  }),
);
