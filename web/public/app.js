// Pizza Predator account page.
//
// Signs people in with Firebase Auth (the same user base as the app), then
// asks the ghostSignInUrl Cloud Function for a one-time Ghost sign-in URL and
// sends the browser there, so they land on the website as a member.
//
// Query parameters:
//   mode=signin|signup   which tab to open first (default signin)
//   r=/some/path/        path on the site to land on afterwards

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const SITE = "https://www.pizzapredator.com";
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
const ghostSignInUrl = httpsCallable(functions, "ghostSignInUrl");

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
  $("#submit").textContent = mode === "signup" ? "Create account" : "Sign in";
  $("input[name=password]").autocomplete = mode === "signup" ? "new-password" : "current-password";
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

// ---- the hand-off to Ghost -------------------------------------------------

async function connectToSite(user) {
  if (!user.emailVerified) {
    $("#verify-email").textContent = user.email ?? "";
    show("verify");
    return;
  }
  show("connecting");
  try {
    const { data } = await ghostSignInUrl({ redirectTo });
    location.replace(data.url);
  } catch (error) {
    $("#error-detail").textContent = describe(error) ?? "Please try again.";
    show("error");
  }
}

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
      await connectToSite(auth.currentUser);
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
  if (auth.currentUser) connectToSite(auth.currentUser);
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

$("#site-link").href = SITE + redirectTo;
setMode(mode);

onAuthStateChanged(auth, (user) => {
  if (!user) {
    handled = false;
    show("auth");
    return;
  }
  if (handled) return;
  handled = true;
  connectToSite(user);
});
