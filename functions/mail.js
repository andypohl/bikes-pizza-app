// Sends the submission notification over SMTP. The SMTP_URL secret looks
// like smtps://user%40example.com:app-password@smtp.example.com:465; the
// sender address is the URL's user name.

import nodemailer from "nodemailer";

export function isMailConfigured(smtpUrl) {
  return typeof smtpUrl === "string" && /^smtps?:\/\//.test(smtpUrl);
}

export function senderFrom(smtpUrl) {
  return decodeURIComponent(new URL(smtpUrl).username);
}

/**
 * @param {{smtpUrl: string, to: string, subject: string, text: string, replyTo?: string}} options
 * @param {(url: string) => {sendMail: Function}} [createTransport]
 */
export async function sendMail({ smtpUrl, to, subject, text, replyTo }, createTransport) {
  const transport = (createTransport ?? nodemailer.createTransport)(smtpUrl);
  await transport.sendMail({ from: senderFrom(smtpUrl), to, subject, text, replyTo });
}
