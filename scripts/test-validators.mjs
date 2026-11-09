/*
  Unit tests for assets/js/sa-validate.js, the one validator shared by the page
  forms, the assistant and the server.

  Run:  node scripts/test-validators.mjs
*/
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const V = require("../assets/js/sa-validate.js");

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

// ---- valid South African numbers -------------------------------------------
const valid = [
  "0821234567", "082 123 4567", "082-123-4567", "082.123.4567", "(082) 123 4567",
  "021 054 1141", "(021) 054 1141", "0210541141",
  "+27821234567", "+27 82 123 4567", "27821234567", "+27 21 054 1141",
  "0111234567", "0861234567", "0801234567", "  082 123 4567  ",
];
valid.forEach((n) => check(V.isValidSAPhone(n), true, `valid: "${n}"`));

// ---- invalid ---------------------------------------------------------------
const invalid = [
  "", "   ", null, undefined, "0", "12345",
  "082123456",        // 9 digits: one short
  "08212345678",      // 11 digits: one long
  "0921234567",       // 09x is not an allocated range
  "0021234567",       // 00 start
  "1821234567",       // no leading 0 or +27
  "+270821234567",    // +27 followed by a trunk 0
  "+27 (0)21 054 1141",
  "+2782123456",      // 8 digits after +27
  "+278212345678",    // 10 digits after +27
  "+28821234567",     // wrong country code
  "+27921234567",     // 9x after country code
  "abc", "082 123 456a", "0821234567 ext 5", "082 123 4567 890", "++27821234567",
];
invalid.forEach((n) => check(V.isValidSAPhone(n), false, `invalid: ${JSON.stringify(n)}`));

// ---- normalisation ---------------------------------------------------------
check(V.normalisePhone("(021) 054-1141"), "0210541141", "normalise strips brackets, spaces, hyphens");
check(V.normalisePhone("+27 82 123 4567"), "+27821234567", "normalise strips non-breaking spaces");
check(V.normalisePhone(null), "", "normalise tolerates null");

// ---- best time to call -----------------------------------------------------
["As soon as possible", "08:00–10:00", "10:00–12:00", "12:00–14:00", "14:00–16:00", "16:00–18:00"].forEach(
  (t) => check(V.isValidCallbackTime(t), true, `time ok: ${t}`)
);
["", "morning", "08:00-10:00" /* ASCII hyphen: not the listed value */, "18:00–20:00", null].forEach(
  (t) => check(V.isValidCallbackTime(t), false, `time rejected: ${JSON.stringify(t)}`)
);
check(V.CALLBACK_TIMES.length, 6, "exactly six time choices");

// ---- languages -------------------------------------------------------------
["", "English", "isiZulu", "isiXhosa", "Afrikaans", "Sesotho", "Setswana", "Sepedi"].forEach(
  (l) => check(V.isValidLanguage(l), true, `language ok: ${JSON.stringify(l)}`)
);
check(V.isValidLanguage("French"), false, "unlisted language rejected");

// ---- minimum-time check ----------------------------------------------------
check(V.submittedTooFast(1000, 2500), true, "1.5 s after display is too fast");
check(V.submittedTooFast(1000, 2999), true, "1.999 s is too fast");
check(V.submittedTooFast(1000, 3000), false, "exactly 2 s is allowed");
check(V.submittedTooFast(1000, 60000), false, "a minute is fine");
check(V.submittedTooFast(undefined, 5000), false, "no timestamp never blocks (older cached pages)");
check(V.submittedTooFast("abc", 5000), false, "garbage timestamp never blocks");

// ---- escaping --------------------------------------------------------------
check(V.escapeHtml(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;", "escapeHtml neutralises markup");

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
