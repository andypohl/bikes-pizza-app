// Review page for member submissions (admins only).
//
// Reads the `submissions` collection directly (Firestore rules allow it for
// users with the `admin` claim) and thumbnails from Storage, and calls the
// reviewSubmission function to publish, draft or reject.

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
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const PAGE_SIZE = 20;
const $ = (sel) => document.querySelector(sel);

const config = await fetch("/__/firebase/init.json").then((r) => r.json());
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const reviewSubmission = httpsCallable(getFunctions(app, "us-central1"), "reviewSubmission");

let status = "pending"; // current filter; "" means all
let cursors = []; // last document of each loaded page, for Previous/Next
let page = 0;
let rows = []; // { id, data, thumbUrl }
let current = null; // the submission open in the dialog

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

const urlCache = new Map();
async function fileUrl(path) {
  if (!path) return "";
  if (!urlCache.has(path)) {
    urlCache.set(path, getDownloadURL(ref(storage, path)).catch(() => ""));
  }
  return urlCache.get(path);
}

function when(ts) {
  const d = ts?.toDate?.();
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

const STATUS_LABEL = { pending: "Pending", approved: "Posted", rejected: "Rejected" };
const FEED_LABEL = { pizza: "Pizza", bikes: "Bike" };

function describe(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Email or password is incorrect.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null;
    case "functions/permission-denied":
    case "functions/failed-precondition":
    case "functions/invalid-argument":
    case "functions/not-found":
      return error.message;
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- list -----------------------------------------------------------------

function buildQuery(after) {
  const parts = [collection(db, "submissions")];
  if (status) parts.push(where("status", "==", status));
  parts.push(orderBy("createdAt", "desc"));
  if (after) parts.push(startAfter(after));
  parts.push(limit(PAGE_SIZE + 1)); // one extra to know whether a next page exists
  return query(...parts);
}

let hasNext = false;

async function load() {
  busy(true);
  try {
    const after = page > 0 ? cursors[page - 1] : null;
    const snap = await getDocs(buildQuery(after));
    const docs = snap.docs.slice(0, PAGE_SIZE);
    hasNext = snap.docs.length > PAGE_SIZE;
    cursors[page] = docs[docs.length - 1] ?? null;
    rows = await Promise.all(
      docs.map(async (d) => ({ id: d.id, data: d.data(), thumbUrl: await fileUrl(d.data().image?.thumbPath) })),
    );
    render();
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
    const d = row.data;
    const cells = [
      row.thumbUrl ? Object.assign(document.createElement("img"), { src: row.thumbUrl, alt: "" }) : "",
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

async function openDetail(row) {
  current = row;
  const d = row.data;
  $("#d-title").textContent = d.title;
  $("#d-meta").textContent = `${FEED_LABEL[d.feed] ?? d.feed} · from ${d.from} <${d.email}> · ${when(d.createdAt)}`;
  $("#d-description").textContent = d.description || "(no description)";
  $("#d-image").src = row.thumbUrl;
  const full = await fileUrl(d.image?.path);
  $("#d-image").src = full || row.thumbUrl;
  $("#d-image-link").href = full || "#";
  const pending = d.status === "pending";
  $("#d-actions").hidden = !pending;
  $("#d-note-label").hidden = !pending;
  $("#d-note").value = "";
  const r = d.review;
  $("#d-review").hidden = !r;
  if (r) {
    const bits = [`${STATUS_LABEL[d.status]} by ${r.byEmail ?? r.by} on ${when(r.at)}`];
    if (r.postUrl) bits.push(r.postStatus === "draft" ? `draft ${r.postId}` : r.postUrl);
    if (r.note) bits.push(`Note: ${r.note}`);
    $("#d-review").textContent = bits.join(" · ");
  }
  $("#detail").showModal();
}

async function review(action) {
  if (!current) return;
  if (action === "reject" && !confirm("Reject this submission?")) return;
  busy(true);
  try {
    const { data } = await reviewSubmission({ id: current.id, action, note: $("#d-note").value });
    $("#detail").close();
    if (data.status === "approved") {
      say(
        data.postStatus === "draft"
          ? "Saved as a draft in Ghost."
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
