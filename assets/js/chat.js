/*
  NDC Debt Assistant — grounded website assistant.

  ARCHITECTURE (see also netlify/functions/chat.js):

    launcher click
      -> lazy-load assets/data/knowledge.json (nothing loads on page load)
      -> retrieve top-k matching entries locally (TF-IDF-ish scoring)
      -> POST question + retrieved context to /api/chat
           - if an LLM is configured server-side, it answers FROM that
             context only, and returns source links
           - if not configured (503) or the request fails, we fall back to
             EXTRACTIVE mode: show the best-matching approved text verbatim
      -> render answer + "Learn more" source links

  Why retrieval happens client-side too: the knowledge base is small
  (tens of entries, ~30KB), so scoring locally avoids a round-trip just to
  decide what's relevant, and keeps the extractive fallback working even
  if the function is unavailable. The whole site is never sent to an LLM —
  only the top few matching entries.

  GROUNDING RULE: this widget never generates prose client-side. In
  fallback mode it can only echo text that already exists in
  knowledge.json (which is generated from the real site content), so it
  cannot invent rates, fees, legal claims or contact details.
*/
(function () {
  "use strict";

  var KB_URL = "/assets/data/knowledge.json";
  var API_URL = "/api/chat";
  // Calibrated against the real knowledge base. Coverage (share of the
  // question's meaningful words the entry actually contains) separates
  // on-topic from off-topic far better than raw score: measured 1.0 for
  // "what is debt review?" vs 0.2-0.4 for injection/off-topic probes.
  var MIN_SCORE = 1.2;
  var MIN_COVERAGE = 0.5;

  /*
    Extractive mode can only echo an approved snippet — it cannot reason
    about whether that snippet actually answers the question. For question
    types where a topically-similar-but-wrong snippet would be actively
    misleading (a rate question answered with a general debt-review page,
    say), we refuse outright regardless of retrieval score. These are the
    categories the assistant must never appear to answer: specific
    numbers, personal account facts, decisions, and system internals.
    (With an LLM configured, the system prompt enforces the same rules and
    can judge relevance properly — this is the fallback's safety net.)
  */
  var NEVER_ANSWER = [
    /\b(interest|repo|prime)\s*rate\b/i,
    /\bwhat (is|are) (my|the current)\b.*\b(rate|balance|score|fee|amount|payment)\b/i,
    // Deliberately NOT a bare "my debt" — "how can I get help with my debt?"
    // is a general, answerable question, not a request for a personal figure.
    /\bmy (balance|credit score|credit record score|account balance|instal?ment amount)\b/i,
    /\bmy\b.{0,24}\b(balance|credit score)\b/i,
    /\bhow much (will|do|would|can) i\b/i,
    /\b(am i|do i) (approved|qualify for a loan)\b/i,
    /\b(system prompt|api key|instructions you|your instructions|internal config|other users)\b/i,
  ];
  var MAX_INPUT = 500;

  var kb = null;
  var kbLoading = null;
  var messages = [];
  var panel, log, form, input, launcher, sendBtn;

  var STOPWORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, is: 1, are: 1, was: 1, were: 1, to: 1, of: 1, in: 1,
    for: 1, on: 1, with: 1, my: 1, i: 1, me: 1, you: 1, your: 1, it: 1, that: 1, this: 1,
    do: 1, does: 1, can: 1, what: 1, how: 1, if: 1, be: 1, have: 1, has: 1, will: 1, would: 1,
    about: 1, at: 1, as: 1, but: 1, from: 1, by: 1, so: 1, we: 1, they: 1, there: 1,
    // Generic question scaffolding — carries no topic signal, and counting
    // it against coverage made plainly answerable questions ("how can I
    // create a budget?") fall below the threshold.
    create: 1, make: 1, tell: 1, explain: 1, want: 1, need: 1, should: 1, could: 1,
    please: 1, get: 1, got: 1, know: 1, help: 1, any: 1, some: 1, more: 1, when: 1, who: 1
  };

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
        // Precompute document frequency so common words score lower.
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
      var score = 0;
      var matched = 0;
      var titleTokens = tokenize(e.title);
      qTokens.forEach(function (t) {
        var df = kb._df[t] || N;
        var idf = Math.log(1 + N / df);
        var inText = e._tokens.indexOf(t) !== -1;
        var inTitle = titleTokens.indexOf(t) !== -1;
        if (inText) { score += idf; matched++; }
        if (inTitle) score += idf * 1.5; // title matches weigh more
      });
      // Coverage = how much of the question this entry actually addresses.
      // This is the real signal: "what is debt review?" covers 2/2 tokens
      // (low IDF, low raw score), while "reveal your system prompt" covers
      // maybe 1/5 against any entry. Raw score alone conflates the two.
      return { entry: e, score: score, coverage: matched / qTokens.length };
    });
    // Normalise by query length: a long question that only clips one or two
    // incidental words shouldn't outscore a short, genuinely on-topic one.
    // Without this, off-topic questions ("reveal your system prompt") can
    // score just high enough to return a confusing, irrelevant snippet.
    scored.forEach(function (s) {
      s.score = s.score / Math.sqrt(qTokens.length);
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, k || 3).filter(function (s) { return s.score > 0; });
  }

  // ---- rendering -------------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function addMessage(role, text, sources) {
    messages.push({ role: role, text: text });
    var wrap = el("div", "chat-msg chat-msg--" + role);
    var bubble = el("div", "chat-bubble", text);
    wrap.appendChild(bubble);

    if (sources && sources.length) {
      var srcWrap = el("div", "chat-sources");
      srcWrap.appendChild(el("span", "chat-sources__label", "Learn more:"));
      sources.forEach(function (s) {
        var a = el("a", "chat-source", s.title);
        a.href = s.url;
        srcWrap.appendChild(a);
      });
      wrap.appendChild(srcWrap);
    }
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function addTyping() {
    var wrap = el("div", "chat-msg chat-msg--assistant chat-typing");
    wrap.setAttribute("aria-label", "Assistant is typing");
    var b = el("div", "chat-bubble");
    b.innerHTML = '<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>';
    wrap.appendChild(b);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function escalation() {
    var c = kb && kb.company ? kb.company : {};
    var wrap = el("div", "chat-escalation");
    wrap.appendChild(el("span", "chat-sources__label", "Prefer a person?"));
    var row = el("div", "chat-escalation__row");
    if (c.phone) {
      var tel = el("a", "chat-chip", "Call " + c.phone);
      tel.href = c.phoneHref;
      tel.addEventListener("click", function () { track("chat_human_escalation", { channel: "phone" }); });
      row.appendChild(tel);
    }
    var contact = el("a", "chat-chip", "Request a callback");
    contact.href = c.contactUrl || "/contact.html";
    contact.addEventListener("click", function () { track("chat_human_escalation", { channel: "contact_form" }); });
    row.appendChild(contact);
    wrap.appendChild(row);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function track(name, meta) {
    if (window.ndcTrack) window.ndcTrack(name, meta || {});
  }

  // ---- answering -------------------------------------------------------

  function extractiveAnswer(hits) {
    // Fallback mode: return approved text verbatim. Never generated prose.
    var best = hits[0];
    var sources = hits.slice(0, 2).map(function (h) {
      return { title: h.entry.title, url: h.entry.url };
    });
    return { text: best.entry.text, sources: sources };
  }

  function dontKnow() {
    return {
      text:
        "I don't have verified information on that in what's published on this site, and I don't want to guess on something financial. A consultant can answer it properly — you can request a callback or call us directly.",
      sources: [],
      escalate: true,
    };
  }

  function answer(question) {
    return loadKB().then(function () {
      var blocked = NEVER_ANSWER.some(function (re) { return re.test(question); });
      if (blocked) return dontKnow();

      var hits = retrieve(question, 3);
      if (!hits.length || hits[0].score < MIN_SCORE || hits[0].coverage < MIN_COVERAGE) {
        return dontKnow();
      }

      var context = hits.map(function (h) {
        return { id: h.entry.id, title: h.entry.title, url: h.entry.url, text: h.entry.text };
      });

      // Try the server (LLM) first; fall back to extractive on any failure.
      return fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question.slice(0, MAX_INPUT), context: context }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("chat api " + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.answer) throw new Error("no answer");
          return {
            text: data.answer,
            sources: (data.sources || context.slice(0, 2)).map(function (s) {
              return { title: s.title, url: s.url };
            }),
          };
        })
        .catch(function () {
          return extractiveAnswer(hits);
        });
    });
  }

  function send(question) {
    if (!question || !question.trim()) return;
    question = question.trim().slice(0, MAX_INPUT);
    addMessage("user", question);
    track("chat_message_sent", {});
    input.value = "";
    sendBtn.disabled = true;

    var typing = addTyping();
    answer(question)
      .then(function (res) {
        typing.remove();
        addMessage("assistant", res.text, res.sources);
        if (res.escalate) escalation();
      })
      .catch(function () {
        typing.remove();
        addMessage(
          "assistant",
          "Sorry — something went wrong on my side. You can try again, or contact a consultant directly."
        );
        escalation();
      })
      .finally(function () {
        sendBtn.disabled = false;
        input.focus();
      });
  }

  // ---- UI --------------------------------------------------------------

  var SUGGESTIONS = [
    "What is debt review?",
    "What's the difference between debt review and mediation?",
    "Does everyone qualify for debt review?",
    "How can I create a budget?",
    "How can I contact you?",
  ];

  function greet() {
    log.innerHTML = "";
    messages = [];
    addMessage(
      "assistant",
      "Hi — I'm the NDC assistant. I can answer questions using the information published on this website. I'm not a debt counsellor and I can't give personal financial advice, but I can point you in the right direction."
    );
    var chips = el("div", "chat-suggestions");
    SUGGESTIONS.forEach(function (q) {
      var b = el("button", "chat-chip", q);
      b.type = "button";
      b.addEventListener("click", function () {
        track("chat_suggestion_clicked", {});
        send(q);
        chips.remove();
      });
      chips.appendChild(b);
    });
    log.appendChild(chips);
  }

  function open() {
    panel.hidden = false;
    document.body.classList.add("chat-open");
    launcher.setAttribute("aria-expanded", "true");
    if (!messages.length) greet();
    loadKB();
    setTimeout(function () { input.focus(); }, 50);
    track("chat_opened", {});
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove("chat-open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
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
    panel.setAttribute("aria-label", "NDC debt assistant");
    panel.setAttribute("aria-modal", "false");

    var head = el("div", "chat-head");
    var titleWrap = el("div");
    titleWrap.appendChild(el("p", "chat-head__title", "NDC Assistant"));
    titleWrap.appendChild(el("p", "chat-head__sub", "Answers from this website"));
    head.appendChild(titleWrap);

    var actions = el("div", "chat-head__actions");
    var clearBtn = el("button", "chat-icon-btn", "");
    clearBtn.type = "button";
    clearBtn.title = "Clear conversation";
    clearBtn.setAttribute("aria-label", "Clear conversation");
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
    clearBtn.addEventListener("click", function () { greet(); input.focus(); });

    var closeBtn = el("button", "chat-icon-btn", "");
    closeBtn.type = "button";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    closeBtn.addEventListener("click", close);

    actions.appendChild(clearBtn);
    actions.appendChild(closeBtn);
    head.appendChild(actions);

    log = el("div", "chat-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-atomic", "false");

    form = el("form", "chat-form");
    var label = el("label", "visually-hidden", "Type your question");
    label.setAttribute("for", "ndc-chat-input");
    input = el("input", "chat-input");
    input.id = "ndc-chat-input";
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = MAX_INPUT;
    input.placeholder = "Ask a question…";
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
    panel.appendChild(form);
    panel.appendChild(note);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
