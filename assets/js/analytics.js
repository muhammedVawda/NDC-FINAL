/*
  Minimal, privacy-safe event tracking.

  AWAITING SETUP: no analytics provider is connected yet. This file defines
  a small `window.ndcTrack(eventName, meta)` abstraction that the rest of
  the site calls into (see calculator.js, contact-form.js). Right now it
  only keeps an in-memory/console record so behaviour can be verified
  during development; wire up a real provider (Plausible, GA4, etc.) inside
  `send()` once credentials/config are available, without changing any of
  the call sites.

  RULES FOR ANYONE ADDING EVENTS HERE:
  - Never pass field values (names, phone numbers, amounts entered, etc.).
  - Event names + small enums/counts only (e.g. step numbers, a service
    category the user selected from a fixed list) — nothing free-text.
  - Never read this data from the URL querystring into a provider that logs
    full URLs; keep tracked params out of the address bar where possible.
*/
(function () {
  "use strict";

  window.ndcDataLayer = window.ndcDataLayer || [];

  function send(eventName, meta) {
    var safeMeta = meta || {};
    var record = { event: eventName, meta: safeMeta, at: new Date().toISOString() };
    window.ndcDataLayer.push(record);

    // No provider configured yet — see file header. Intentionally a no-op
    // beyond the in-memory record above until CONTACT_WEBHOOK-style config
    // exists for analytics too.
  }

  window.ndcTrack = send;

  /*
    Contact-link events. A tap on the phone number or the email address
    is a real enquiry signal, so it is counted as one — with no personal
    data: the event carries the channel name only, never the href, never
    anything the visitor typed. Delegated once at document level so the
    footer, contact page, chat fallback and any future placement all
    count without wiring each one.
  */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (href.indexOf("tel:") === 0) send("phone_link_selected", {});
    else if (href.indexOf("mailto:") === 0) send("email_link_selected", {});
  }, { passive: true });
})();
