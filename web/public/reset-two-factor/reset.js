// The page behind the link in the "Confirm resetting two-factor
// authentication" email (functions/second_factor_reset.js). An
// administrator asked for the reset; it happens only when the account's
// owner confirms here with the token from the link. Opening the page does
// nothing by itself, so mail scanners that follow links cannot trigger it.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const $ = (sel) => document.querySelector(sel);

function show(view) {
  $("#app").dataset.state = view;
  for (const section of document.querySelectorAll("[data-view]")) {
    section.hidden = section.dataset.view !== view;
  }
}

function say(text) {
  const message = $("#message");
  message.textContent = text;
  message.hidden = false;
}

// The token travels in the fragment, which browsers do not send to the
// server; it is taken out of the address bar once read.
const token = new URLSearchParams(location.hash.slice(1)).get("token");
history.replaceState(null, "", location.pathname);

$("#site-link").href = `${location.origin}/`;
$("#sign-in").addEventListener("click", () => location.assign("../?mode=account"));

if (!token) {
  show("invalid");
} else {
  // Firebase Hosting serves the project's web config at this reserved URL.
  const config = await fetch("/__/firebase/init.json").then((r) => r.json());
  const functions = getFunctions(initializeApp(config), "us-central1");
  const confirmReset = httpsCallable(functions, "confirmSecondFactorReset");

  $("#confirm").addEventListener("click", async () => {
    $("#confirm").disabled = true;
    $("#message").hidden = true;
    try {
      await confirmReset({ token });
      show("done");
    } catch (error) {
      if (error?.code === "functions/failed-precondition") {
        $("#invalid-detail").textContent = error.message;
        show("invalid");
      } else {
        say("Could not reach the server right now. Please try again.");
        $("#confirm").disabled = false;
      }
    }
  });
  show("confirm");
}
