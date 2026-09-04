// bikes.pizza account page.
//
// Signs people in with Firebase Auth (the same user base as the app), then
// either sends them on to the website (the Firebase session covers it) or
// (mode=account) shows their account: name, newsletters and password.
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

// ---- view helpers ---------------------------------------------------------

function show(view) {
  app.dataset.state = view;
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
      return error.message;
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- after sign-in ---------------------------------------------------------

/** Continues with whatever the person came here to do. */
function proceed(user) {
  if (!user.emailVerified) {
    $("#verify-email").textContent = user.email ?? "";
    show("verify");
    return;
  }
  if (intent === "account") return showAccount(user);
  return connectToSite(user);
}

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
  $("#profile-form").name.value = profile.name;

  const box = $("#newsletters");
  box.replaceChildren(box.querySelector("legend"));
  for (const n of profile.newsletters) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "newsletter";
    input.value = n.id;
    input.checked = n.subscribed;
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
  box.hidden = profile.newsletters.length === 0;

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
  const newsletters = [...form.querySelectorAll("input[name=newsletter]:checked")].map((i) => i.value);
  busy(true);
  try {
    const { data } = await updateMember({ name: form.name.value, newsletters });
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
  busy(true);
  try {
    if (mode === "signup") {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
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
  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");
  apple.addScope("name");
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

for (const id of ["#signout-verify", "#signout-error"]) {
  $(id).addEventListener("click", async () => {
    handled = false;
    await signOut(auth);
    show("auth");
  });
}

// ---- start ----------------------------------------------------------------

$("#site-link").href = ON_SITE ? redirectTo : `${SITE}/`;
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
