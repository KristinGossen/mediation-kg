const addressPattern = /^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/u;
const sender = "info@mediation-kg.com";

function base64(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function encodedSubject(text) {
  const words = [];
  let chunk = "";
  for (const character of text) {
    if (new TextEncoder().encode(chunk + character).length > 36) {
      words.push(`=?UTF-8?B?${base64(chunk)}?=`);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(chunk)}?=`);
  return words.join("\r\n ");
}

function rawMessage(mail) {
  return [
    `From: ${sender}`,
    `To: ${mail.to}`,
    `Reply-To: ${mail.reply_to}`,
    `Subject: ${encodedSubject(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@mediation-kg.com>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(mail.text).match(/.{1,76}/gu).join("\r\n"),
    "",
  ].join("\r\n");
}

function reply(status, success) {
  return Response.json({ success }, { status, headers: { "Cache-Control": "no-store" } });
}

export function createMailer(EmailMessage) {
  return {
    async fetch(request, env) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/send") return reply(404, false);
      if (typeof env.MAIL?.send !== "function") return reply(503, false);
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) return reply(415, false);
      let mail;
      try {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 16384) return reply(413, false);
        mail = JSON.parse(text);
      } catch { return reply(400, false); }
      if (!mail || mail.from !== sender
        || typeof mail.to !== "string" || mail.to.length > 254 || !addressPattern.test(mail.to)
        || typeof mail.reply_to !== "string" || mail.reply_to.length > 254 || !addressPattern.test(mail.reply_to)
        || typeof mail.subject !== "string" || !mail.subject.startsWith("Kontaktformular Mediation KG: ")
        || mail.subject.length > 150 || /[\r\n\x00-\x1f\x7f]/u.test(mail.subject)
        || typeof mail.text !== "string" || !mail.text || mail.text.length > 4000 || mail.text.includes("\0")) {
        return reply(422, false);
      }
      try {
        // Legacy EmailMessage supports sending to Email Routing's verified addresses.
        // The binding itself restricts recipients to verified destinations in this account.
        await env.MAIL.send(new EmailMessage(sender, mail.to, rawMessage(mail)));
        return reply(200, true);
      } catch (error) {
        const message = typeof error?.message === "string" ? error.message : typeof error === "string" ? error : "";
        const code = ["E_RECIPIENT_NOT_ALLOWED", "E_SENDER_NOT_VERIFIED", "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_DELIVERY_FAILED", "E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR", "E_CONTENT_TOO_LARGE"].includes(error?.code) ? error.code : "unclassified";
        // Diagnostic categories only: provider text may contain private addresses.
        console.error("contact_mailer_failure", {
          code,
          recipient: /destination.*not.*verif|recipient.*not.*verif|not.*allowed|unverified.*destination|not.*verified.*address/iu.test(message),
          sender: /sender|sending.*domain|from.*domain|not.*enabled|not.*onboard/iu.test(message),
          format: /mime|header|rfc|message.*format|invalid.*message|malformed/iu.test(message),
          limit: /limit|quota|rate|too.*many/iu.test(message),
          rejected: /spam|blocked|suppress|reject/iu.test(message),
          runtime: /not defined|not a function|not supported/iu.test(message),
        });
        return reply(error?.code === "E_RATE_LIMIT_EXCEEDED" ? 429 : 502, false);
      }
    },
  };
}
