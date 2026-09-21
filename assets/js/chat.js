/*
  NDC virtual assistant — guided, short-path version.

  WHAT THIS IS
  A four-option opening menu with a free-text box, and a callback form
  that asks for two things. Every path can reach a callback in one tap.

  WHAT CHANGED AND WHY
  The previous version opened with a three-sentence disclaimer, six
  suggestion chips and a bare text box, which asked the visitor to
  compose a question before anything useful happened. Most people
  arriving on a debt site want one of a very small number of things, so
  those are now buttons. The disclaimer still exists, but as a short
  header line and a footer note rather than as the first thing said.

  WHAT WAS DELIBERATELY KEPT
  - Retrieval, scoring, coverage gating and the NEVER_ANSWER list. These
    are the safety layer, not decoration. Free text still works, still
    refuses the categories it must refuse, and still cannot invent prose.
  - The document checklists, which are a genuine top task.
  - The existing /api/contact integration, unchanged. This widget adds no
    new backend and no new required field.

  GROUNDING RULE (unchanged)
  Factual content comes from knowledge.json, generated from the real
  site. Node copy in this file is navigational only — it describes what
  the visitor can do next, and makes no claim about rates, eligibility,
  timeframes or outcomes. The assistant never decides eligibility and
  never says a debt review can be removed.

  HONESTY RULE
  It identifies as a virtual assistant on open and in the header. There
  is no live-agent backend, so nothing here implies a person is waiting.
  It promises no response time, because none is confirmed.
*/
(function () {
  "use strict";

  var KB_URL = "/assets/data/knowledge.json";
  var LANG_URL = "/assets/data/languages.json";
  var API_URL = "/api/chat";
  var CONTACT_URL = "/api/contact";

  var MIN_SCORE = 1.2;
  var MIN_COVERAGE = 0.5;
  var MAX_INPUT = 500;

  /*
    Categories the assistant must never appear to answer: specific
    numbers, personal account facts, eligibility decisions, guarantees
    and system internals. Extractive mode retrieves by topic, not by
    intent, so without this a guarantee-seeking question can pull a
    topically-similar FAQ whose answer opens with "Yes." — read as a
    reply to "can you guarantee...", that single word is a promise this
    business must never make.
  */
  var NEVER_ANSWER = [
    /\b(interest|repo|prime)\s*rate\b/i,
    /\bwhat (is|are) (my|the current)\b.*\b(rate|balance|score|fee|amount|payment)\b/i,
    /\bmy (balance|credit score|credit record score|account balance|instal?ment amount)\b/i,
    /\bmy\b.{0,24}\b(balance|credit score)\b/i,
    /\bhow much (will|do|would|can) i\b/i,
    /\b(am i|do i) (approved|qualify for a loan)\b/i,
    /\b(system prompt|api key|instructions you|your instructions|internal config|other users)\b/i,
    /\b(guarantee|guaranteed|promise|100%|definitely)\b/i,
    /\bwill (you|ndc) (remove|clear|cancel|erase)\b/i,
    /\bcan you (remove|clear|cancel|erase|guarantee)\b/i
  ];

  var STOPWORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, is: 1, are: 1, was: 1, were: 1, to: 1, of: 1, in: 1,
    for: 1, on: 1, with: 1, my: 1, i: 1, me: 1, you: 1, your: 1, it: 1, that: 1, this: 1,
    do: 1, does: 1, can: 1, what: 1, how: 1, if: 1, be: 1, have: 1, has: 1, will: 1, would: 1,
    about: 1, at: 1, as: 1, but: 1, from: 1, by: 1, so: 1, we: 1, they: 1, there: 1,
    create: 1, make: 1, tell: 1, explain: 1, want: 1, need: 1, should: 1, could: 1,
    please: 1, get: 1, got: 1, know: 1, help: 1, any: 1, some: 1, more: 1, when: 1, who: 1
  };

  var kb = null, kbLoading = null, langs = null;
  var panel, log, form, input, launcher, sendBtn, actionBar, backBtn, restartBtn;

  // Node the visitor is on, and the trail behind it for "Back".
  var currentNode = null;
  var trail = [];
  // A typed question we could not answer is carried into the callback so
  // the consultant sees what was actually asked, rather than the visitor
  // having to repeat it.
  var pendingQuestion = null;
  // Retained across a failed submit so nobody retypes their details.
  var draft = { name: "", phone: "", time: "", lang: "" };

  // ---- retrieval (unchanged safety layer) ------------------------------

  function tokenize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function (t) { return t.length > 2 && !STOPWORDS[t]; });
  }

  function loadKB() {
    if (kb) return Promise.resolve(kb);
    if (kbLoading) return kbLoading;
    kbLoading = fetch(KB_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        kb = data;
        var df = {};
        kb.entries.forEach(function (e) {
          var seen = {};
          tokenize(e.title + " " + e.text).forEach(function (t) {
            if (!seen[t]) { df[t] = (df[t] || 0) + 1; seen[t] = 1; }
          });
          e._tokens = tokenize(e.title + " " + e.text);
        });
        kb._df = df;
        return kb;
      });
    return kbLoading;
  }

  function retrieve(query, k) {
    if (!kb) return [];
    var qTokens = tokenize(query);
    if (!qTokens.length) return [];
    var N = kb.entries.length;
    var scored = kb.entries.map(function (e) {
      var score = 0, matched = 0;
      var titleTokens = tokenize(e.title);
      qTokens.forEach(function (t) {
        var df = kb._df[t] || N;
        var idf = Math.log(1 + N / df);
        if (e._tokens.indexOf(t) !== -1) { score += idf; matched++; }
        if (titleTokens.indexOf(t) !== -1) score += idf * 1.5;
      });
      return { entry: e, score: score, coverage: matched / qTokens.length };
    });
    scored.forEach(function (s) { s.score = s.score / Math.sqrt(qTokens.length); });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, k || 3).filter(function (s) { return s.score > 0; });
  }

  function entry(id) {
    if (!kb) return null;
    for (var i = 0; i < kb.entries.length; i++) {
      if (kb.entries[i].id === id) return kb.entries[i];
    }
    return null;
  }

  // ---- dom helpers -----------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function scrollLog() { log.scrollTop = log.scrollHeight; }

  function track(name, meta) {
    if (window.ndcTrack) window.ndcTrack(name, meta || {});
  }

  function addMessage(role, text, sources) {
    var wrap = el("div", "chat-msg chat-msg--" + role);
    wrap.appendChild(el("div", "chat-bubble", text));
    if (sources && sources.length) {
      var srcWrap = el("div", "chat-sources");
      srcWrap.appendChild(el("span", "chat-sources__label", "Read more:"));
      sources.forEach(function (s) {
        var a = el("a", "chat-source", s.title);
        a.href = s.url;
        srcWrap.appendChild(a);
      });
      wrap.appendChild(srcWrap);
    }
    log.appendChild(wrap);
    scrollLog();
    return wrap;
  }

  function addTyping() {
    var wrap = el("div", "chat-msg chat-msg--assistant chat-typing");
    wrap.setAttribute("aria-label", "Assistant is typing");
    var b = el("div", "chat-bubble");
    b.innerHTML = '<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>';
    wrap.appendChild(b);
    log.appendChild(wrap);
    scrollLog();
    return wrap;
  }

  /*
    Options render as full-width buttons rather than pills. They are the
    primary control in this design, they carry sentence-length labels,
    and a pill row wraps those into unreadable fragments on a phone.
  */
  function addOptions(options) {
    var wrap = el("div", "chat-options");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Choose an option");
    options.forEach(function (opt) {
      var b = el("button", "chat-option" + (opt.primary ? " chat-option--primary" : ""), opt.label);
      b.type = "button";
      b.addEventListener("click", function () {
        // Retire this group so old buttons can't be re-clicked further up
        // the transcript, which would make the trail meaningless.
        wrap.remove();
        addMessage("user", opt.label);
        if (opt.run) opt.run();
        else go(opt.go);
      });
      wrap.appendChild(b);
    });
    log.appendChild(wrap);
    scrollLog();
    return wrap;
  }

  // ---- flow ------------------------------------------------------------

  var CALLBACK_OPT = { label: "Request a callback", go: "callback", primary: true };

  /*
    Human labels for the node the visitor came from. These land in the
    "Service interest" line of the notification email, so a consultant
    reads "Leaving debt review" rather than the internal id
    "leavingReview" — and knows what the call is about before dialling.
  */
  var TOPIC_LABELS = {
    welcome: "General enquiry",
    helpDebt: "Help with debt",
    services: "Exploring services",
    infoDebtReview: "Debt review",
    infoMediation: "Debt mediation",
    underReview: "Already under debt review",
    currentArrangement: "Their current arrangement",
    leavingReview: "Leaving debt review",
    checklists: "Document checklist",
    somethingElse: "Typed question"
  };

  var NODES = {
    welcome: {
      text: "Hi 👋 How can we help you today?",
      options: [
        { label: "Help with debt", go: "helpDebt" },
        { label: "Already under debt review", go: "underReview" },
        { label: "Request a callback", go: "callback" },
        { label: "Something else", go: "somethingElse" }
      ]
    },

    helpDebt: {
      text: "We help people who are falling behind on credit repayments. Depending on your situation that can mean debt review, debt mediation, or getting a realistic budget in place.",
      options: [
        { label: "Explore services", go: "services" },
        CALLBACK_OPT
      ]
    },

    services: {
      text: "Which would you like to know about?",
      options: [
        { label: "Debt review", go: "infoDebtReview" },
        { label: "Debt mediation", go: "infoMediation" },
        { label: "What documents do I need?", go: "checklists" },
        CALLBACK_OPT
      ]
    },

    infoDebtReview: { kbId: "svc-debt-review", options: [
      { label: "How is mediation different?", go: "infoMediation" },
      CALLBACK_OPT
    ] },

    infoMediation: { kbId: "svc-debt-mediation", options: [
      { label: "Tell me about debt review", go: "infoDebtReview" },
      CALLBACK_OPT
    ] },

    underReview: {
      text: "What would you like help with?",
      options: [
        { label: "My current arrangement", go: "currentArrangement" },
        { label: "Understanding my options for leaving debt review", go: "leavingReview" },
        { label: "Speak to someone", go: "callback" }
      ]
    },

    currentArrangement: {
      kbId: "article-what-happens-after-you-apply-for-debt-review",
      options: [
        { label: "What documents do I need?", go: "checklists" },
        CALLBACK_OPT
      ]
    },

    /*
      This branch exists because people ask about it, not because an
      outcome can be offered. The source text states that removal follows
      specific legal routes and requires an assessment. The NCR circular
      is attached as a second source because consumers searching this
      phrase are precisely the ones being targeted by upfront-fee
      operators. Nothing here decides eligibility or implies removal.
    */
    leavingReview: {
      kbId: "svc-debt-review-removal",
      extraSource: "ncr-circular-2-2025",
      note: "Whether that is possible in your case is an assessment a registered debt counsellor has to make — I can't decide it here.",
      options: [
        { label: "Speak to someone about this", go: "callback" }
      ]
    },

    somethingElse: {
      text: "Type your question below and I'll answer from what's published on this site. If I'm not confident, I'll offer you a callback rather than guess.",
      focusInput: true
    }
  };

  function renderNode(id) {
    var node = NODES[id];
    if (!node) return;

    if (node.kbId) {
      loadKB().then(function () {
        var e = entry(node.kbId);
        if (!e) { addMessage("assistant", "Sorry — I couldn't load that just now."); return; }
        var sources = [{ title: e.title, url: e.url }];
        if (node.extraSource) {
          var x = entry(node.extraSource);
          if (x) sources.push({ title: x.title, url: x.url });
        }
        addMessage("assistant", e.text, sources);
        if (node.note) addMessage("assistant", node.note);
        if (node.options) addOptions(node.options);
      });
      return;
    }

    if (node.text) addMessage("assistant", node.text);
    if (node.options) addOptions(node.options);
    if (node.focusInput) input.focus();
  }

  function go(id, skipTrail) {
    if (id === "callback") { showCallbackForm(); syncActions(); return; }
    if (id === "checklists") { showChecklistMenu(); syncActions(); return; }
    if (!NODES[id]) return;
    if (currentNode && !skipTrail) trail.push(currentNode);
    currentNode = id;
    track("chat_node", { node: id });
    renderNode(id);
    syncActions();
  }

  function back() {
    if (!trail.length) return;
    var prev = trail.pop();
    currentNode = prev;
    addMessage("user", "Back");
    track("chat_back", { to: prev });
    renderNode(prev);
    syncActions();
  }

  function restart() {
    log.innerHTML = "";
    trail = [];
    currentNode = null;
    pendingQuestion = null;
    track("chat_restart", {});
    greet();
  }

  /*
    Back and Start again live in a persistent bar rather than being
    repeated inline after every message, so the transcript stays short.
    "Request a callback" sits there permanently: the brief is that nobody
    should have to finish a questionnaire to reach a human, and the
    reliable way to guarantee that is to keep the control on screen at
    all times rather than trusting every branch to offer it.
  */
  function syncActions() {
    backBtn.hidden = trail.length === 0;
    restartBtn.hidden = !currentNode && !log.firstChild;
  }

  // ---- checklists (kept) -----------------------------------------------

  function showChecklistMenu() {
    loadKB().then(function () {
      if (!kb || !kb.checklists) return;
      if (currentNode) trail.push(currentNode);
      currentNode = "checklists";
      addMessage("assistant", "Which list would you like?");
      var keys = Object.keys(kb.checklists);
      addOptions(keys.map(function (key) {
        return {
          label: kb.checklists[key].label,
          run: function () {
            track("chat_checklist_opened", { checklist: key });
            showChecklist(key);
          }
        };
      }));
      syncActions();
    });
  }

  function showChecklist(key) {
    var c = kb.checklists[key];
    if (!c) return;
    var wrap = el("div", "chat-msg chat-msg--assistant");
    var bubble = el("div", "chat-bubble");
    bubble.appendChild(el("p", "chat-checklist__intro", c.intro));
    var list = el("ul", "chat-checklist");
    c.items.forEach(function (it) {
      var li = el("li");
      var row = el("div", "chat-checklist__row");
      row.appendChild(el("span", "chat-checklist__tick", "✓"));
      row.appendChild(el("span", "chat-checklist__item", it.item));
      li.appendChild(row);
      var why = el("button", "chat-checklist__why", "Why do I need this?");
      why.type = "button";
      why.setAttribute("aria-expanded", "false");
      var reason = el("p", "chat-checklist__reason", it.why);
      reason.hidden = true;
      why.addEventListener("click", function () {
        var open = reason.hidden;
        reason.hidden = !open;
        why.setAttribute("aria-expanded", open ? "true" : "false");
        why.textContent = open ? "Hide" : "Why do I need this?";
      });
      li.appendChild(why);
      li.appendChild(reason);
      list.appendChild(li);
    });
    bubble.appendChild(list);
    wrap.appendChild(bubble);
    if (c.learnMore) {
      var srcWrap = el("div", "chat-sources");
      srcWrap.appendChild(el("span", "chat-sources__label", "Read more:"));
      var a = el("a", "chat-source", "Read the full guide");
      a.href = c.learnMore;
      srcWrap.appendChild(a);
      wrap.appendChild(srcWrap);
    }
    log.appendChild(wrap);
    scrollLog();
    addOptions([CALLBACK_OPT]);
  }

  // ---- callback --------------------------------------------------------

  function loadLangs() {
    if (langs) return Promise.resolve(langs);
    return fetch(LANG_URL)
      .then(function (r) { return r.json(); })
      .then(function (d) { langs = d; return d; })
      .catch(function () { langs = null; return null; });
  }

  // Mirrors netlify/functions/contact.js exactly. Client-side validation
  // is a courtesy; the server remains the authority and is not bypassed.
  function isValidSAPhone(raw) {
    var digits = String(raw || "").replace(/[\s\-()]/g, "");
    return (
      /^\+27[1-9][0-9]{8}$/.test(digits) ||
      /^27[1-9][0-9]{8}$/.test(digits) ||
      /^0[1-9][0-9]{8}$/.test(digits)
    );
  }

  function field(id, label, type, required, hint) {
    var wrap = el("div", "chat-field");
    var lab = el("label", null, label + (required ? "" : " (optional)"));
    lab.setAttribute("for", id);
    var inp = el("input", "chat-field__input");
    inp.id = id;
    inp.type = type;
    if (type === "tel") { inp.inputMode = "tel"; inp.autocomplete = "tel"; }
    if (id.indexOf("name") !== -1) inp.autocomplete = "name";
    if (required) inp.required = true;
    var err = el("p", "chat-field__error");
    err.id = id + "-error";
    err.setAttribute("role", "alert");
    err.hidden = true;
    inp.setAttribute("aria-describedby", err.id);
    wrap.appendChild(lab);
    if (hint) {
      var h = el("p", "chat-field__hint", hint);
      h.id = id + "-hint";
      inp.setAttribute("aria-describedby", err.id + " " + h.id);
      wrap.appendChild(h);
    }
    wrap.appendChild(inp);
    wrap.appendChild(err);
    return { wrap: wrap, input: inp, error: err };
  }

  function showCallbackForm() {
    if (currentNode && currentNode !== "callback") trail.push(currentNode);
    currentNode = "callback";
    track("chat_callback_opened", { from: trail[trail.length - 1] || "direct" });

    addMessage("assistant", pendingQuestion
      ? "No problem — I'll pass your question on. Just your name and number and a consultant will call you."
      : "Happy to arrange that. I only need two things.");

    var card = el("div", "chat-form-card");
    var f = el("form", "chat-callback");
    f.noValidate = true;

    var name = field("ndc-cb-name", "Your name", "text", true);
    var phone = field("ndc-cb-phone", "Contact number", "tel", true, "A South African number, e.g. 082 123 4567");
    name.input.value = draft.name;
    phone.input.value = draft.phone;
    f.appendChild(name.wrap);
    f.appendChild(phone.wrap);

    // Optional extras, folded away so the form reads as two fields.
    var more = el("details", "chat-more");
    more.appendChild(el("summary", null, "Add a preferred time or language (optional)"));

    var timeWrap = el("div", "chat-field");
    var timeLab = el("label", null, "Preferred callback time (optional)");
    timeLab.setAttribute("for", "ndc-cb-time");
    var time = el("select", "chat-field__input");
    time.id = "ndc-cb-time";
    ["No preference", "Morning (8am–12pm)", "Afternoon (12pm–5pm)"].forEach(function (t) {
      var o = el("option", null, t);
      o.value = t === "No preference" ? "" : t;
      time.appendChild(o);
    });
    time.value = draft.time;
    timeWrap.appendChild(timeLab);
    timeWrap.appendChild(time);
    more.appendChild(timeWrap);

    var langWrap = el("div", "chat-field");
    var langLab = el("label", null, "Preferred language for the call (optional)");
    langLab.setAttribute("for", "ndc-cb-lang");
    var lang = el("select", "chat-field__input");
    lang.id = "ndc-cb-lang";
    lang.appendChild(el("option", null, "No preference"));
    lang.firstChild.value = "";
    langWrap.appendChild(langLab);
    langWrap.appendChild(lang);
    more.appendChild(langWrap);
    /*
      This asks which language the visitor would like to be SPOKEN to in.
      It is not a UI translation switch and must not be read as one: only
      English is published on this site, and offering a language here
      does not claim the website exists in it.
    */
    loadLangs().then(function (d) {
      if (!d) return;
      d.languages.forEach(function (l) {
        var o = el("option", null, l.endonym);
        o.value = l.name;
        lang.appendChild(o);
      });
      if (draft.lang) lang.value = draft.lang;
    });
    f.appendChild(more);

    var consentWrap = el("div", "chat-field chat-consent");
    var cb = el("input");
    cb.type = "checkbox";
    cb.id = "ndc-cb-consent";
    cb.required = true;
    var cbLab = el("label", null, "I consent to National Debt Consultants contacting me about this request.");
    cbLab.setAttribute("for", cb.id);
    var cbErr = el("p", "chat-field__error");
    cbErr.id = "ndc-cb-consent-error";
    cbErr.setAttribute("role", "alert");
    cbErr.hidden = true;
    cb.setAttribute("aria-describedby", cbErr.id);
    var cbRow = el("div", "chat-consent__row");
    cbRow.appendChild(cb);
    cbRow.appendChild(cbLab);
    consentWrap.appendChild(cbRow);
    consentWrap.appendChild(cbErr);
    f.appendChild(consentWrap);

    var priv = el("p", "chat-field__hint");
    var privLink = el("a", "chat-source", "How we handle your details");
    privLink.href = "/privacy-policy.html";
    priv.appendChild(privLink);
    f.appendChild(priv);

    // Honeypot. Hidden from sight and from assistive tech, so only a bot
    // filling every field will trip it.
    var hp = el("input", "chat-hp");
    hp.type = "text";
    hp.tabIndex = -1;
    hp.setAttribute("aria-hidden", "true");
    hp.autocomplete = "off";
    f.appendChild(hp);

    var submit = el("button", "chat-submit", "Request a callback");
    submit.type = "submit";
    f.appendChild(submit);

    var status = el("p", "chat-field__error");
    status.setAttribute("role", "alert");
    status.hidden = true;
    f.appendChild(status);

    card.appendChild(f);
    log.appendChild(card);
    setTimeout(function () {
      /*
        preventScroll matters here. Focusing the first field is right for
        keyboard and screen-reader users, but the browser's default
        scroll-on-focus pins the log to the top of the form, hiding the
        submit button below the fold — the visitor fills in two fields
        and appears to have nowhere to send them. Focus without
        scrolling, then scroll the log so the whole card is in view.
      */
      try { name.input.focus({ preventScroll: true }); }
      catch (e) { name.input.focus(); }
      scrollLog();
    }, 30);

    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      name.error.hidden = true; phone.error.hidden = true;
      cbErr.hidden = true; status.hidden = true;
      name.input.removeAttribute("aria-invalid");
      phone.input.removeAttribute("aria-invalid");

      // Keep whatever was typed, so a failure never costs it.
      draft.name = name.input.value;
      draft.phone = phone.input.value;
      draft.time = time.value;
      draft.lang = lang.value;

      var bad = null;
      if (!cb.checked) {
        cbErr.textContent = "Please tick this so we're allowed to contact you.";
        cbErr.hidden = false;
        bad = cb;
      }
      if (!isValidSAPhone(phone.input.value)) {
        phone.error.textContent = "Please enter a valid South African number, like 082 123 4567.";
        phone.error.hidden = false;
        phone.input.setAttribute("aria-invalid", "true");
        bad = phone.input;
      }
      if (!name.input.value.trim()) {
        name.error.textContent = "Please enter your name.";
        name.error.hidden = false;
        name.input.setAttribute("aria-invalid", "true");
        bad = name.input;
      }
      if (bad) { bad.focus(); return; }

      /*
        callbackTime is a field the backend email template already
        prints. Language and the carried question are not, so they are
        folded into `message` — which IS printed — rather than sent as
        new top-level keys that would validate fine and then silently
        never reach anyone.
      */
      var msgParts = ["Requested through the website assistant."];
      var fromNode = trail.length ? trail[trail.length - 1] : "welcome";
      var topic = TOPIC_LABELS[fromNode] || "General enquiry";
      if (lang.value) msgParts.push("Preferred language for the call: " + lang.value + ".");
      if (pendingQuestion) msgParts.push("Their question: " + pendingQuestion);

      submit.disabled = true;
      var original = submit.textContent;
      submit.textContent = "Sending…";

      fetch(CONTACT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.input.value.trim(),
          phone: phone.input.value.trim(),
          consent: true,
          callbackTime: time.value,
          service: topic + " (website assistant)",
          message: msgParts.join(" "),
          pageRef: location.pathname,
          honeypot: hp.value
        })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            return { ok: r.ok, data: d };
          });
        })
        .then(function (res) {
          // Success is claimed only when the backend actually accepted it.
          if (!res.ok || res.data.success !== true) {
            throw new Error(res.data && res.data.message ? res.data.message : "Submission failed.");
          }
          card.remove();
          track("chat_callback_submitted", {});
          pendingQuestion = null;
          draft = { name: "", phone: "", time: "", lang: "" };
          // Verbatim from the published FAQ: it states what happens
          // without promising a timeframe, which is not ours to invent.
          addMessage("assistant",
            "Thanks \u2014 that's sent. A consultant reviews your request and contacts you, ideally during your preferred time. Submitting this is an enquiry, not a commitment to anything.");
          addOptions([
            { label: "Ask something else", go: "somethingElse" },
            { label: "Start again", run: restart }
          ]);
        })
        .catch(function (err) {
          submit.disabled = false;
          submit.textContent = original;
          status.textContent = String(err.message || "Something went wrong.") +
            " Your details are still here — you can try again.";
          status.hidden = false;
          track("chat_callback_failed", {});
          // Offer the verified number as a way through, since the form
          // is currently the thing that is broken.
          loadKB().then(function () {
            var c = (kb && kb.company) || {};
            if (!c.phone || card.querySelector(".chat-fallback-call")) return;
            var row = el("div", "chat-options chat-fallback-call");
            var tel = el("a", "chat-option chat-option--primary", "Call us on " + c.phone);
            tel.href = c.phoneHref;
            tel.addEventListener("click", function () {
              track("chat_human_escalation", { channel: "phone" });
            });
            row.appendChild(tel);
            card.appendChild(row);
            scrollLog();
          });
        });
    });
  }

  // ---- free text -------------------------------------------------------

  function dontKnow(question) {
    pendingQuestion = question;
    addMessage("assistant",
      "I don't have verified information on that in what's published here, and I'd rather not guess on something financial. A consultant can answer it properly.");
    addOptions([
      CALLBACK_OPT,
      { label: "Start again", run: restart }
    ]);
  }

  function send(question) {
    if (!question || !question.trim()) return;
    question = question.trim().slice(0, MAX_INPUT);
    addMessage("user", question);
    track("chat_message_sent", {});
    input.value = "";
    sendBtn.disabled = true;
    var typing = addTyping();

    loadKB()
      .then(function () {
        if (NEVER_ANSWER.some(function (re) { return re.test(question); })) {
          typing.remove();
          dontKnow(question);
          return;
        }
        var hits = retrieve(question, 3);
        if (!hits.length || hits[0].score < MIN_SCORE || hits[0].coverage < MIN_COVERAGE) {
          typing.remove();
          dontKnow(question);
          return;
        }
        var context = hits.map(function (h) {
          return { id: h.entry.id, title: h.entry.title, url: h.entry.url, text: h.entry.text };
        });
        return fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question, context: context })
        })
          .then(function (r) {
            if (!r.ok) throw new Error("chat api " + r.status);
            return r.json();
          })
          .then(function (data) {
            if (!data || !data.answer) throw new Error("no answer");
            return { text: data.answer, sources: (data.sources || context.slice(0, 2)) };
          })
          .catch(function () {
            // Extractive fallback: approved text verbatim, never generated.
            return {
              text: hits[0].entry.text,
              sources: hits.slice(0, 2).map(function (h) {
                return { title: h.entry.title, url: h.entry.url };
              })
            };
          })
          .then(function (res) {
            typing.remove();
            addMessage("assistant", res.text, res.sources.map(function (s) {
              return { title: s.title, url: s.url };
            }));
            addOptions([CALLBACK_OPT]);
          });
      })
      .catch(function () {
        typing.remove();
        dontKnow(question);
      })
      .then(function () {
        sendBtn.disabled = false;
      });
  }

  // ---- shell -----------------------------------------------------------

  function greet() {
    currentNode = null;
    trail = [];
    go("welcome", true);
  }

  function open() {
    panel.hidden = false;
    document.body.classList.add("chat-open");
    launcher.setAttribute("aria-expanded", "true");
    if (!log.firstChild) greet();
    loadKB();
    syncViewport();
    /*
      Focus synchronously. The panel is already un-hidden and laid out by
      this point, so a timeout buys nothing and leaves a window in which
      a screen-reader user's focus is still on the launcher while the
      dialog is open. greet() runs above, so the first option exists.
    */
    var firstOption = log.querySelector(".chat-option");
    (firstOption || input).focus();
    track("chat_opened", {});
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove("chat-open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  /*
    On a phone the panel is a bottom sheet. Without this, the on-screen
    keyboard overlays the composer and the visitor cannot see what they
    are typing or reach Send. visualViewport reports the area actually
    left visible, so the sheet is sized and offset to sit above the
    keyboard instead of behind it.
  */
  function syncViewport() {
    var vv = window.visualViewport;
    if (!vv || !panel || panel.hidden) return;
    if (window.matchMedia("(max-width: 30rem)").matches) {
      panel.style.setProperty("--chat-vh", vv.height + "px");
      var overlap = window.innerHeight - vv.height - vv.offsetTop;
      panel.style.bottom = Math.max(0, overlap) + "px";
    } else {
      panel.style.removeProperty("--chat-vh");
      panel.style.bottom = "";
    }
  }

  function iconBtn(label, svg, onClick) {
    var b = el("button", "chat-icon-btn", "");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = svg;
    b.addEventListener("click", onClick);
    return b;
  }

  function build() {
    launcher = el("button", "chat-launcher");
    launcher.type = "button";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "ndc-chat-panel");
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      '<span class="chat-launcher__label">Need help?</span>';
    launcher.addEventListener("click", function () {
      panel.hidden ? open() : close();
    });

    panel = el("div", "chat-panel");
    panel.id = "ndc-chat-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "NDC virtual assistant");

    var head = el("div", "chat-head");
    var titleWrap = el("div");
    titleWrap.appendChild(el("p", "chat-head__title", "NDC Assistant"));
    // Says plainly that this is not a person. There is no live-agent
    // backend, so anything vaguer would be a lie by omission.
    titleWrap.appendChild(el("p", "chat-head__sub", "Virtual assistant — not a live agent"));
    head.appendChild(titleWrap);

    var actions = el("div", "chat-head__actions");
    actions.appendChild(iconBtn("Minimise chat",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
      close));
    actions.appendChild(iconBtn("Close chat",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
      function () { restart(); close(); }));
    head.appendChild(actions);

    log = el("div", "chat-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-atomic", "false");

    actionBar = el("div", "chat-actions");
    backBtn = el("button", "chat-action", "← Back");
    backBtn.type = "button";
    backBtn.hidden = true;
    backBtn.addEventListener("click", back);
    restartBtn = el("button", "chat-action", "Start again");
    restartBtn.type = "button";
    restartBtn.addEventListener("click", restart);
    var cbBtn = el("button", "chat-action chat-action--gold", "Request a callback");
    cbBtn.type = "button";
    cbBtn.addEventListener("click", function () { go("callback"); });
    actionBar.appendChild(backBtn);
    actionBar.appendChild(restartBtn);
    actionBar.appendChild(cbBtn);

    form = el("form", "chat-form");
    var label = el("label", "visually-hidden", "Type your question");
    label.setAttribute("for", "ndc-chat-input");
    input = el("input", "chat-input");
    input.id = "ndc-chat-input";
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = MAX_INPUT;
    input.placeholder = "Or type your question…";
    sendBtn = el("button", "chat-send", "");
    sendBtn.type = "submit";
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      send(input.value);
    });

    var note = el("p", "chat-note", "General information only — not financial or legal advice. This conversation isn't saved.");

    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(actionBar);
    panel.appendChild(form);
    panel.appendChild(note);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) close();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncViewport);
      window.visualViewport.addEventListener("scroll", syncViewport);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
