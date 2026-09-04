// Sends the submission notification over SMTP. The SMTP_URL secret looks
// like smtps://user%40example.com:password@smtp.example.com:465 (Gmail with
// an app password, Mailgun's SMTP credentials, etc.). The sender address
// defaults to the URL's user name; pass `from` to use another address the
// provider allows.

import nodemailer from "nodemailer";

export function isMailConfigured(smtpUrl) {
  return typeof smtpUrl === "string" && /^smtps?:\/\//.test(smtpUrl);
}

export function senderFrom(smtpUrl) {
  return decodeURIComponent(new URL(smtpUrl).username);
}

/**
 * @param {{smtpUrl: string, to: string, subject: string, text: string, replyTo?: string, from?: string}} options
 * @param {(url: string) => {sendMail: Function}} [createTransport]
 */
export async function sendMail({ smtpUrl, to, subject, text, replyTo, from }, createTransport) {
  const transport = (createTransport ?? nodemailer.createTransport)(smtpUrl);
  await transport.sendMail({ from: from || senderFrom(smtpUrl), to, subject, text, replyTo });
}
