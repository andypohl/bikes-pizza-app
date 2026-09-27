// Email to the people who run the site: new submissions, reported
// concerns, new members. It goes to every administrator of the project
// (the accounts with the `admin` claim, so each environment tells its own
// administrators) and to any extra addresses from the configuration. Pure:
// the Firebase Auth admin API and the mail sender are injected.

const PROVIDER_LABELS = { password: "Email", "google.com": "Google", "apple.com": "Apple" };

/** The addresses in a comma-separated setting. */
export function parseAddresses(value) {
  return String(value ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

/** The addresses of the accounts that are administrators and can be written to. */
export async function adminEmails(auth) {
  const emails = [];
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const user of result.users) {
      if (user.customClaims?.admin === true && user.email && user.emailVerified && !user.disabled) {
        emails.push(user.email);
      }
    }
    pageToken = result.pageToken;
  } while (pageToken);
  return emails;
}

/**
 * Who a notice goes to: the administrators, then the extra addresses, each
 * once. When the accounts cannot be listed the extra addresses still get it.
 *
 * @param {{auth: {listUsers: Function}, extra?: string, log?: (message: string, data?: object) => void}} deps
 * @returns {Promise<string[]>}
 */
export async function adminRecipients({ auth, extra = "", log = () => {} }) {
  let admins = [];
  try {
    admins = await adminEmails(auth);
  } catch (error) {
    log("administrators could not be listed", { message: error.message });
  }
  const seen = new Set();
  return [...admins, ...parseAddresses(extra)].filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Sends one message to each recipient separately, so an address that
 * bounces does not keep the notice from the others.
 *
 * @param {string[]} recipients
 * @param {{subject: string, text: string, html?: string, replyTo?: string}} message
 * @param {(message: object) => Promise<unknown>} send
 * @returns {Promise<{sent: number, failures: string[]}>} failures are the error messages
 */
export async function sendToAll(recipients, message, send) {
  const results = await Promise.allSettled(recipients.map((to) => send({ to, ...message })));
  const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message ?? String(r.reason));
  return { sent: results.length - failures.length, failures };
}

/** The administration site of a website: `https://bikes.pizza` → `https://admin.bikes.pizza/`. */
export function adminUrlFor(siteUrl) {
  return `https://admin.${new URL(siteUrl).hostname.replace(/^www\./, "")}/`;
}

/** The notice about a new member. `provider` is the token's sign-in provider. */
export function signupEmail({ email, provider, joinedAt, adminUrl }) {
  const lines = [
    `${email} joined bikes.pizza.`,
    "",
    `Signed up with: ${PROVIDER_LABELS[provider] ?? provider ?? "unknown"}`,
    joinedAt ? `Joined: ${joinedAt}` : "",
    "",
    `Manage users: ${adminUrl}`,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
  return { subject: `New member: ${email}`, text: lines.join("\n") };
}
