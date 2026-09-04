// Review page for member submissions (admins only).
//
// Talks to the REST API at /api/ (see functions/api.js) with the signed-in
// user's Firebase ID token; the API checks the `admin` claim.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  OAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
const PAGE_SIZE = 20;
const $ = (sel) => document.querySelector(sel);

const config = await fetch("/__/firebase/init.json").then((r) => r.json());
const app = initializeApp(config);
const auth = getAuth(app);

let status = "pending"; // current filter; "" means all
let cursors = []; // next-page cursor returned for each loaded page
let page = 0;
let rows = []; // submissions as returned by the API
let current = null; // the submission open in the dialog

/** Calls the REST API as the signed-in user; throws {code, message} on failure. */
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
}

function busy(on) {
  for (const b of document.querySelectorAll("button")) b.disabled = on;
}

function when(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

const STATUS_LABEL = { pending: "Pending", queued: "Queued", posting: "Posting", approved: "Posted", rejected: "Rejected" };
const FEED_LABEL = { pizza: "Pizza", bikes: "Bike" };
const FEEDS = ["bikes", "pizza"];

function at(iso) {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
}

/** Shows each feed's queue length and time to its next post. */
async function loadQueues() {
  try {
    const infos = await Promise.all(FEEDS.map((feed) => api(`/api/queue/${feed}/countdown-time`)));
    $("#queues").textContent = infos
      .map((q) => `${FEED_LABEL[q.feed]} queue: ${q.length} waiting · next post in ${q.countdown} (${at(q.nextPostAt)})`)
      .join(" — ");
  } catch {
    $("#queues").textContent = "";
  }
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
    case "api/permission-denied":
    case "api/failed-precondition":
    case "api/invalid-argument":
    case "api/not-found":
    case "api/unauthenticated":
      return error.message;
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- list -----------------------------------------------------------------

let hasNext = false;

async function load() {
  busy(true);
  try {
    const params = new URLSearchParams({ status, limit: String(PAGE_SIZE) });
    if (page > 0 && cursors[page - 1]) params.set("after", cursors[page - 1]);
    const { items, nextCursor } = await api(`/api/submissions?${params}`);
    rows = items;
    cursors[page] = nextCursor;
    hasNext = Boolean(nextCursor);
    render();
    loadQueues();
    loadSiteSettings();
  } catch (error) {
    say(describe(error) ?? "Could not load submissions.");
  } finally {
    busy(false);
  }
}

function render() {
  const body = $("#rows");
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = "row";
    const d = row;
    const cells = [
      d.image.thumbUrl ? Object.assign(document.createElement("img"), { src: d.image.thumbUrl, alt: "" }) : "",
      FEED_LABEL[d.feed] ?? d.feed,
      d.title,
      d.from,
      when(d.createdAt),
      Object.assign(document.createElement("span"), {
        className: `status ${d.status}`,
        textContent: STATUS_LABEL[d.status] ?? d.status,
      }),
      Object.assign(document.createElement("button"), {
        type: "button",
        className: "link inline",
        textContent: d.status === "pending" ? "Review" : "View",
      }),
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      td.append(c);
      tr.append(td);
    }
    tr.addEventListener("click", () => openDetail(row));
    body.append(tr);
  }
  $("#empty").hidden = rows.length > 0;
  $("#prev").disabled = page === 0;
  $("#next").disabled = !hasNext;
  $("#page-label").textContent = rows.length ? `Page ${page + 1}` : "";
}

function setFilter(next) {
  status = next;
  page = 0;
  cursors = [];
  for (const tab of document.querySelectorAll("#filters [data-status]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.status === status));
  }
  load();
}

// ---- detail dialog --------------------------------------------------------

function openDetail(row) {
  current = row;
  const d = row;
  $("#d-title").textContent = d.title;
  $("#d-meta").textContent = `${FEED_LABEL[d.feed] ?? d.feed} · from ${d.from} <${d.submittedBy.email}> · ${when(d.createdAt)}`;
  $("#d-description").textContent = d.description || "(no description)";
  const ss = d.safeSearch;
  $("#d-safesearch").hidden = !ss;
  if (ss) {
    const pretty = (v) => (v ?? "unknown").toLowerCase().replace("_", " ");
    $("#d-safesearch").textContent = `SafeSearch: adult ${pretty(ss.adult)} · racy ${pretty(ss.racy)} · violence ${pretty(ss.violence)}`;
  }
  const full = d.image.photoUrl;
  $("#d-image").src = full || d.image.thumbUrl || "";
  $("#d-image-link").href = full || "#";
  const pending = d.status === "pending";
  $("#d-actions").hidden = !pending;
  $("#d-queue-actions").hidden = d.status !== "queued";
  $("#d-note-label").hidden = !pending;
  $("#d-note").value = "";
  const r = d.review;
  const q = d.queue;
  $("#d-review").hidden = !r && !q;
  if (r) {
    const bits = [`${STATUS_LABEL[d.status]} by ${r.byEmail ?? r.by} on ${when(r.at)}`];
    if (r.postUrl) bits.push(r.postStatus === "draft" ? `draft ${r.postId}` : r.postUrl);
    if (r.note) bits.push(`Note: ${r.note}`);
    $("#d-review").textContent = bits.join(" · ");
  } else if (q) {
    const bits = [`Queued by ${q.byEmail ?? q.by} on ${when(q.at)}`];
    if (q.note) bits.push(`Note: ${q.note}`);
    if (q.lastError) bits.push(`Last attempt failed: ${q.lastError}`);
    $("#d-review").textContent = bits.join(" · ");
  }
  $("#detail").showModal();
}

async function review(action) {
  if (!current) return;
  if (action === "reject" && !confirm("Reject this submission?")) return;
  busy(true);
  try {
    const data = await api(`/api/submissions/${encodeURIComponent(current.id)}/review`, {
      method: "POST",
      body: { action, note: $("#d-note").value },
    });
    $("#detail").close();
    if (data.status === "queued") {
      say(`Queued at position ${data.position} for ${FEED_LABEL[data.feed]}; next post in ${data.countdown} (${at(data.nextPostAt)}).`, true);
    } else if (data.status === "approved") {
      say(
        data.postStatus === "draft"
          ? "Saved as a draft in Sanity."
          : `Published: ${data.postUrl ?? data.postId}`,
        true,
      );
    } else {
      say("Rejected.", true);
    }
    await load();
  } catch (error) {
    say(describe(error) ?? "Could not review the submission.");
  } finally {
    busy(false);
  }
}

// ---- events ---------------------------------------------------------------

for (const tab of document.querySelectorAll("#filters [data-status]")) {
  tab.addEventListener("click", () => setFilter(tab.dataset.status));
}
$("#prev").addEventListener("click", () => {
  if (page > 0) {
    page -= 1;
    load();
  }
});
$("#next").addEventListener("click", () => {
  if (hasNext) {
    page += 1;
    load();
  }
});
$("#d-publish").addEventListener("click", () => review("publish"));
$("#d-draft").addEventListener("click", () => review("draft"));
$("#d-reject").addEventListener("click", () => review("reject"));
$("#d-dequeue").addEventListener("click", async () => {
  if (!current) return;
  busy(true);
  try {
    await api(`/api/queue/${current.feed}/remove`, { method: "POST", body: { id: current.id } });
    $("#detail").close();
    say("Removed from the queue; it is pending again.", true);
    await load();
  } catch (error) {
    say(describe(error) ?? "Could not change the queue.");
  } finally {
    busy(false);
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
  const form = event.currentTarget;
  busy(true);
  try {
    await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
  } catch (error) {
    say(describe(error) ?? "Could not sign in.");
  } finally {
    busy(false);
  }
});
$("#signout").addEventListener("click", () => signOut(auth));

// ---- site settings (the website's submit button) ---------------------------

const settingBox = $("#submit-button-setting");

async function loadSiteSettings() {
  try {
    const settings = await api("/api/site/settings");
    settingBox.checked = settings.submitButton;
    settingBox.disabled = false;
  } catch (error) {
    settingBox.disabled = true;
    console.warn("site settings unavailable", error);
  }
}

settingBox.addEventListener("change", async () => {
  settingBox.disabled = true;
  try {
    const settings = await api("/api/site/settings", { method: "POST", body: { submitButton: settingBox.checked } });
    settingBox.checked = settings.submitButton;
  } catch (error) {
    settingBox.checked = !settingBox.checked;
    alert(error.message ?? "Could not change the setting.");
  } finally {
    settingBox.disabled = false;
  }
});

// ---- start ----------------------------------------------------------------

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
  setFilter("pending");
});
