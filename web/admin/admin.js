// User administration (admins only): who has signed up, what they have
// posted, their newsletter choice; edits, password resets and deletion.
//
// Talks to the REST API at /api/admin/users (see functions/api.js and
// functions/admin_users.js) with the signed-in admin's Firebase ID token.
// Password resets go through Firebase Auth directly, which emails the
// member its usual reset link.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  OAuthProvider,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const PAGE_SIZE = 25;
const $ = (sel) => document.querySelector(sel);

const config = await fetch("/__/firebase/init.json").then((r) => r.json());
const app = initializeApp(config);
const auth = getAuth(app);

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
  return new Promise((resolve) => {
    $("#confirm-text").textContent =
      `Delete ${user.username || user.email}? Their account and profile go; their posts stay as they are.`;
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

async function signInWith(provider) {
  busy(true);
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const text = describe(error);
    if (text) say(text);
  } finally {
    busy(false);
  }
}
$("#google").addEventListener("click", () => signInWith(new GoogleAuthProvider()));
$("#apple").addEventListener("click", () => {
  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");
  return signInWith(apple);
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.currentTarget;
  busy(true);
  try {
    await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
  } catch (error) {
    say(describe(error) ?? "Could not sign in.");
  } finally {
    busy(false);
  }
});
$("#signout").addEventListener("click", () => signOut(auth));

// ---- start ----------------------------------------------------------------

// The submissions link follows the host: admin.<domain> → submissions.<domain>.
if (location.hostname.startsWith("admin.")) {
  $("#submissions-link").href = `https://submissions.${location.hostname.slice("admin.".length)}/`;
}

onAuthStateChanged(auth, async (user) => {
  $("#message").hidden = true;
  $("#who").hidden = !user;
  if (!user) {
    show("signin");
    return;
  }
  $("#who-email").textContent = user.email ?? "";
  // Claims come with the token; refresh in case the admin claim is new.
  const token = await user.getIdTokenResult(true);
  if (token.claims.admin !== true) {
    show("forbidden");
    return;
  }
  show("list");
  page = 1;
  load();
});
