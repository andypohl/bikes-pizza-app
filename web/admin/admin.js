// The admin page (admins only). Users: who has signed up, what they have
// posted, their newsletter choice; edits, password resets and deletion.
// News: the news posts on the site, writing a new one (title, publish
// date, photo, story in Markdown), editing and removing. Comments: the
// review queues (held by screening, reported, recent) with Approve and
// Remove, and the banned and suspicious word lists.
//
// Talks to the REST API at /api/admin/users, /api/admin/posts,
// /api/admin/comments, /api/admin/moderation and /api/posts (see
// functions/api.js, functions/admin_users.js, functions/posts.js and
// functions/comments.js) with the signed-in admin's Firebase ID token.
// Password resets go through Firebase Auth directly, which emails the
// member its usual reset link.
//
// Administrators must use a second factor (an authenticator app, TOTP).
// An admin without one is walked through enrolling before the user list
// appears; from then on every sign-in asks for the code, and the API only
// accepts tokens minted after that second step.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  OAuthProvider,
  TotpMultiFactorGenerator,
  getAuth,
  getMultiFactorResolver,
  multiFactor,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const PAGE_SIZE = 25;
const $ = (sel) => document.querySelector(sel);

const config = await fetch("/__/firebase/init.json").then((r) => r.json());
const app = initializeApp(config);
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
const passkeySignInOptions = httpsCallable(functions, "passkeySignInOptions");
const passkeySignIn = httpsCallable(functions, "passkeySignIn");

// Usernames: kept in step with `USERNAME_PATTERN` in functions/account.js.
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

let page = 1;
let pages = 1;
let current = null; // the user open in the dialog, as the API returned it

/** Calls the REST API as the signed-in admin; throws {code, message} on failure. */
async function api(path, { method = "GET", body } = {}) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = json.error ?? {};
    throw { code: `api/${error.code ?? "unavailable"}`, message: error.message ?? "Something went wrong." };
  }
  return json;
}

// ---- helpers --------------------------------------------------------------

function show(view) {
  $("#app").dataset.state = view;
  for (const s of document.querySelectorAll("[data-view]")) s.hidden = s.dataset.view !== view;
  // The section tabs belong to the signed-in views only.
  if (view !== "list" && view !== "news" && view !== "comments") $("#sections").hidden = true;
}

function say(text, ok = false) {
  const m = $("#message");
  m.textContent = text;
  m.classList.toggle("ok", ok);
  m.hidden = false;
  // The dialog is modal, so it repeats the message where it can be seen.
  const line = $("#d-status");
  line.textContent = text;
  line.classList.toggle("ok", ok);
  line.classList.toggle("bad", !ok);
}

function clearStatus() {
  $("#d-status").textContent = "";
  $("#d-status").className = "status-line";
}

function busy(on) {
  for (const b of document.querySelectorAll("section button, .pager button")) b.disabled = on;
}

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function day(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function describe(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Email or password is incorrect.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null;
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/invalid-verification-code":
    case "auth/totp-challenge-timeout":
      return "That code isn't right, or it expired. Try the current one.";
    case "auth/requires-recent-login":
      return "Please sign out and back in, then try again.";
    case "auth/unverified-email":
      return "Verify the account's email address before turning on two-factor authentication.";
    case "auth/multi-factor-auth-required":
      return null; // handled by the code prompt
    case "auth/operation-not-allowed":
      return "Two-factor authentication is not enabled on this project.";
    case "api/permission-denied":
    case "api/failed-precondition":
    case "api/invalid-argument":
    case "api/not-found":
    case "api/unauthenticated":
    case "api/already-exists":
      return error.message;
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- list -----------------------------------------------------------------

async function load() {
  busy(true);
  try {
    const data = await api(`/api/admin/users?page=${page}&pageSize=${PAGE_SIZE}`);
    pages = data.pages;
    page = data.page;
    render(data);
  } catch (error) {
    say(describe(error) ?? "Could not load users.");
  } finally {
    busy(false);
  }
}

function render(data) {
  const body = $("#rows");
  body.replaceChildren();
  for (const user of data.users) {
    const tr = document.createElement("tr");
    tr.className = "row";

    const name = document.createElement("td");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link inline user";
    open.textContent = user.username || user.email || user.uid;
    if (!user.username) open.title = "No username chosen yet";
    open.addEventListener("click", () => openDetail(user.uid));
    name.append(open);
    if (user.admin) {
      const tag = document.createElement("span");
      tag.className = "yes";
      tag.textContent = " admin";
      name.append(tag);
    }

    const news = document.createElement("td");
    news.innerHTML = user.subscribed ? '<span class="yes">Subscribed</span>' : '<span class="no">No</span>';

    const count = document.createElement("td");
    count.className = "num";
    count.textContent = String(user.postCount);

    const latest = document.createElement("td");
    latest.className = "post";
    if (user.latestPost) {
      const a = document.createElement("a");
      a.href = user.latestPost.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = user.latestPost.title;
      latest.append(a, ` · ${day(user.latestPost.publishedAt)}`);
    } else {
      latest.innerHTML = '<span class="no">—</span>';
    }

    tr.append(name, news, count, latest);
    body.append(tr);
  }
  $("#empty").hidden = data.users.length > 0;
  $("#summary").textContent = `${data.total} user${data.total === 1 ? "" : "s"}, most recent post first.`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= pages;
  $("#page-label").textContent = data.total ? `Page ${page} of ${pages}` : "";
}

// ---- detail dialog --------------------------------------------------------

const form = $("#detail-form");
const dialog = $("#detail");

/** The values the form holds now, in the shape the API takes. */
function formValues() {
  return {
    username: form.username.value.trim(),
    email: form.email.value.trim(),
    admin: form.admin.checked,
    newsletters: [...form.querySelectorAll("input[name=newsletter]:checked")].map((i) => i.value),
  };
}

/** What differs from the loaded user; empty when nothing changed. */
function changes() {
  if (!current) return {};
  const now = formValues();
  const out = {};
  if (now.username !== current.username) out.username = now.username;
  if (now.email !== current.email) out.email = now.email;
  if (now.admin !== Boolean(current.admin)) out.admin = now.admin;
  const before = current.newsletters.filter((n) => n.subscribed).map((n) => n.id).sort().join(",");
  if (now.newsletters.slice().sort().join(",") !== before) out.newsletters = now.newsletters;
  return out;
}

function refreshDirty() {
  $("#d-save").disabled = Object.keys(changes()).length === 0;
}

function fill(user) {
  current = user;
  $("#d-title").textContent = user.username || user.email;
  $("#d-meta").textContent = `${user.postCount} post${user.postCount === 1 ? "" : "s"} · uid ${user.uid}`;
  form.username.value = user.username;
  form.email.value = user.email;
  $("#d-providers").textContent = user.providers.length ? user.providers.join(" and ") : "unknown";
  $("#d-verified").textContent = user.emailVerified ? "Yes" : "No";
  $("#d-joined").textContent = when(user.createdAt) || "unknown";
  $("#d-last").textContent = when(user.lastSignInAt) || "never";
  // Nobody may take away their own admin access, so the switch is read-only
  // on the signed-in admin's own account.
  const self = user.uid === auth.currentUser?.uid;
  form.admin.checked = Boolean(user.admin);
  form.admin.disabled = self;
  $("#d-admin-label").title = self ? "You can't change your own admin access." : "";

  const box = $("#d-newsletters");
  box.replaceChildren();
  for (const n of user.newsletters) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "newsletter";
    input.value = n.id;
    input.checked = n.subscribed;
    const text = document.createElement("span");
    text.textContent = n.name;
    label.append(input, text);
    box.append(label);
  }

  $("#d-posts-head").textContent = user.posts.length ? "Posts, newest first:" : "No posts yet.";
  const list = $("#d-posts");
  list.replaceChildren();
  for (const p of user.posts) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = p.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = p.title;
    li.append(a, ` · ${day(p.publishedAt)}`);
    list.append(li);
  }

  // Only password accounts have a password to reset.
  $("#d-reset").hidden = !user.providers.includes("Email");
  refreshDirty();
}

async function openDetail(uid) {
  busy(true);
  try {
    fill(await api(`/api/admin/users/${encodeURIComponent(uid)}`));
    $("#message").hidden = true;
    clearStatus();
    dialog.showModal();
  } catch (error) {
    say(describe(error) ?? "Could not load that user.");
  } finally {
    busy(false);
  }
}

form.addEventListener("input", refreshDirty);
form.addEventListener("change", refreshDirty);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const patch = changes();
  if (!Object.keys(patch).length) return;
  if ("username" in patch && !USERNAME_PATTERN.test(patch.username)) {
    say("Username must be 3 to 24 letters, digits or underscores.");
    return;
  }
  $("#d-save").disabled = true;
  try {
    const updated = await api(`/api/admin/users/${encodeURIComponent(current.uid)}`, { method: "PATCH", body: patch });
    fill(updated);
    say("Saved.", true);
    await load();
  } catch (error) {
    say(describe(error) ?? "Could not save the changes.");
    refreshDirty();
  }
});

// Closing never asks about unsaved changes: the next open reloads the user.
$("#d-close").addEventListener("click", () => dialog.close());

$("#d-reset").addEventListener("click", async () => {
  if (!current) return;
  const email = current.email;
  $("#d-reset").disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    say(`Password reset email sent to ${email}.`, true);
  } catch (error) {
    say(describe(error) ?? "Could not send the reset email.");
  } finally {
    $("#d-reset").disabled = false;
  }
});

// ---- delete, behind a Yes/No confirmation ---------------------------------

const confirmDialog = $("#confirm");

function confirmDelete(user) {
  $("#confirm-text").textContent =
    `Delete ${user.username || user.email}? Their account and profile go; their posts stay as they are.`;
  return confirmYesNo();
}

/** Shows the Yes/No dialog with the text already set; resolves to the answer. */
function confirmYesNo() {
  return new Promise((resolve) => {
    const done = (answer) => {
      $("#confirm-yes").removeEventListener("click", yes);
      $("#confirm-no").removeEventListener("click", no);
      confirmDialog.removeEventListener("close", closed);
      if (confirmDialog.open) confirmDialog.close();
      resolve(answer);
    };
    const yes = () => done(true);
    const no = () => done(false);
    const closed = () => done(false);
    $("#confirm-yes").addEventListener("click", yes);
    $("#confirm-no").addEventListener("click", no);
    confirmDialog.addEventListener("close", closed);
    confirmDialog.showModal();
  });
}

$("#d-delete").addEventListener("click", async () => {
  if (!current) return;
  const user = current;
  if (!(await confirmDelete(user))) return;
  $("#d-delete").disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(user.uid)}`, { method: "DELETE" });
    dialog.close();
    say(`Deleted ${user.username || user.email}.`, true);
    await load();
  } catch (error) {
    say(describe(error) ?? "Could not delete that user.");
  } finally {
    $("#d-delete").disabled = false;
  }
});

// ---- news -----------------------------------------------------------------

const MAX_EDGE = 2048; // photos are scaled down before upload, as the website's form does

let section = "users";
let newsPosts = [];
let editing = null; // the post open in the news dialog, or null for a new one
let newsPhoto = null; // {data, contentType} chosen for the dialog, or null
let storyEditor = null; // the Toast UI editor, made on the first open
const newsForm = $("#news-form");
const newsDialog = $("#news-dialog");

/**
 * The story editor: WYSIWYG over Markdown, with only the tools the site
 * renders (functions/markdown.js sanitises the rest away). Pictures
 * dropped or pasted in go through the upload endpoint and come back as
 * public URLs. Without the library (a copy of Toast UI Editor 3.2.2 in
 * vendor/), the plain textarea stands in.
 */
function ensureStoryEditor() {
  if (storyEditor || !window.toastui?.Editor) {
    newsForm.story.hidden = Boolean(storyEditor);
    return storyEditor;
  }
  storyEditor = new window.toastui.Editor({
    el: $("#n-editor"),
    height: "420px",
    initialEditType: "wysiwyg",
    previewStyle: "tab",
    usageStatistics: false,
    toolbarItems: [["heading", "bold", "italic"], ["hr", "quote"], ["ul", "ol"], ["link", "image"], ["code", "codeblock"]],
    hooks: {
      addImageBlobHook: async (blob, callback) => {
        try {
          const image = await encodePhoto(blob);
          const { url } = await api("/api/admin/uploads", { method: "POST", body: { image } });
          callback(url, blob.name?.replace(/\.[a-z0-9]+$/i, "") ?? "");
        } catch (error) {
          newsSay(describe(error) ?? "Could not upload that picture.");
        }
      },
    },
  });
  newsForm.story.hidden = true;
  return storyEditor;
}

function storyValue() {
  return storyEditor ? storyEditor.getMarkdown() : newsForm.story.value;
}

function setStory(markdown) {
  newsForm.story.value = markdown;
  if (storyEditor) storyEditor.setMarkdown(markdown, false);
}

function showSection(next) {
  section = next;
  for (const tab of document.querySelectorAll("#sections [data-section]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.section === next));
  }
  $("#heading").textContent = next === "news" ? "News" : next === "comments" ? "Comments" : "Users";
  show(next === "news" ? "news" : next === "comments" ? "comments" : "list");
  if (next === "news") loadNews();
  else if (next === "comments") loadComments();
  else load();
}

async function loadNews() {
  busy(true);
  try {
    const data = await api("/api/admin/posts?feed=news");
    newsPosts = data.posts;
    renderNews();
  } catch (error) {
    say(describe(error) ?? "Could not load the news.");
  } finally {
    busy(false);
  }
}

function renderNews() {
  const body = $("#news-rows");
  body.replaceChildren();
  for (const post of newsPosts) {
    const tr = document.createElement("tr");
    tr.className = "row";
    const title = document.createElement("td");
    title.className = "title";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link inline user";
    open.textContent = post.title;
    open.addEventListener("click", () => openNews(post));
    title.append(open);
    const date = document.createElement("td");
    date.textContent = when(post.publishedAt);
    const link = document.createElement("td");
    const a = document.createElement("a");
    a.href = post.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Open";
    link.append(a);
    tr.append(title, date, link);
    body.append(tr);
  }
  $("#news-empty").hidden = newsPosts.length > 0;
  $("#news-summary").textContent = `${newsPosts.length} news post${newsPosts.length === 1 ? "" : "s"}, newest first.`;
}

/** An ISO instant as the datetime-local input wants it: local wall-clock time, to the minute. */
function localInputValue(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The photo as JPEG, no larger than MAX_EDGE on its long side, base64 for the API. */
async function encodePhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the photo."))), "image/jpeg", 0.88),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), contentType: "image/jpeg" };
}

function clearNewsStatus() {
  $("#n-status").textContent = "";
  $("#n-status").className = "status-line";
}

function newsSay(text, ok = false) {
  const line = $("#n-status");
  line.textContent = text;
  line.classList.toggle("ok", ok);
  line.classList.toggle("bad", !ok);
}

/**
 * Opens the dialog on a post from the list (fetching it in full, story
 * included), or empty for a new one.
 */
async function openNews(summary) {
  let post = null;
  if (summary) {
    busy(true);
    try {
      post = await api(`/api/posts/${encodeURIComponent(summary.id)}`);
    } catch (error) {
      say(describe(error) ?? "Could not load that post.");
      return;
    } finally {
      busy(false);
    }
  }
  editing = post;
  newsPhoto = null;
  newsForm.reset();
  $("#n-heading").textContent = post ? "Edit news post" : "Write a news post";
  $("#n-meta").textContent = post ? `${post.id} · published ${when(post.publishedAt)}` : "Goes live on the site as soon as it is published.";
  newsForm.title.value = post?.title ?? "";
  newsForm.publishedAt.value = localInputValue(post?.publishedAt);
  ensureStoryEditor();
  setStory(post?.story ?? "");
  $("#n-photo").hidden = !post?.image?.url;
  $("#n-photo-img").src = post?.image?.url ?? "";
  $("#n-save").textContent = post ? "Save" : "Publish";
  $("#n-save").disabled = false;
  $("#n-open").hidden = !post?.url;
  $("#n-open").href = post?.url ?? "#";
  $("#n-remove").hidden = !post;
  clearNewsStatus();
  newsDialog.showModal();
  newsForm.title.focus();
}

$("#news-write").addEventListener("click", () => openNews(null));

newsForm.photo.addEventListener("change", async () => {
  const file = newsForm.photo.files?.[0];
  if (!file) return;
  try {
    newsPhoto = await encodePhoto(file);
    $("#n-photo-img").src = URL.createObjectURL(file);
    $("#n-photo").hidden = false;
    clearNewsStatus();
  } catch (error) {
    newsPhoto = null;
    newsSay(error.message ?? "Could not read the photo.");
  }
});

/** What the dialog holds, in the shape the API takes; for an edit, only what changed. */
function newsValues() {
  const title = newsForm.title.value.trim();
  const story = storyValue();
  const local = newsForm.publishedAt.value;
  const publishedAt = local ? new Date(local).toISOString() : "";
  if (!editing) {
    return {
      title,
      story,
      storyFormat: "markdown",
      ...(publishedAt ? { publishedAt } : {}),
      ...(newsPhoto ? { image: newsPhoto } : {}),
    };
  }
  const out = {};
  if (title !== editing.title) out.title = title;
  if (story !== (editing.story ?? "")) {
    out.story = story;
    out.storyFormat = "markdown";
  }
  if (publishedAt && publishedAt !== new Date(editing.publishedAt).toISOString()) out.publishedAt = publishedAt;
  if (newsPhoto) out.image = newsPhoto;
  return out;
}

newsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = newsValues();
  if (!editing && !values.title) return newsSay("Give it a title.");
  if (editing && !Object.keys(values).length) return newsSay("Nothing changed.");
  if ("title" in values && !values.title) return newsSay("Give it a title.");
  $("#n-save").disabled = true;
  try {
    if (editing) {
      const result = await api(`/api/posts/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: values });
      editing = result.post;
      newsPhoto = null;
      newsSay("Saved. The site rebuilds in a minute or two.", true);
    } else {
      const result = await api("/api/admin/posts", { method: "POST", body: values });
      editing = result.post;
      newsPhoto = null;
      $("#n-heading").textContent = "Edit news post";
      $("#n-meta").textContent = `${editing.id} · published ${when(editing.publishedAt)}`;
      $("#n-save").textContent = "Save";
      $("#n-open").hidden = false;
      $("#n-open").href = editing.url;
      $("#n-remove").hidden = false;
      newsSay("Published. The site rebuilds in a minute or two.", true);
    }
    await loadNews();
  } catch (error) {
    newsSay(describe(error) ?? "Could not save the post.");
  } finally {
    $("#n-save").disabled = false;
  }
});

$("#n-close").addEventListener("click", () => newsDialog.close());

$("#n-remove").addEventListener("click", async () => {
  if (!editing) return;
  const post = editing;
  $("#confirm-text").textContent = `Remove "${post.title}" from the site? It disappears from bikes.pizza and the app at the next build.`;
  if (!(await confirmYesNo())) return;
  $("#n-remove").disabled = true;
  try {
    await api(`/api/posts/${encodeURIComponent(post.id)}`, { method: "DELETE" });
    newsDialog.close();
    say(`Removed "${post.title}".`, true);
    await loadNews();
  } catch (error) {
    newsSay(describe(error) ?? "Could not remove the post.");
  } finally {
    $("#n-remove").disabled = false;
  }
});

for (const tab of document.querySelectorAll("#sections [data-section]")) {
  tab.addEventListener("click", () => showSection(tab.dataset.section));
}

// ---- comments -------------------------------------------------------------

const QUEUE_LABELS = { pending: "waiting for review", reported: "reported", recent: "published recently" };
const HOLD_LABELS = { screen: "Held by the scores", words: "Suspicious word", reports: "Hidden by reports" };

let queue = "pending";
let comments = [];
let wordsLoaded = false;

/** Loads the current queue and, the first time, the word lists. */
async function loadComments() {
  busy(true);
  try {
    const data = await api(`/api/admin/comments?queue=${queue}`);
    comments = data.comments;
    renderComments();
    if (!wordsLoaded) {
      const lists = await api("/api/admin/moderation");
      $("#words-form").elements.banned.value = lists.banned.join("\n");
      $("#words-form").elements.suspicious.value = lists.suspicious.join("\n");
      wordsLoaded = true;
    }
  } catch (error) {
    say(describe(error) ?? "Could not load the comments.");
  } finally {
    busy(false);
  }
}

/** A short pill for a screening score, a matched word or a report reason. */
function flag(text, kind = "") {
  const span = document.createElement("span");
  span.className = `flag ${kind}`.trim();
  span.textContent = text;
  return span;
}

/** What the screening and the reports said about a comment, as pills. */
function screeningCell(comment) {
  const td = document.createElement("td");
  const s = comment.screening ?? {};
  if (comment.status === "pending" || comment.status === "hidden") td.append(flag(HOLD_LABELS[comment.hold] ?? "Held", "bad"));
  for (const word of s.matched ?? []) td.append(flag(`"${word}"`, "bad"));
  const scores = Object.entries(s.scores ?? {})
    .filter(([, v]) => v >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  for (const [name, value] of scores) td.append(flag(`${name} ${Math.round(value * 100)}%`, value >= 0.8 ? "bad" : ""));
  if (s.error) td.append(flag("Screening failed", "bad"));
  for (const reason of comment.reports ?? []) td.append(flag(`Reported: ${reason}`, "bad"));
  if (!td.childNodes.length) td.append(flag(s.language ? `Clean (${s.language})` : "Clean", "ok"));
  return td;
}

function renderComments() {
  const body = $("#comment-rows");
  body.replaceChildren();
  for (const comment of comments) {
    const tr = document.createElement("tr");
    tr.className = "row";
    const text = document.createElement("td");
    text.className = "text";
    const by = document.createElement("span");
    by.className = "by";
    by.textContent = `${comment.username || "(no username)"} · ${when(comment.createdAt)}${comment.editedAt ? " (edited)" : ""}${comment.parentId ? " · reply" : ""}`;
    const html = document.createElement("div");
    html.className = "body";
    // Rendered by the functions from the Markdown subset and sanitised there.
    html.innerHTML = comment.html || "";
    text.append(by, html);
    const post = document.createElement("td");
    post.className = "post";
    if (comment.post?.url) {
      const a = document.createElement("a");
      a.href = comment.post.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = comment.post.title || comment.post.id;
      post.append(a);
    } else {
      post.textContent = comment.post?.title || comment.post?.id || "";
    }
    const acts = document.createElement("td");
    acts.className = "acts";
    if (comment.status === "pending" || comment.status === "hidden") {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "secondary small-btn";
      approve.textContent = comment.status === "hidden" ? "Restore" : "Approve";
      approve.addEventListener("click", () => act(comment, "approve"));
      acts.append(approve);
    }
    if (comment.status !== "removed") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary small-btn delete";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => act(comment, "remove"));
      acts.append(remove);
    }
    tr.append(text, post, screeningCell(comment), acts);
    body.append(tr);
  }
  $("#comments-empty").hidden = comments.length > 0;
  $("#comments-summary").textContent = `${comments.length} comment${comments.length === 1 ? "" : "s"} ${QUEUE_LABELS[queue]}.`;
}

/** Approves (publishes) or removes a comment, then reloads the queue. */
async function act(comment, action) {
  if (action === "remove") {
    $("#confirm-text").textContent = `Remove this comment by ${comment.username || "this member"}? Replies under it stay.`;
    if (!(await confirmYesNo())) return;
  }
  busy(true);
  try {
    await api(`/api/admin/comments/${encodeURIComponent(comment.post.id)}/${encodeURIComponent(comment.id)}/${action}`, { method: "POST" });
    say(action === "approve" ? "Published." : "Removed.", true);
    await loadComments();
  } catch (error) {
    say(describe(error) ?? `Could not ${action} that comment.`);
  } finally {
    busy(false);
  }
}

for (const button of document.querySelectorAll("[data-queue]")) {
  button.addEventListener("click", () => {
    queue = button.dataset.queue;
    for (const b of document.querySelectorAll("[data-queue]")) b.setAttribute("aria-pressed", String(b === button));
    loadComments();
  });
}

const lines = (value) =>
  value
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean);

$("#words-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = $("#words-form");
  const status = $("#words-status");
  $("#words-save").disabled = true;
  status.textContent = "";
  status.className = "status-line";
  try {
    const saved = await api("/api/admin/moderation", {
      method: "PUT",
      body: { banned: lines(form.elements.banned.value), suspicious: lines(form.elements.suspicious.value) },
    });
    form.elements.banned.value = saved.banned.join("\n");
    form.elements.suspicious.value = saved.suspicious.join("\n");
    status.textContent = `Saved: ${saved.banned.length} banned, ${saved.suspicious.length} suspicious.`;
    status.classList.add("ok");
  } catch (error) {
    status.textContent = describe(error) ?? "Could not save the word lists.";
    status.classList.add("bad");
  } finally {
    $("#words-save").disabled = false;
  }
});

// ---- events ---------------------------------------------------------------

$("#prev").addEventListener("click", () => {
  if (page > 1) {
    page -= 1;
    load();
  }
});
$("#next").addEventListener("click", () => {
  if (page < pages) {
    page += 1;
    load();
  }
});

// ---- passkeys ---------------------------------------------------------------
//
// The same passkeys as the account page (the relying party is the site's
// own domain, and these pages are subdomains of it). A passkey sign-in
// mints a custom token carrying `passkey: true`, which the API and the
// check below accept in place of the authenticator code, so it also
// answers the second factor for an account that has one.

const PASSKEYS_SUPPORTED = typeof PublicKeyCredential !== "undefined" && typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function";

// Whether a passkey for this site has been added or used in this browser.
// The web cannot ask whether one is present, so this is the last resort
// for deciding whether to reach for one: it only matters when the parked
// sign-in named no account, since a named account is settled by asking the
// server what passkeys it has.
const PASSKEY_SEEN = "bikes-pizza-passkey";
const passkeyOnThisDevice = () => {
  try {
    return localStorage.getItem(PASSKEY_SEEN) === "1";
  } catch {
    return false; // storage blocked
  }
};
const rememberPasskey = () => {
  try {
    localStorage.setItem(PASSKEY_SEEN, "1");
  } catch {
    // Nothing to remember it with.
  }
};

function describePasskeyError(error, fallback) {
  switch (error?.name) {
    case "NotAllowedError":
    case "AbortError":
      return null; // the person backed out of the prompt
    case "NotSupportedError":
    case "SecurityError":
      return "Passkeys are not available here.";
    default:
      return describe(error) ?? fallback;
  }
}

/**
 * Options as the browser's parser will take them. A field the server left
 * out arrives as a null (the callable encoder's doing), and the parser
 * refuses a null where it wants a list; the server drops those keys now,
 * and this keeps an older deployment from breaking the page.
 */
const readable = (options) => Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null));

/**
 * Signs in with a passkey. Given an [account] ({email, uid}) only that
 * account's passkeys count, so a passkey can stand in for its
 * authenticator code; without one the browser offers whichever it holds
 * for the site. False when there is nothing to try, so the caller can ask
 * for the code instead.
 */
async function passkeySignInWith(account) {
  const hint = {};
  if (account?.email) hint.email = account.email;
  if (account?.uid) hint.uid = account.uid;
  const { data: start } = await passkeySignInOptions(hint);
  if (!start.options) return false; // that account has no passkeys
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(readable(start.options)),
  });
  const { data } = await passkeySignIn({ challengeId: start.challengeId, response: credential.toJSON() });
  await signInWithCustomToken(auth, data.token);
  rememberPasskey();
  return true;
}

// ---- second factor --------------------------------------------------------

let resolver = null; // pending sign-in waiting for the authenticator code
let secondFactorAccount = null; // who that sign-in is for

/**
 * Who a parked sign-in is for. A multi-factor error carries no address of
 * its own, only the raw sign-in response, so this digs the account out of
 * that: the address the response reported, or the provider's own token
 * (Apple fills the address in only on the first authorization, but its
 * token carries it every time), or the uid, which names the account just
 * as well.
 */
function pendingAccount(error, email) {
  const response = error?.customData?._serverResponse ?? {};
  return {
    email: email ?? response.email ?? emailFromIdToken(response.oauthIdToken) ?? null,
    uid: response.localId ?? null,
  };
}

/** The `email` claim of a token the provider signed and Firebase checked. */
function emailFromIdToken(token) {
  if (typeof token !== "string") return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const { email } = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)));
    return typeof email === "string" && email ? email : null;
  } catch {
    return null; // not a token this understands
  }
}

/**
 * Runs a sign-in; when Firebase asks for the second factor, a passkey on
 * this device answers it and otherwise the code prompt appears. [email] is
 * the account being signed in to, when the caller knows it.
 */
async function attemptSignIn(signIn, email = null) {
  busy(true);
  try {
    await signIn();
  } catch (error) {
    if (error?.code === "auth/multi-factor-auth-required") {
      resolver = getMultiFactorResolver(auth, error);
      await secondFactor(pendingAccount(error, email));
      return;
    }
    const text = describe(error);
    if (text) say(text);
  } finally {
    busy(false);
  }
}

/**
 * A sign-in Firebase parked for its second factor. A passkey this browser
 * holds for the account settles it without a code; anything else falls
 * through to the code step, which offers the passkey again.
 */
async function secondFactor(account) {
  secondFactorAccount = account;
  // With the account named, the server says whether it has any passkeys,
  // so nothing is prompted for that a passkey could not answer. Without a
  // name, go by whether this browser has been seen using one.
  const worthTrying = PASSKEYS_SUPPORTED && (account.email || account.uid || passkeyOnThisDevice());
  if (worthTrying) {
    try {
      if (await passkeySignInWith(account)) return; // signed in, no code
    } catch {
      // Ask for the code instead.
    }
  }
  askForCode();
}

function askForCode() {
  $("#mfa-passkey").hidden = !PASSKEYS_SUPPORTED;
  $("#mfa-code-form").code.value = "";
  show("mfa-code");
  $("#mfa-code-form").code.focus();
}

$("#mfa-code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = event.currentTarget.code.value.trim();
  if (!resolver) return show("signin");
  if (!/^\d{6}$/.test(code)) return say("Enter the 6-digit code.");
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ?? resolver.hints[0];
  busy(true);
  try {
    await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
    resolver = null;
    secondFactorAccount = null;
    // onAuthStateChanged takes it from here.
  } catch (error) {
    say(describe(error) ?? "Could not verify the code.");
  } finally {
    busy(false);
  }
});

$("#mfa-code-cancel").addEventListener("click", () => {
  resolver = null;
  secondFactorAccount = null;
  show("signin");
});

// The code step's own passkey button, for a browser that has one but was
// interrupted, or that this page had not seen use a passkey before.
$("#mfa-passkey").addEventListener("click", async () => {
  busy(true);
  try {
    if (await passkeySignInWith(secondFactorAccount)) return;
    say("No passkey is saved for this account yet. Enter the code, then add one from your account page.");
  } catch (error) {
    const text = describePasskeyError(error, "Could not sign in with the passkey.");
    if (text) say(text);
  } finally {
    busy(false);
  }
});

let enrolling = null; // the TOTP secret being enrolled

/** Shows the QR code and asks for a first code to finish enrolment. */
async function startEnrollment(user) {
  try {
    const session = await multiFactor(user).getSession();
    enrolling = await TotpMultiFactorGenerator.generateSecret(session);
  } catch (error) {
    // Enrolment needs a recent sign-in; an old session has to start over.
    await signOut(auth);
    say(
      error?.code === "auth/requires-recent-login"
        ? "Sign in again to set up two-factor authentication."
        : (describe(error) ?? "Could not start two-factor setup."),
    );
    return;
  }
  const url = enrolling.generateQrCodeUrl(user.email ?? "admin", "bikes.pizza admin");
  const box = $("#qr");
  box.replaceChildren();
  if (window.QRCode) new window.QRCode(box, { text: url, width: 192, height: 192, correctLevel: window.QRCode.CorrectLevel.M });
  $("#secret-key").textContent = enrolling.secretKey;
  $("#mfa-setup-form").code.value = "";
  show("mfa-setup");
}

$("#mfa-setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = event.currentTarget.code.value.trim();
  const user = auth.currentUser;
  if (!enrolling || !user) return show("signin");
  if (!/^\d{6}$/.test(code)) return say("Enter the 6-digit code from the app.");
  busy(true);
  try {
    await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(enrolling, code), "Authenticator app");
    enrolling = null;
    // The current session was not signed in with the second factor, so the
    // API would refuse it: start over with a proper two-step sign-in.
    await signOut(auth);
    say("Two-factor authentication is on. Sign in again, with the code from your app.", true);
  } catch (error) {
    say(describe(error) ?? "Could not turn on two-factor authentication.");
  } finally {
    busy(false);
  }
});

$("#mfa-setup-cancel").addEventListener("click", () => signOut(auth));

async function signInWith(provider) {
  await attemptSignIn(() => signInWithPopup(auth, provider));
}
$("#passkey-signin").hidden = !PASSKEYS_SUPPORTED;
$("#passkey-signin").addEventListener("click", () =>
  attemptSignIn(async () => {
    try {
      if (!(await passkeySignInWith(null))) say("This browser has no passkey for bikes.pizza yet.");
    } catch (error) {
      const text = describePasskeyError(error, "Could not sign in with the passkey.");
      if (text) say(text);
    }
  }),
);
$("#google").addEventListener("click", () => signInWith(new GoogleAuthProvider()));
$("#apple").addEventListener("click", () => {
  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");
  return signInWith(apple);
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.currentTarget;
  const email = f.email.value.trim();
  await attemptSignIn(() => signInWithEmailAndPassword(auth, email, f.password.value), email);
});
$("#signout").addEventListener("click", () => signOut(auth));

// ---- start ----------------------------------------------------------------

// The submissions link follows the host: admin.<domain> → submissions.<domain>.
if (location.hostname.startsWith("admin.")) {
  $("#submissions-link").href = `https://submissions.${location.hostname.slice("admin.".length)}/`;
}

onAuthStateChanged(auth, async (user) => {
  $("#who").hidden = !user;
  if (!user) {
    show("signin");
    return;
  }
  $("#message").hidden = true;
  $("#who-email").textContent = user.email ?? "";
  // Claims come with the token; refresh in case the admin claim is new.
  const token = await user.getIdTokenResult(true);
  if (token.claims.admin !== true) {
    show("forbidden");
    return;
  }
  if (multiFactor(user).enrolledFactors.length === 0) {
    await startEnrollment(user);
    return;
  }
  // A passkey sign-in (a custom token with `passkey: true`) counts as the
  // second factor: the device verified the person.
  if (!token.claims.firebase?.sign_in_second_factor && token.claims.passkey !== true) {
    // A session from before the second factor was enrolled.
    await signOut(auth);
    say("Sign in again, with the code from your authenticator app.");
    return;
  }
  $("#sections").hidden = false;
  page = 1;
  showSection(section);
});
