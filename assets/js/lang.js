/*
  Language selector.

  HONEST BY DESIGN
  All 11 official South African languages are listed, but only those
  marked `status: "published"` in assets/data/languages.json are
  selectable. The rest show as "coming soon" rather than silently
  serving machine translation.

  That is a deliberate safety decision, not an oversight. This site
  explains legal protections, court processes and credit-record
  consequences. A mistranslation of "creditors are restricted from
  taking further legal action while you comply" could lead someone to
  act on a protection they do not have. Debt and legal terminology
  needs a human translator with domain experience before it goes live.

  To publish a language: translate assets/data/i18n/<code>.json, have
  it reviewed, set reviewedBy/reviewedDate and flip status to
  "published". The selector, hreflang tags and the assistant's language
  handling all read from that one registry.
*/
(function () {
  "use strict";

  var REGISTRY = "/assets/data/languages.json";
  var STORAGE_KEY = "ndc-lang";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build(data) {
    var mount = document.querySelector("[data-lang-mount]");
    if (!mount) return;

    var current = data.default;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var match = data.languages.filter(function (l) { return l.code === saved; })[0];
        if (match && match.status === "published") current = saved;
      }
    } catch (e) { /* storage blocked — fall back to default */ }

    var currentLang = data.languages.filter(function (l) { return l.code === current; })[0];

    var wrap = el("div", "lang-switch");
    var btn = el("button", "lang-switch__btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-haspopup", "true");
    btn.id = "lang-switch-btn";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>' +
      '<span class="lang-switch__label">' + currentLang.endonym + "</span>" +
      '<svg class="lang-switch__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

    var menu = el("div", "lang-menu");
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-labelledby", "lang-switch-btn");

    var published = data.languages.filter(function (l) { return l.status === "published"; });
    var pending = data.languages.filter(function (l) { return l.status !== "published"; });

    published.forEach(function (l) {
      var item = el("button", "lang-menu__item", l.endonym);
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute("lang", l.hreflang);
      if (l.code === current) item.setAttribute("aria-current", "true");
      item.addEventListener("click", function () {
        try { localStorage.setItem(STORAGE_KEY, l.code); } catch (e) {}
        if (window.ndcTrack) window.ndcTrack("language_selected", { language: l.code });
        close();
        if (l.urlPrefix && window.location.pathname.indexOf(l.urlPrefix + "/") !== 0) {
          window.location.pathname = l.urlPrefix + window.location.pathname;
        } else {
          window.location.reload();
        }
      });
      menu.appendChild(item);
    });

    if (pending.length) {
      var note = el("p", "lang-menu__note", "In progress — being professionally translated:");
      menu.appendChild(note);
      var list = el("div", "lang-menu__pending");
      pending.forEach(function (l) {
        var span = el("span", "lang-menu__pending-item", l.endonym);
        span.setAttribute("lang", l.hreflang);
        list.appendChild(span);
      });
      menu.appendChild(list);
      var why = el("p", "lang-menu__why",
        "We publish a language once a human translator has checked the debt and legal wording. We'd rather be late than give you a wrong answer about your rights.");
      menu.appendChild(why);
    }

    function open() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onOutside);
      document.addEventListener("keydown", onKey);
    }
    function close() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onOutside);
      document.removeEventListener("keydown", onKey);
    }
    function onOutside(e) { if (!wrap.contains(e.target)) close(); }
    function onKey(e) { if (e.key === "Escape") { close(); btn.focus(); } }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    mount.appendChild(wrap);
  }

  fetch(REGISTRY)
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function () { /* registry unavailable — selector simply doesn't render */ });
})();
