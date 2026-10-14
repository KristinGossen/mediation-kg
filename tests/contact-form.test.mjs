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
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("test-secret visitor@example.org"); });
  const response = await onRequest({ request: request(), env });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(!body.includes("test-secret"));
  assert.ok(!body.includes(valid.email));
  assert.ok(!JSON.stringify(logs).includes("test-secret"));
  assert.ok(!JSON.stringify(logs).includes(valid.email));
});

test("free private service works without an API token and keeps recipients fixed", async (t) => {
  let mailed;
  const freeEnv = {
    CONTACT_RECIPIENT: env.CONTACT_RECIPIENT,
    TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
    CONTACT_MAILER: { async fetch(request) { mailed = await request.json(); return Response.json({ success: true }); } },
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(String(url).includes("siteverify"));
    return Response.json({ success: true, hostname: "mediation-kg.com", action: "contact" });
  });
  assert.deepEqual(await (await onRequest({ request: new Request("https://mediation-kg.com/api/contact"), env: freeEnv })).json(), { available: true, siteKey: env.TURNSTILE_SITE_KEY });
  assert.equal((await onRequest({ request: request({ ...valid, to: "attacker@example.org" }), env: freeEnv })).status, 200);
  assert.equal(mailed.to, env.CONTACT_RECIPIENT);
  assert.equal(mailed.reply_to, valid.email);
  assert.equal((await onRequest({ request: request(), env: { ...freeEnv, CONTACT_MAILER: undefined } })).status, 503);
});

test("private mailer failures and spam rejection never fall back to paid sending", async (t) => {
  let challenge = { success: true, hostname: "mediation-kg.com", action: "contact" };
  let status = 502;
  let calls = 0;
  const freeEnv = { ...env, CONTACT_MAILER: { async fetch() { calls++; return Response.json({ success: false }, { status }); } } };
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(String(url).includes("siteverify"));
    return Response.json(challenge);
  });
  assert.equal((await onRequest({ request: request(), env: freeEnv })).status, 502);
  status = 429;
  assert.equal((await onRequest({ request: request(), env: freeEnv })).status, 429);
  challenge = { success: false };
  assert.equal((await onRequest({ request: request(), env: freeEnv })).status, 422);
  assert.equal(calls, 2);
});

test("Turnstile HTTP 400 rejects invalid tokens normally and identifies configuration failures safely", async (t) => {
  const logs = [];
  let code = "invalid-input-response";
  t.mock.method(console, "error", (...args) => logs.push(args));
  t.mock.method(globalThis, "fetch", async url => {
    assert.ok(String(url).includes("siteverify"));
    return Response.json({ success: false, "error-codes": [code] }, { status: 400 });
  });
  assert.equal((await onRequest({ request: request(), env })).status, 422);
  assert.equal(logs.length, 0);
  code = "invalid-input-secret";
  const response = await onRequest({ request: request(), env });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(env.TURNSTILE_SECRET_KEY));
  assert.deepEqual(logs, [["contact_verification_configuration_failure"]]);
});
