// Sign in with Apple on Android: Apple has no native sheet there, so the
// app opens Apple's web sign-in in a browser tab (the sign_in_with_apple
// plugin), and Apple posts the outcome to a return URL on our API. All the
// endpoint does is bounce that outcome back into the app through an Android
// intent URL, which the plugin's callback activity receives.
//
// Nothing is checked here: the app signs into Firebase with the token Apple
// issued, and Firebase verifies the signature and the nonce the app chose.
// A forged link to the callback activity therefore cannot sign anyone in.
//
// The return URL (`https://<api host>/api/auth/apple/callback`) must be
// listed on the Services ID in the Apple Developer portal, with the host
// among its domains; see docs/firebase.md.

/** The Android app, as Google Play knows it. */
export const ANDROID_PACKAGE = "com.pizzapredator.bikes_pizza";

/** What Apple's form post may carry; anything else is dropped. */
const FORWARDED = ["code", "id_token", "state", "user", "error"];

/**
 * The intent URL that hands Apple's response to the app.
 *
 * Mirrors the sign_in_with_apple plugin's expectation:
 * `intent://callback?<params>#Intent;package=<app>;scheme=signinwithapple;end`.
 *
 * @param {Record<string, unknown>} body Apple's form fields.
 * @param {string} [androidPackage]
 */
export function appleCallbackRedirect(body, androidPackage = ANDROID_PACKAGE) {
  const params = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = body?.[key];
    if (typeof value === "string" && value !== "") params.set(key, value);
  }
  return `intent://callback?${params.toString()}#Intent;package=${androidPackage};scheme=signinwithapple;end`;
}
