import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMailer } from "../workers/contact-mailer/mailer.js";

class EmailMessage {
  constructor(from, to, raw) { Object.assign(this, { from, to, raw }); }
}
const worker = createMailer(EmailMessage);
const mail = { from: "info@mediation-kg.com", to: "owner@example.org", reply_to: "visitor@example.org", subject: "Kontaktformular Mediation KG: Wirtschaftsmediation", text: "Ich möchte ein Gespräch.\nViele Grüße, Testperson" };
function request(data = mail, options = {}) {
  return new Request("https://contact-mailer.internal/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), ...options });
}

test("mailer sends a plain UTF-8 message with safe folded subject and reply-to", async () => {
  let sent;
  const response = await worker.fetch(request(), { MAIL: { async send(message) { sent = message; } } });
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sent.from, mail.from);
  assert.equal(sent.to, mail.to);
  const [headers, body] = sent.raw.split("\r\n\r\n");
  assert.ok(headers.includes(`Reply-To: ${mail.reply_to}`));
  const subject = headers.match(/Subject: ([\s\S]*?)\r\nDate:/u)[1];
  const decoded = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/gu)].map((part) => Buffer.from(part[1], "base64").toString("utf8")).join("");
  assert.equal(decoded, mail.subject);
  assert.ok(subject.split("\r\n").every((line) => line.length < 75));
  assert.equal(Buffer.from(body.replace(/\s/gu, ""), "base64").toString("utf8"), mail.text);
});

test("mailer rejects altered sender, header injection and excessive content without sending", async () => {
  let count = 0;
  const env = { MAIL: { async send() { count++; } } };
  for (const change of [
    { from: "attacker@example.org" }, { to: "owner@example.org\r\nBcc: attacker@example.org" },
    { reply_to: "visitor@example.org\r\nX: test" }, { subject: "Kontaktformular Mediation KG: x\r\nBcc: x" },
    { subject: "Unrelated" }, { text: "x".repeat(4001) },
  ]) assert.equal((await worker.fetch(request({ ...mail, ...change }), env)).status, 422);
  assert.equal((await worker.fetch(request({ ...mail, text: "x".repeat(20000) }), env)).status, 413);
  assert.equal((await worker.fetch(request(mail, { headers: { "Content-Type": "text/plain" } }), env)).status, 415);
  assert.equal((await worker.fetch(new Request("https://contact-mailer.internal/send"), env)).status, 404);
  assert.equal(count, 0);
});

test("unverified recipients, provider failure or missing binding never report success or leak data", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  assert.equal((await worker.fetch(request(), {})).status, 503);
  for (const code of ["E_RECIPIENT_NOT_ALLOWED", "E_DELIVERY_FAILED", "E_RATE_LIMIT_EXCEEDED"]) {
    const response = await worker.fetch(request(), { MAIL: { async send() { throw Object.assign(new Error(mail.to), { code }); } } });
    assert.equal(response.status, code === "E_RATE_LIMIT_EXCEEDED" ? 429 : 502);
    assert.deepEqual(await response.json(), { success: false });
  }
  const diagnostics = JSON.stringify(logs);
  assert.ok(!diagnostics.includes(mail.to));
  assert.ok(!diagnostics.includes(mail.reply_to));
  assert.ok(!diagnostics.includes(mail.text));
});

test("deployment exposes no worker or preview URL and restricts sending to verified destinations", async () => {
  const config = JSON.parse(await readFile(new URL("../workers/contact-mailer/wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.send_email, [{ name: "MAIL" }]);
});
