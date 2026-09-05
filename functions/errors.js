// Errors shared by the callable and REST entry points. `code` uses the
// callable vocabulary (invalid-argument, not-found, ...); api.js maps it to
// HTTP statuses and index.js to HttpsError.

export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** A request whose data is malformed; becomes `invalid-argument`. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/** The user described by verified Firebase ID token claims, or throws. */
export function userFromClaims(claims) {
  if (!claims) throw new AppError("unauthenticated", "Sign in first.");
  const { uid, email, email_verified: emailVerified } = claims;
  if (!email) throw new AppError("failed-precondition", "Your account has no email address.");
  // Without this check anyone could claim an existing member's email with a
  // password account and act as them.
  if (!emailVerified) throw new AppError("failed-precondition", "Verify your email address first.");
  return { uid, email, admin: claims.admin === true };
}

/** The same user, who must also carry the `admin` custom claim. */
export function adminFromClaims(claims) {
  const user = userFromClaims(claims);
  if (!user.admin) throw new AppError("permission-denied", "Admins only.");
  return user;
}

/**
 * An admin whose ID token was minted after a second factor (Firebase sets
 * `firebase.sign_in_second_factor` on such tokens). The admin page requires
 * it; this keeps the API from being a way around that.
 */
export function secondFactorAdminFromClaims(claims) {
  const user = adminFromClaims(claims);
  if (!claims.firebase?.sign_in_second_factor) {
    throw new AppError("permission-denied", "Two-factor authentication is required for this.");
  }
  return user;
}
