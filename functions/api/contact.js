import { contactTopics } from "../../src/data/contact-form.js";

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
const requiredSettings = ["CF_ACCOUNT_ID", "CF_EMAIL_API_TOKEN", "CONTACT_RECIPIENT", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"];

function reply(status, payload) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function configured(env) {
  return requiredSettings.every((key) => typeof env[key] === "string" && env[key].trim())
    && emailPattern.test(env.CONTACT_RECIPIENT);
}

async function readBody(request) {
  if (!request.body) throw new Error("empty");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new Error("large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validated(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const fields = {};
  for (const [key, max] of Object.entries({ name: 100, email: 254, phone: 50, message: 2000, topic: 100, token: 2048, website: 200 })) {
    const value = data[key] ?? "";
    if (typeof value !== "string" || value.length > max) return null;
    fields[key] = value.trim();
  }
  if (!fields.name || /[\r\n\x00-\x1f\x7f]/u.test(fields.name + fields.email + fields.phone)) return null;
  if (!emailPattern.test(fields.email) || fields.message.length < 10 || fields.message.includes("\0")) return null;
  if (!contactTopics.includes(fields.topic) || !fields.token || fields.website) return null;
  return fields;
}

export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return reply(200, { available: Boolean(configured(env)), siteKey: configured(env) ? env.TURNSTILE_SITE_KEY : null });
  }
  if (request.method !== "POST") return reply(405, { success: false, message: "Diese Anfrage wird nicht unterstützt." });
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin) return reply(403, { success: false, message: "Bitte verwenden Sie das Formular auf unserer Website." });
  if (!configured(env)) return reply(503, { success: false, message: "Das Formular kann gerade keine Nachrichten senden. Bitte schreiben Sie uns direkt per E-Mail." });
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return reply(415, { success: false, message: "Bitte verwenden Sie das Kontaktformular." });

  let input;
  try { input = await readBody(request); }
  catch (error) { return reply(error.message === "large" ? 413 : 400, { success: false, message: "Die Anfrage konnte nicht gelesen werden. Bitte überprüfen Sie Ihre Angaben." }); }
  const fields = validated(input);
  if (!fields) return reply(422, { success: false, message: "Bitte überprüfen Sie das Thema, Ihren Namen, Ihre E-Mail-Adresse und Ihre Nachricht." });

  try {
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: fields.token, remoteip: request.headers.get("CF-Connecting-IP") || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    if (!verification.ok) throw new Error("verification_unavailable");
    const challenge = await verification.json();
    if (!challenge.success || challenge.hostname !== url.hostname || challenge.action !== "contact") {
      return reply(422, { success: false, message: "Bitte bestätigen Sie den Spamschutz erneut und senden Sie Ihre Anfrage noch einmal." });
    }

    const recipient = env.CONTACT_RECIPIENT.trim();
    const delivery = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/email/sending/send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.CF_EMAIL_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.CONTACT_SENDER || "info@mediation-kg.com",
        to: recipient,
        reply_to: fields.email,
        subject: `Kontaktformular Mediation KG: ${fields.topic}`,
        text: `Thema: ${fields.topic}\nName: ${fields.name}\nE-Mail: ${fields.email}\nTelefon: ${fields.phone || "Nicht angegeben"}\n\nNachricht:\n${fields.message}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await delivery.json();
    const accepted = result.result?.delivered?.includes(recipient) || result.result?.queued?.includes(recipient);
    if (!delivery.ok || !result.success || !accepted || result.result?.permanent_bounces?.includes(recipient) || result.result?.suppressed_recipients?.includes(recipient)) {
      return reply(delivery.status === 429 ? 429 : 502, { success: false, message: "Ihre Nachricht konnte nicht übermittelt werden. Bitte versuchen Sie es später erneut oder schreiben Sie uns per E-Mail." });
    }
    return reply(200, { success: true });
  } catch {
    return reply(502, { success: false, message: "Die Verbindung zum Versand wurde unterbrochen. Bitte schreiben Sie uns direkt per E-Mail." });
  }
}
