// Sends the submission notification through Mailgun's HTTP API
// (POST https://api.mailgun.net/v3/<domain>/messages with basic auth
// "api:<key>"). The API key is the MAILGUN_API_KEY secret; the sending
// domain and sender address are plain parameters.

const PLACEHOLDER = "unset"; // what the secret holds before it is configured

export function isMailConfigured({ apiKey, domain }) {
  return Boolean(apiKey && apiKey !== PLACEHOLDER && domain);
}

/**
 * @param {{apiKey: string, domain: string, apiBase?: string, from: string,
 *   to: string, subject: string, text: string, replyTo?: string}} message
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{id?: string, message?: string}>} Mailgun's response
 */
export async function sendMail(
  { apiKey, domain, apiBase = "https://api.mailgun.net", from, to, subject, text, replyTo },
  fetchImpl = globalThis.fetch,
) {
  const form = new URLSearchParams({ from, to, subject, text });
  if (replyTo) form.set("h:Reply-To", replyTo);
  const response = await fetchImpl(`${apiBase.replace(/\/+$/, "")}/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}` },
    body: form,
  });
  const text_ = await response.text();
  if (!response.ok) {
    throw new Error(`Mailgun ${response.status}: ${text_.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text_);
  } catch {
    return { message: text_ };
  }
}
