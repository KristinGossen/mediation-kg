import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/contact.js";

const env = {
  CF_ACCOUNT_ID: "account-id",
  CF_EMAIL_API_TOKEN: "test-secret",
  CONTACT_RECIPIENT: "owner@example.org",
  TURNSTILE_SITE_KEY: "test-site-key",
  TURNSTILE_SECRET_KEY: "captcha-secret",
};
const valid = { topic: "Privatmediation", name: "Testperson", email: "visitor@example.org", phone: "", message: "Ich möchte ein Erstgespräch vereinbaren.", token: "test-token", website: "" };
const request = (data = valid, overrides = {}) => new Request("https://mediation-kg.com/api/contact", {
  method: "POST",
  headers: { Origin: "https://mediation-kg.com", "Content-Type": "application/json", ...overrides },
  body: JSON.stringify(data),
});

test("configuration is public only as availability and site key", async () => {
  const response = await onRequest({ request: new Request("https://mediation-kg.com/api/contact"), env });
  assert.deepEqual(await response.json(), { available: true, siteKey: "test-site-key" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const unavailable = await onRequest({ request: new Request("https://mediation-kg.com/api/contact"), env: {} });
  assert.deepEqual(await unavailable.json(), { available: false, siteKey: null });
});

test("requests cannot send mail without configuration or from another origin", async () => {
  assert.equal((await onRequest({ request: request(), env: {} })).status, 503);
  assert.equal((await onRequest({ request: request(valid, { Origin: "https://other.example" }), env })).status, 403);
  assert.equal((await onRequest({ request: request(valid, { "Content-Type": "text/plain" }), env })).status, 415);
});

test("invalid fields, header injection, unknown topics and honeypot are rejected before contacting services", async () => {
  for (const change of [
    { email: "invalid" }, { name: "" }, { name: "a\r\nBcc: attacker@example.org" },
    { message: "short" }, { message: "x".repeat(2001) }, { topic: "Injected subject" },
    { website: "spam.example" }, { token: "" }, { name: { value: "test" } },
  ]) {
    assert.equal((await onRequest({ request: request({ ...valid, ...change }), env })).status, 422);
  }
  assert.equal((await onRequest({ request: request({ message: "x".repeat(17000) }), env })).status, 413);
});

test("verified requests deliver only to the configured recipient with the visitor as reply-to", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes("siteverify")) return Response.json({ success: true, hostname: "mediation-kg.com", action: "contact" });
    return Response.json({ success: true, result: { delivered: [env.CONTACT_RECIPIENT], queued: [], permanent_bounces: [] } });
  });
  const response = await onRequest({ request: request({ ...valid, to: "attacker@example.org", phone: "+49 123" }), env });
  assert.deepEqual(await response.json(), { success: true });
  const mail = JSON.parse(calls[1].options.body);
  assert.equal(mail.to, env.CONTACT_RECIPIENT);
  assert.equal(mail.from, "info@mediation-kg.com");
  assert.equal(mail.reply_to, valid.email);
  assert.ok(mail.text.includes("Telefon: +49 123"));
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-secret");
});

test("invalid or replayed captcha and wrong hostname/action never send email", async (t) => {
  let answer;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(answer); });
  for (answer of [
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, hostname: "other.example", action: "contact" },
    { success: true, hostname: "mediation-kg.com", action: "login" },
  ]) assert.equal((await onRequest({ request: request(), env })).status, 422);
  assert.equal(calls, 3);
});

test("queued mail is accepted; bounces, suppression and provider failures never show success", async (t) => {
  let result;
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url) => String(url).includes("siteverify")
    ? Response.json({ success: true, hostname: "mediation-kg.com", action: "contact" })
    : Response.json(result, { status }));
  result = { success: true, result: { queued: [env.CONTACT_RECIPIENT] } };
  assert.equal((await onRequest({ request: request(), env })).status, 200);
  for (result of [
    { success: false }, { success: true, result: {} },
    { success: true, result: { queued: [env.CONTACT_RECIPIENT], permanent_bounces: [env.CONTACT_RECIPIENT] } },
    { success: true, result: { suppressed_recipients: [env.CONTACT_RECIPIENT] } },
  ]) assert.equal((await onRequest({ request: request(), env })).status, 502);
  status = 429;
  assert.equal((await onRequest({ request: request(), env })).status, 429);
});

test("network failures never expose credentials or visitor messages", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("test-secret visitor@example.org"); });
  const response = await onRequest({ request: request(), env });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(!body.includes("test-secret"));
  assert.ok(!body.includes(valid.email));
});
