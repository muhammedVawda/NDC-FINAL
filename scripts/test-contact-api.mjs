/*
  Tests the callback endpoint's handler directly (netlify/functions/contact.js,
  which api/contact.js wraps for Vercel). fetch is mocked, so NOTHING is ever
  sent to Resend or a webhook and no real enquiry is created.

  Run:  node scripts/test-contact-api.mjs
*/
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function check(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// Each call uses its own client IP so the in-memory rate limiter never interferes.
let ipCounter = 0;
async function call(body, { method = "POST", env = {} } = {}) {
  const saved = {};
  const keys = ["RESEND_API_KEY", "CONTACT_TO_EMAIL", "CONTACT_FROM_EMAIL", "CONTACT_WEBHOOK_URL"];
  keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  delete require.cache[require.resolve("../netlify/functions/contact.js")];
  const { handler } = require("../netlify/functions/contact.js");
  const res = await handler({
    httpMethod: method,
    headers: { "x-forwarded-for": `203.0.113.${++ipCounter}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {}, sent };
}

const EMAIL_ENV = { RESEND_API_KEY: "test-key", CONTACT_TO_EMAIL: "marketing@ndcsa.co.za", CONTACT_FROM_EMAIL: "noreply@ndcsa.co.za" };
const good = () => ({
  name: "Thabo Mokoena",
  phone: "082 123 4567",
  consent: true,
  callbackTime: "08:00–10:00",
  formShownAt: Date.now() - 10000,
});

// method + body handling
check((await call({}, { method: "GET", env: EMAIL_ENV })).status, 405, "GET is refused");
check((await call("{not json", { env: EMAIL_ENV })).status, 400, "malformed JSON is a 400");

// validation
let r = await call({ ...good(), name: "" }, { env: EMAIL_ENV });
check([r.status, r.json.success], [422, false], "missing name rejected");
r = await call({ ...good(), phone: "12345" }, { env: EMAIL_ENV });
check(r.status, 422, "bad phone rejected");
check(/valid South African number/.test(r.json.message), true, "phone error says how to fix it");
r = await call({ ...good(), consent: false }, { env: EMAIL_ENV });
check([r.status, /Consent/.test(r.json.message)], [422, true], "consent is mandatory");
r = await call({ ...good(), callbackTime: "whenever" }, { env: EMAIL_ENV });
check(r.status, 422, "time outside the list rejected");
r = await call({ ...good(), language: "Klingon" }, { env: EMAIL_ENV });
check(r.status, 422, "language outside the list rejected");
r = await call({ ...good(), email: "not-an-email" }, { env: EMAIL_ENV });
check(r.status, 422, "bad optional email rejected");

// spam controls
r = await call({ ...good(), honeypot: "http://spam.example" }, { env: EMAIL_ENV });
check([r.status, r.json.success, r.sent.length], [200, true, 0], "honeypot: quiet 200, nothing forwarded");
r = await call({ ...good(), formShownAt: Date.now() - 500 }, { env: EMAIL_ENV });
check([r.status, r.json.success, r.sent.length], [429, false, 0], "faster than 2 s: friendly retry, nothing forwarded");
r = await call({ ...good(), formShownAt: undefined }, { env: EMAIL_ENV });
check([r.status, r.sent.length], [200, 1], "no timestamp (older cached page) still delivers");

// not configured: honest failure, never a false success
r = await call(good(), { env: {} });
check([r.status, r.json.success], [503, false], "nothing configured -> 503, not a fake success");

// email delivery, with language and time carried through to the message
r = await call({ ...good(), language: "isiZulu", message: "Please call after work" }, { env: EMAIL_ENV });
check([r.status, r.json.success, r.sent.length], [200, true, 1], "valid request is forwarded once");
const mail = r.sent[0].body;
check(r.sent[0].url, "https://api.resend.com/emails", "goes to the email provider");
check(mail.to, "marketing@ndcsa.co.za", "addressed to marketing@ndcsa.co.za");
check(/Preferred language: isiZulu/.test(mail.text), true, "language reaches the email (it used to be dropped)");
check(/Preferred callback time: 08:00–10:00/.test(mail.text), true, "best time reaches the email");
check(/Name: Thabo Mokoena/.test(mail.text) && /Phone: 082 123 4567/.test(mail.text), true, "name and phone reach the email");

// webhook route
r = await call(good(), { env: { CONTACT_WEBHOOK_URL: "https://hooks.example/lead" } });
check([r.status, r.sent[0] && r.sent[0].url], [200, "https://hooks.example/lead"], "webhook delivery works");

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
