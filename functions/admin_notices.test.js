import assert from "node:assert/strict";
import { test } from "node:test";

import { adminEmails, adminRecipients, adminUrlFor, parseAddresses, sendToAll, signupEmail } from "./admin_notices.js";

function fakeAuth(users, pageSize = 1000) {
  return {
    async listUsers(max, token) {
      const size = Math.min(max, pageSize);
      const start = token ? Number(token) : 0;
      return { users: users.slice(start, start + size), pageToken: start + size < users.length ? String(start + size) : undefined };
    },
  };
}

const admin = (email, extra = {}) => ({ uid: email, email, emailVerified: true, customClaims: { admin: true }, ...extra });

test("parseAddresses reads a comma-separated setting", () => {
  assert.deepEqual(parseAddresses(" a@x.y, b@x.y ,,"), ["a@x.y", "b@x.y"]);
  assert.deepEqual(parseAddresses(""), []);
  assert.deepEqual(parseAddresses(undefined), []);
});

test("adminEmails lists the administrators that can be written to, across pages", async () => {
  const users = [
    admin("ada@x.y"),
    { uid: "m", email: "member@x.y", emailVerified: true },
    { uid: "o", email: "other@x.y", emailVerified: true, customClaims: { admin: false, editor: true } },
    admin("unverified@x.y", { emailVerified: false }),
    admin("disabled@x.y", { disabled: true }),
    admin(undefined),
    admin("bob@x.y"),
  ];
  assert.deepEqual(await adminEmails(fakeAuth(users, 2)), ["ada@x.y", "bob@x.y"]);
});

test("adminRecipients adds the configured addresses, each address once", async () => {
  const auth = fakeAuth([admin("ada@x.y"), admin("bob@x.y")]);
  assert.deepEqual(await adminRecipients({ auth, extra: "team@x.y, ADA@x.y" }), ["ada@x.y", "bob@x.y", "team@x.y"]);
  assert.deepEqual(await adminRecipients({ auth }), ["ada@x.y", "bob@x.y"]);
  assert.deepEqual(await adminRecipients({ auth: fakeAuth([]) }), []);
});

test("adminRecipients falls back to the configured addresses when the accounts cannot be listed", async () => {
  const logged = [];
  const auth = { listUsers: async () => { throw new Error("auth down"); } };
  const to = await adminRecipients({ auth, extra: "team@x.y", log: (message, data) => logged.push({ message, data }) });
  assert.deepEqual(to, ["team@x.y"]);
  assert.deepEqual(logged, [{ message: "administrators could not be listed", data: { message: "auth down" } }]);
});

test("sendToAll writes to each recipient separately and reports the failures", async () => {
  const sent = [];
  const send = async (message) => {
    if (message.to === "bad@x.y") throw new Error("permanent bounce");
    sent.push(message);
  };
  const out = await sendToAll(["ada@x.y", "bad@x.y", "bob@x.y"], { subject: "s", text: "t", replyTo: "r@x.y" }, send);
  assert.deepEqual(out, { sent: 2, failures: ["permanent bounce"] });
  assert.deepEqual(sent, [
    { to: "ada@x.y", subject: "s", text: "t", replyTo: "r@x.y" },
    { to: "bob@x.y", subject: "s", text: "t", replyTo: "r@x.y" },
  ]);
  assert.deepEqual(await sendToAll([], { subject: "s", text: "t" }, send), { sent: 0, failures: [] });
});

test("adminUrlFor names the administration site of the environment", () => {
  assert.equal(adminUrlFor("https://bikes.pizza"), "https://admin.bikes.pizza/");
  assert.equal(adminUrlFor("https://www.example.dev/"), "https://admin.example.dev/");
});

test("signupEmail says who joined and how", () => {
  const mail = signupEmail({ email: "new@x.y", provider: "password", joinedAt: "2026-01-02T03:04:05.000Z", adminUrl: "https://admin.x.y/" });
  assert.equal(mail.subject, "New member: new@x.y");
  assert.equal(
    mail.text,
    [
      "new@x.y joined bikes.pizza.",
      "",
      "Signed up with: Email",
      "Joined: 2026-01-02T03:04:05.000Z",
      "",
      "Manage users: https://admin.x.y/",
    ].join("\n"),
  );
  assert.match(signupEmail({ email: "g@x.y", provider: "google.com", adminUrl: "u" }).text, /Signed up with: Google\n\nManage users: u$/);
  assert.match(signupEmail({ email: "g@x.y", adminUrl: "u" }).text, /Signed up with: unknown/);
});
