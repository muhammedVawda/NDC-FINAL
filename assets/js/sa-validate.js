/*
  Shared validation for South African phone numbers and the callback form.

  ONE implementation, used in three places so they can never disagree:
    - the page callback forms (assets/js/contact-form.js)
    - the NDC Virtual Assistant's callback form (assets/js/chat.js)
    - the server (netlify/functions/contact.js, wrapped for Vercel in api/)
  and covered by scripts/test-validators.mjs.

  Loads as a plain script in the browser (window.NDCValidate) and as a
  CommonJS module in Node.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NDCValidate = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** "Best time to call" choices. Server rejects anything not on this list. */
  var CALLBACK_TIMES = [
    "As soon as possible",
    "08:00–10:00",
    "10:00–12:00",
    "12:00–14:00",
    "14:00–16:00",
    "16:00–18:00",
  ];

  var LANGUAGES = ["English", "isiZulu", "isiXhosa", "Afrikaans", "Sesotho", "Setswana", "Sepedi"];

  /** A real person cannot read the form, fill it in and submit in under this. */
  var MIN_SUBMIT_MS = 2000;

  var PHONE_HELP =
    "Please enter a valid South African number, for example 082 123 4567 or +27 82 123 4567.";

  /** Strip the separators people type: spaces, hyphens, dots, brackets. */
  function normalisePhone(raw) {
    return String(raw == null ? "" : raw).replace(/[\s\-(). ]/g, "");
  }

  /**
   * Valid forms:
   *   0 + 9 digits, first of which is 1-8   (e.g. 0821234567, 021 054 1141)
   *   +27 or 27 + 9 digits, first 1-8       (e.g. +27821234567, 27210541141)
   * Nothing else: no letters, no "+27 (0)", no 09x range.
   */
  function isValidSAPhone(raw) {
    var d = normalisePhone(raw);
    return /^0[1-8][0-9]{8}$/.test(d) || /^(?:\+27|27)[1-8][0-9]{8}$/.test(d);
  }

  function isValidCallbackTime(value) {
    return CALLBACK_TIMES.indexOf(String(value == null ? "" : value)) !== -1;
  }

  function isValidLanguage(value) {
    var v = String(value == null ? "" : value);
    return v === "" || LANGUAGES.indexOf(v) !== -1;
  }

  /** True when a submission arrived implausibly fast after the form was shown. */
  function submittedTooFast(shownAtMs, nowMs) {
    var shown = Number(shownAtMs);
    var now = Number(nowMs);
    if (!isFinite(shown) || !isFinite(now)) return false; // no timestamp: do not block
    return now - shown < MIN_SUBMIT_MS;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return {
    CALLBACK_TIMES: CALLBACK_TIMES,
    LANGUAGES: LANGUAGES,
    MIN_SUBMIT_MS: MIN_SUBMIT_MS,
    PHONE_HELP: PHONE_HELP,
    normalisePhone: normalisePhone,
    isValidSAPhone: isValidSAPhone,
    isValidCallbackTime: isValidCallbackTime,
    isValidLanguage: isValidLanguage,
    submittedTooFast: submittedTooFast,
    escapeHtml: escapeHtml,
  };
});
