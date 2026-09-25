// Sends the app's email through Cloudflare Email Service's REST API
// (POST https://api.cloudflare.com/client/v4/accounts/<account>/email/sending/send
// with a bearer token that has "Email Sending: Edit"). The token is the
// CLOUDFLARE_EMAIL_TOKEN secret; the account ID and the sender are plain
// parameters. The sender's domain must be onboarded to Email Sending in
// that account.

const PLACEHOLDER = "unset"; // what the secret holds before it is configured
const API_BASE = "https://api.cloudflare.com/client/v4";

export function isMailConfigured({ token, accountId }) {
  return Boolean(token && token !== PLACEHOLDER && accountId);
}

/** `Name <address>` or a bare address, as the API's address object. */
export function parseAddress(value) {
  const match = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(value);
  if (!match) return { address: value.trim() };
  const name = match[1].replace(/^"(.*)"$/, "$1").trim();
  return name ? { address: match[2], name } : { address: match[2] };
}

/**
 * @param {{token: string, accountId: string, from: string, to: string,
 *   subject: string, text: string, html?: string, replyTo?: string}} message
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{message_id?: string, delivered?: string[], queued?: string[],
 *   permanent_bounces?: string[]}>} the API's result
 */
export async function sendMail(
  { token, accountId, from, to, subject, text, html, replyTo },
  fetchImpl = globalThis.fetch,
) {
  const body = { from: parseAddress(from), to: parseAddress(to), subject, text };
  if (html) body.html = html;
  if (replyTo) body.reply_to = parseAddress(replyTo);
  const response = await fetchImpl(
    `${API_BASE}/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // not JSON; reported below
  }
  if (!response.ok || !parsed?.success) {
    const detail =
      parsed?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || raw.slice(0, 200);
    throw new Error(`Cloudflare Email ${response.status}: ${detail}`);
  }
  const bounced = parsed.result?.permanent_bounces ?? [];
  if (bounced.length) {
    throw new Error(`Cloudflare Email: permanent bounce for ${bounced.join(", ")}`);
  }
  return parsed.result;
}
