// bikes.pizza account page.
//
// Signs people in with Firebase Auth (the same user base as the app), then
// either sends them on to the website (the Firebase session covers it) or
// (mode=account) shows their account: username, newsletters and password.
// Members without a username (new sign-ups, Google and Apple accounts,
// accounts from before usernames) are asked to choose one first.
//
// Query parameters:
//   mode=signin|signup   which tab to open first (default signin)
//   mode=account         show the account screen after signing in
//   r=/some/path/        path on the site to land on afterwards

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const SITE = "https://bikes.pizza";
// The same page is served at /account/ on the bikes.pizza site. There the
// session lives on the site's own origin, so sign-in returns to the page the
// person came from, and sign-out goes back to the site.
const ON_SITE = location.pathname.startsWith("/account");
const params = new URLSearchParams(location.search);
const redirectTo = sanitizePath(params.get("r"));

const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const message = $("#message");

// Firebase Hosting serves the project's web config at this reserved URL, so
// nothing project-specific needs to live in this file.
const config = await fetch("/__/firebase/init.json").then((r) => r.json());
const firebase = initializeApp(config);
const auth = getAuth(firebase);
const functions = getFunctions(firebase, "us-central1");
const loadMember = httpsCallable(functions, "member");
const updateMember = httpsCallable(functions, "updateMember");

// What to do once someone is signed in: hand them to the site, or show the
// account screen.
const intent = params.get("mode") === "account" ? "account" : "site";
let mode = params.get("mode") === "signup" ? "signup" : "signin";
let handled = false; // guards against acting twice on auth state changes
// Set when the person signs in on this page (rather than arriving with a
// session); only then is the profile checked before sending them on, so
// returning members are not held up by a round trip.
let freshSignIn = false;

// Usernames: kept in step with `USERNAME_PATTERN` in functions/account.js.
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
const USERNAME_RULE = "Username must be 3 to 24 letters, digits or underscores.";

// ---- sign-up choices, kept until the email is verified ---------------------
//
// The member functions only accept verified users, so what a new member
// chose while signing up waits in this browser until they have verified.

const pendingKey = (uid) => `bikes.pizza:pending-profile:${uid}`;

function savePending(uid, choices) {
  try {
    localStorage.setItem(pendingKey(uid), JSON.stringify(choices));
  } catch {
    // Storage unavailable; the setup step will ask again.
  }
}

function hasPending(uid) {
  try {
    return localStorage.getItem(pendingKey(uid)) !== null;
  } catch {
    return false;
  }
}

function takePending(uid) {
  try {
    const raw = localStorage.getItem(pendingKey(uid));
    localStorage.removeItem(pendingKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- view helpers ---------------------------------------------------------

function show(view) {
  app.dataset.state = view;
  // Signed out, the site's navigation floats top-right as on the website.
  $("#site-nav").hidden = view !== "auth";
  for (const section of document.querySelectorAll("[data-view]")) {
    section.hidden = section.dataset.view !== view;
  }
  hideMessage();
}

function say(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
  message.hidden = false;
  message.scrollIntoView({ block: "nearest" });
}

function hideMessage() {
  message.hidden = true;
}

function busy(on) {
  for (const b of document.querySelectorAll("button")) b.disabled = on;
}

function setMode(next) {
  mode = next;
  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === mode));
  }
  const signup = mode === "signup";
  $("#submit").textContent = signup ? "Create account" : "Sign in";
  $("input[name=password]").autocomplete = signup ? "new-password" : "current-password";
  $("[data-signup]").hidden = !signup;
  // The email is kept across modes so a member who subscribed before
  // passwords existed can go straight to creating one for that address.
  $("input[name=password]").value = "";
  hideMessage();
}


function sanitizePath(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** Where Firebase's email links should send people back to. */
function actionCodeSettings() {
  const back = new URL(location.href);
  back.searchParams.set("mode", "signin");
  return { url: back.toString() };
}

const BAD_CREDENTIAL_CODES = new Set([
  "auth/user-not-found",
  "auth/wrong-password",
  "auth/invalid-credential",
]);

function describe(error) {
  switch (error?.code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "There's already an account with that email. Try signing in.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/requires-recent-login":
      return "Please sign out and back in, then try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null; // the person backed out; not an error
    case "auth/operation-not-allowed":
      return "That sign-in method isn't enabled yet.";
    case "auth/account-exists-with-different-credential":
      return "That email is already used with another sign-in method. Sign in that way instead.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups and try again.";
    case "functions/failed-precondition":
    case "functions/invalid-argument":
    case "functions/already-exists":
      return error.message;
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- after sign-in ---------------------------------------------------------

/** Continues with whatever the person came here to do. */
async function proceed(user) {
  if (!user.emailVerified) {
    $("#verify-email").textContent = user.email ?? "";
    show("verify");
    return;
  }
  if (intent === "account") return showAccount(user);
  // Someone back from the verification link still has sign-up choices
  // waiting here, so they get the check too.
  if ((freshSignIn || hasPending(user.uid)) && !(await ensureProfile(user))) return;
  return connectToSite(user);
}

/**
 * Applies what the person chose while signing up, then makes sure they
 * have a username, asking for one if not. Resolves true when the profile
 * is complete and the caller may carry on.
 */
async function ensureProfile(user) {
  show("loading");
  try {
    let { data } = await loadMember();
    const pending = takePending(user.uid);
    if (pending && !data.username) {
      try {
        ({ data } = await updateMember({
          username: pending.username,
          newsletters: pending.newsletter ? data.newsletters.map((n) => n.id) : [],
        }));
      } catch (error) {
        // Most likely the username was taken meanwhile; ask for another.
        showSetup(data, pending, describe(error));
        return false;
      }
    }
    if (data.username) return true;
    showSetup(data, pending);
    return false;
  } catch (error) {
    fail(error);
    return false;
  }
}

function showSetup(profile, pending, problem) {
  const form = $("#setup-form");
  form.username.value = pending?.username ?? "";
  renderNewsletters($("#setup-newsletters"), profile.newsletters, pending && {
    subscribed: () => pending.newsletter,
  });
  show("setup");
  if (problem) say(problem);
}

$("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.username.value.trim();
  if (!USERNAME_PATTERN.test(username)) {
    say(USERNAME_RULE);
    return;
  }
  busy(true);
  try {
    await updateMember({ username, newsletters: chosenNewsletters(form) });
    const user = auth.currentUser;
    if (intent === "account") await showAccount(user);
    else connectToSite(user);
  } catch (error) {
    say(describe(error) ?? "Could not save your username.");
  } finally {
    busy(false);
  }
});

function fail(error) {
  $("#error-detail").textContent = describe(error) ?? "Please try again.";
  show("error");
}

// ---- back to the site -----------------------------------------------------

function connectToSite() {
  // Served from the site itself, return to where the person came from;
  // otherwise the site's front page. The Firebase session already covers
  // the site, so there is nothing to hand off.
  location.replace(ON_SITE ? redirectTo : `${SITE}/`);
}

// ---- the account screen ---------------------------------------------------

const METHOD_NAMES = { "google.com": "Google", "apple.com": "Apple", password: "a password" };

function signInMethods(user) {
  const names = user.providerData.map((p) => METHOD_NAMES[p.providerId] ?? p.providerId);
  return names.length ? `Signs in with ${names.join(" and ")}` : "";
}

function hasPassword(user) {
  return user.providerData.some((p) => p.providerId === "password");
}

async function showAccount(user) {
  show("loading");
  try {
    const { data } = await loadMember();
    renderProfile(user, data);
    show("account");
  } catch (error) {
    fail(error);
  }
}

function renderProfile(user, profile) {
  $("#account-email").textContent = profile.email;
  $("#account-method").textContent = signInMethods(user);
  $("#profile-form").username.value = profile.username;
  renderNewsletters($("#newsletters"), profile.newsletters);
  renderPassword(user);
}

/**
 * Fills `box` with a checkbox per newsletter. `choice.subscribed(n)`
 * overrides the profile's own flag (used for sign-up choices).
 */
function renderNewsletters(box, newsletters, choice) {
  box.replaceChildren(box.querySelector("legend"));
  for (const n of newsletters) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "newsletter";
    input.value = n.id;
    input.checked = choice ? choice.subscribed(n) : n.subscribed;
    const text = document.createElement("span");
    text.append(n.name);
    if (n.description) {
      const detail = document.createElement("span");
      detail.className = "muted small";
      detail.textContent = n.description;
      text.append(detail);
    }
    label.append(input, text);
    box.append(label);
  }
  box.hidden = newsletters.length === 0;
}

/** The IDs of the newsletters ticked in `form`. */
function chosenNewsletters(form) {
  return [...form.querySelectorAll("input[name=newsletter]:checked")].map((i) => i.value);
}

function renderPassword(user) {
  const password = hasPassword(user);
  $("#password-section").hidden = !password;
  $("#no-password").hidden = password;
  if (!password) {
    const names = user.providerData.map((p) => METHOD_NAMES[p.providerId] ?? p.providerId);
    $("#no-password").textContent =
      `You sign in with ${names.join(" and ")}, so there's no password to manage here.`;
  }
}

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.username.value.trim();
  if (!USERNAME_PATTERN.test(username)) {
    say(USERNAME_RULE);
    return;
  }
  busy(true);
  try {
    const { data } = await updateMember({ username, newsletters: chosenNewsletters(form) });
    renderProfile(auth.currentUser, data);
    say("Saved.", true);
  } catch (error) {
    say(describe(error) ?? "Could not save your changes.");
  } finally {
    busy(false);
  }
});

$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const current = form.current.value;
  const next = form.next.value;
  if (!current || !next) {
    say("Enter your current password and a new one.");
    return;
  }
  if (next.length < 6) {
    say("New password must be at least 6 characters.");
    return;
  }
  const user = auth.currentUser;
  busy(true);
  try {
    // Firebase insists on a recent sign-in before a password change; proving
    // the current password is the cleanest way to give it one.
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    await updatePassword(user, next);
    form.reset();
    say("Password changed. Other devices will need to sign in again.", true);
  } catch (error) {
    if (BAD_CREDENTIAL_CODES.has(error?.code)) say("Current password is incorrect.");
    else say(describe(error) ?? "Could not change your password.");
  } finally {
    busy(false);
  }
});

$("#reset-password").addEventListener("click", async () => {
  const email = auth.currentUser?.email;
  busy(true);
  try {
    await sendPasswordResetEmail(auth, email, actionCodeSettings());
    say(`Password reset email sent to ${email}.`, true);
  } catch (error) {
    say(describe(error) ?? "Could not send the email.");
  } finally {
    busy(false);
  }
});

$("#go-site").addEventListener("click", () => connectToSite());

$("#signout-account").addEventListener("click", async () => {
  handled = false;
  await signOut(auth);
  location.replace(ON_SITE ? "/" : `${SITE}/`);
});

// ---- events ---------------------------------------------------------------

for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.addEventListener("click", () => setMode(tab.dataset.tab));
}

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) {
    say("Enter your email and password.");
    return;
  }
  const username = form.username.value.trim();
  if (mode === "signup" && !USERNAME_PATTERN.test(username)) {
    say(USERNAME_RULE);
    return;
  }
  busy(true);
  try {
    freshSignIn = true;
    if (mode === "signup") {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      savePending(user.uid, { username, newsletter: form.newsletter.checked });
      await sendEmailVerification(user, actionCodeSettings());
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    // onAuthStateChanged takes it from here.
  } catch (error) {
    const text = describe(error);
    if (text) say(text);
  } finally {
    busy(false);
  }
});


$("#forgot").addEventListener("click", async () => {
  const email = $("input[name=email]").value.trim();
  if (!email) {
    say("Enter your email above first.");
    return;
  }
  busy(true);
  try {
    await sendPasswordResetEmail(auth, email, actionCodeSettings());
    say(`Password reset email sent to ${email}.`, true);
  } catch (error) {
    say(describe(error) ?? "Could not send the email.");
  } finally {
    busy(false);
  }
});

async function signInWith(provider) {
  busy(true);
  try {
    freshSignIn = true;
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
  // Requires the Apple provider in Firebase to have a Services ID configured
  // (see docs/firebase.md); without it Apple returns an invalid_client error.
  // Only the email is asked for: names are not kept.
  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");
  return signInWith(apple);
});

$("#verified").addEventListener("click", async () => {
  busy(true);
  try {
    await auth.currentUser?.reload();
    // Force a fresh ID token so the function sees email_verified=true.
    await auth.currentUser?.getIdToken(true);
    if (auth.currentUser?.emailVerified) {
      await proceed(auth.currentUser);
    } else {
      say("Not verified yet. Open the link in the email, then try again.");
    }
  } finally {
    busy(false);
  }
});

$("#resend").addEventListener("click", async () => {
  busy(true);
  try {
    await sendEmailVerification(auth.currentUser, actionCodeSettings());
    say("Verification email sent again.", true);
  } catch (error) {
    say(describe(error) ?? "Could not send the email.");
  } finally {
    busy(false);
  }
});

$("#retry").addEventListener("click", () => {
  if (auth.currentUser) proceed(auth.currentUser);
  else show("auth");
});

for (const id of ["#signout-verify", "#signout-setup", "#signout-error"]) {
  $(id).addEventListener("click", async () => {
    handled = false;
    await signOut(auth);
    show("auth");
  });
}

// ---- start ----------------------------------------------------------------

$("#site-link").href = ON_SITE ? redirectTo : `${SITE}/`;
$("#back-link").href = ON_SITE ? redirectTo : `${SITE}/`;
$("#home-link").href = ON_SITE ? "/" : `${SITE}/`;
setMode(mode);

onAuthStateChanged(auth, (user) => {
  if (!user) {
    handled = false;
    show("auth");
    return;
  }
  if (handled) return;
  handled = true;
  proceed(user);
});
