// Cloud Functions for the PizzaPredator app.
//
// ghostSignInUrl: lets a Firebase-authenticated user open the Ghost site as a
// signed-in member without a magic-link email. The app calls it, then opens
// the returned URL in an in-app browser.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { GhostAdminClient, GhostApiError } from "./ghost.js";

// Set with `firebase functions:secrets:set GHOST_ADMIN_API_KEY`.
const ghostAdminApiKey = defineSecret("GHOST_ADMIN_API_KEY");
// Set in functions/.env (see .env.example); not a secret.
const ghostAdminApiUrl = defineString("GHOST_ADMIN_API_URL");

export const ghostSignInUrl = onCall(
  { region: "us-central1", secrets: [ghostAdminApiKey] },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

    const { email, email_verified: emailVerified, name } = auth.token;
    if (!email) {
      throw new HttpsError("failed-precondition", "Your account has no email address.");
    }
    // Without this check anyone could claim an existing member's email with a
    // password account and be signed in as them on the site.
    if (!emailVerified) {
      throw new HttpsError("failed-precondition", "Verify your email address first.");
    }

    const redirectTo =
      typeof request.data?.redirectTo === "string" ? request.data.redirectTo : undefined;

    const ghost = new GhostAdminClient({
      url: ghostAdminApiUrl.value(),
      key: ghostAdminApiKey.value(),
    });

    try {
      const member = await ghost.findOrCreateMember({ email, name });
      const url = await ghost.signInUrl(member.id, { redirectTo });
      logger.info("ghost sign-in url issued", { uid: auth.uid, created: member.created });
      return { url, created: member.created };
    } catch (error) {
      if (error instanceof GhostApiError && error.type === "ValidationError") {
        throw new HttpsError("invalid-argument", error.message);
      }
      logger.error("ghost sign-in failed", { uid: auth.uid, message: error.message });
      throw new HttpsError("unavailable", "Could not sign you in on the website right now.");
    }
  },
);
