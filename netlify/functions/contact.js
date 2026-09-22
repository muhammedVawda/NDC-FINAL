/*
  Server-side handler for the callback / enquiry form.

  AWAITING SETUP: this function only forwards a lead once real destination
  credentials are configured via environment variables (see README.md).
  Until then it responds honestly with "not configured" rather than
  pretending to have delivered the enquiry — never remove that guard to
  "make the form work", because that would fake a successful submission.

  Required environment variables (set at least one destination):
    - CONTACT_WEBHOOK_URL   A URL (CRM, Zapier, Make, Slack, etc.) that
                            accepts a JSON POST of the lead payload.
    - RESEND_API_KEY + CONTACT_TO_EMAIL + CONTACT_FROM_EMAIL
                            Sends the lead by email via the Resend API
                            (https://resend.com). Swap for your own email
                            provider if preferred — the shape is simple.

  Optional:
    - CONTACT_RATE_LIMIT_MAX (default 5)   Max submissions per IP per window.
    - CONTACT_RATE_LIMIT_WINDOW_MS (default 600000 = 10 minutes)

  NOTE ON RATE LIMITING: serverless functions are stateless between cold
  starts, so the in-memory store below only limits abuse within a single
  warm instance. For real protection in production, back this with a
  shared store (Netlify Blobs, Upstash Redis, etc.) or put the form behind
  a provider like Cloudflare Turnstile / Netlify's built-in form spam
  filtering.
*/

var rateLimitStore = new Map();

function isValidSAPhone(raw) {
  var digits = String(raw || "").replace(/[\s\-()]/g, "");
  return (
    /^\+27[1-9][0-9]{8}$/.test(digits) ||
    /^27[1-9][0-9]{8}$/.test(digits) ||
    /^0[1-9][0-9]{8}$/.test(digits)
  );
}

function isRateLimited(ip) {
  var max = parseInt(process.env.CONTACT_RATE_LIMIT_MAX || "5", 10);
  var windowMs = parseInt(process.env.CONTACT_RATE_LIMIT_WINDOW_MS || "600000", 10);
  var now = Date.now();
  var entry = rateLimitStore.get(ip) || [];
  entry = entry.filter(function (t) { return now - t < windowMs; });
  entry.push(now);
  rateLimitStore.set(ip, entry);
  return entry.length > max;
}

function validatePayload(data) {
  var errors = [];
  if (!data || typeof data !== "object") return ["Invalid request body."];
  if (!data.name || !String(data.name).trim()) errors.push("Name is required.");
  if (!isValidSAPhone(data.phone)) errors.push("A valid South African contact number is required.");
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("Email address is invalid.");
  if (data.message && String(data.message).length > 2000) errors.push("Message is too long.");
  if (!data.consent) errors.push("Consent to be contacted is required.");
  return errors;
}

async function forwardToWebhook(payload) {
  var res = await fetch(process.env.CONTACT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Webhook forward failed with status " + res.status);
}

async function forwardToEmail(payload) {
  var res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL,
      to: process.env.CONTACT_TO_EMAIL,
      subject: "New callback request — National Debt Consultants website",
      text:
        "Name: " + payload.name + "\n" +
        "Phone: " + payload.phone + "\n" +
        "Email: " + (payload.email || "(not provided)") + "\n" +
        "Service interest: " + (payload.service || "(not specified)") + "\n" +
        "Preferred callback time: " + (payload.callbackTime || "(no preference)") + "\n" +
        "Preferred language: " + (payload.language || "(no preference)") + "\n" +
        "Message: " + (payload.message || "(none)") + "\n" +
        "Marketing opt-in: " + (payload.marketing ? "yes" : "no") + "\n" +
        "Page reference: " + (payload.pageRef || "(none)") + "\n" +
        "Submitted: " + payload.submittedAt,
    }),
  });
  if (!res.ok) throw new Error("Resend email forward failed with status " + res.status);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: "Method not allowed." }) };
  }

  var ip =
    (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"])) ||
    "unknown";
  if (isRateLimited(ip)) {
    return {
      statusCode: 429,
      body: JSON.stringify({ success: false, message: "Too many requests. Please wait a few minutes and try again." }),
    };
  }

  var data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: "Invalid request." }) };
  }

  // Honeypot: bots that fill hidden fields get a quiet 200 without processing.
  if (data.honeypot) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  var errors = validatePayload(data);
  if (errors.length) {
    return { statusCode: 422, body: JSON.stringify({ success: false, message: errors.join(" ") }) };
  }

  var hasWebhook = !!process.env.CONTACT_WEBHOOK_URL;
  var hasEmail = !!(process.env.RESEND_API_KEY && process.env.CONTACT_TO_EMAIL && process.env.CONTACT_FROM_EMAIL);

  if (!hasWebhook && !hasEmail) {
    // Honest failure — do NOT report success when nothing is configured.
    return {
      statusCode: 503,
      body: JSON.stringify({
        success: false,
        message: "Our online enquiry service isn't fully set up yet. Please try again shortly.",
      }),
    };
  }

  var payload = {
    name: String(data.name).trim(),
    phone: String(data.phone).trim(),
    email: data.email ? String(data.email).trim() : "",
    service: data.service ? String(data.service).trim() : "",
    callbackTime: data.callbackTime ? String(data.callbackTime).trim() : "",
    message: data.message ? String(data.message).trim().slice(0, 2000) : "",
    marketing: !!data.marketing,
    pageRef: data.pageRef ? String(data.pageRef).slice(0, 120) : "",
    submittedAt: new Date().toISOString(),
  };

  try {
    if (hasWebhook) await forwardToWebhook(payload);
    else await forwardToEmail(payload);
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({
        success: false,
        message: "We couldn't send your request right now. Please try again shortly.",
      }),
    };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
