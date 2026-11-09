/*
  Budget estimate: take-home pay, living costs and monthly debt repayments.

  The estimate updates live as the visitor types. All arithmetic lives in
  assets/js/budget-engine.js (parseCurrency, formatRands, estimateSimple),
  which is unit tested in scripts/test-calculator.mjs; this file only reads
  the three fields, asks the engine, and shows the answer.

  PRIVACY: nothing typed here is sent anywhere, stored (no localStorage, no
  cookies) or put in a URL. The only analytics events are the bare names
  "calculator_started" and "calculator_completed", with no values.

  Three outcomes, driven by engine.state:
    shortfall  repayments exceed what is left after living costs
    tight      something is left, but under 10% of income
    ok         10% of income or more is left
*/
(function () {
  "use strict";

  var engine = window.NDCBudgetEngine;
  var form = document.querySelector("[data-calc]");
  var mount = document.querySelector("[data-calc-results]");
  if (!engine || !form || !mount) return;

  var sr = document.querySelector("[data-calc-sr]");
  var resetBtn = form.querySelector("[data-calc-reset]");
  var placeholder = mount.querySelector("[data-calc-placeholder]");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MINUS = "−"; // typographic minus for display; the engine's value stays an integer

  var KEYS = ["income", "living", "debt"];
  var inputs = {};
  var wraps = {};
  KEYS.forEach(function (k) {
    wraps[k] = form.querySelector('[data-field="' + k + '"]');
    inputs[k] = wraps[k].querySelector("input");
  });

  function fmt(cents) {
    return engine.formatRands(cents).replace(/^-/, MINUS);
  }

  // ---- the result card, built once and updated in place ---------------------
  // Updating text nodes (rather than re-rendering HTML) means animations are
  // never replayed on each keystroke and focus is never disturbed.
  var CARD =
    '<div class="result-figure result-figure--zero" data-r-box>' +
      '<p class="eyebrow" data-r-eyebrow></p>' +
      '<p class="result-figure__amount"><span data-r-amount></span> <span class="result-figure__label" data-r-label></span></p>' +
      '<p data-r-body></p>' +
    "</div>" +
    '<div class="result-breakdown" role="img" data-r-chart>' +
      '<div class="rb-row"><span class="rb-label">Take-home pay</span><div class="rb-track"><div class="rb-fill rb-fill--income" data-r-bar="income"></div></div><span class="rb-value" data-r-v="income"></span></div>' +
      '<div class="rb-row"><span class="rb-label">Living costs</span><div class="rb-track"><div class="rb-fill rb-fill--expenses" data-r-bar="living"></div></div><span class="rb-value" data-r-v="living"></span></div>' +
      '<div class="rb-row"><span class="rb-label">Debt repayments</span><div class="rb-track"><div class="rb-fill rb-fill--debt" data-r-bar="debt"></div></div><span class="rb-value" data-r-v="debt"></span></div>' +
    "</div>" +
    '<table class="summary-table" aria-label="Your estimate in figures"><tbody>' +
      '<tr><th scope="row">Left after living costs</th><td data-r-left></td></tr>' +
      '<tr><th scope="row">Debt repayments as a % of income</th><td data-r-pct></td></tr>' +
      '<tr><th scope="row" data-r-th>Monthly surplus</th><td data-r-amount2></td></tr>' +
    "</tbody></table>" +
    '<div class="result-actions" data-r-actions></div>' +
    '<p class="result-note">This is an estimate based on the amounts you entered. It is not a repayment offer or an eligibility decision, and no savings are promised. Nothing you enter here is sent anywhere unless you submit the callback form, and a consultant will confirm the numbers with you.</p>';

  var card = document.createElement("div");
  card.className = "card calc-result";
  card.hidden = true;
  card.innerHTML = CARD; // static markup only: no visitor input is ever in this string
  mount.appendChild(card);

  function q(sel) { return card.querySelector(sel); }
  var els = {
    box: q("[data-r-box]"),
    eyebrow: q("[data-r-eyebrow]"),
    amount: q("[data-r-amount]"),
    amount2: q("[data-r-amount2]"),
    label: q("[data-r-label]"),
    body: q("[data-r-body]"),
    chart: q("[data-r-chart]"),
    left: q("[data-r-left]"),
    pct: q("[data-r-pct]"),
    th: q("[data-r-th]"),
    actions: q("[data-r-actions]"),
  };

  var CONTACT = "/contact.html?ref=calculator";
  var ACTIONS = {
    shortfall:
      '<a class="btn btn-gold" href="' + CONTACT + '">Speak to a consultant</a>' +
      '<a class="btn btn-outline" href="/debt-review.html">How debt review works</a>',
    tight:
      '<a class="btn btn-gold" href="' + CONTACT + '">Speak to a consultant</a>' +
      '<a class="btn btn-outline" href="/debt-advice/how-to-build-a-realistic-monthly-budget.html">Budgeting tips</a>',
    ok:
      '<a class="btn btn-outline" href="' + CONTACT + '">Talk to a consultant</a>' +
      '<a class="btn btn-ghost" href="/debt-advice/">Read our debt advice</a>',
  };
  var BOX_CLASS = { shortfall: "result-figure--negative", tight: "result-figure--zero", ok: "result-figure--positive" };

  // ---- number tween ---------------------------------------------------------
  // Eases from the previous value to the new one so a changing figure reads as
  // a change rather than a flicker. Skipped for reduced motion and first paint.
  function tween(el, to, format) {
    var from = el._v;
    el._v = to;
    if (el._raf) window.cancelAnimationFrame(el._raf);
    if (reduced || typeof from !== "number" || typeof to !== "number" || from === to) {
      el.textContent = format(to);
      return;
    }
    var start = performance.now();
    var DURATION = 320;
    (function frame(now) {
      var t = Math.min(1, (now - start) / DURATION);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(t < 1 ? Math.round(from + (to - from) * eased) : to);
      if (t < 1) el._raf = window.requestAnimationFrame(frame);
    })(start);
  }

  // ---- reading and validating the fields -----------------------------------
  var ERROR_TEXT = {
    negative: "Please enter a positive amount, without a minus sign.",
    nonnumeric: "Enter an amount using numbers only, for example 15000 or R15 000.",
  };

  function read(key) { return engine.parseCurrency(inputs[key].value); }

  function setError(key, parsed) {
    var wrap = wraps[key];
    var err = wrap.querySelector(".error");
    if (parsed.valid) {
      wrap.removeAttribute("data-invalid");
      inputs[key].removeAttribute("aria-invalid");
      err.textContent = "";
    } else {
      wrap.setAttribute("data-invalid", "true");
      inputs[key].setAttribute("aria-invalid", "true");
      err.textContent = ERROR_TEXT[parsed.reason] || "Please enter a valid amount in Rand.";
    }
  }

  function setWarning(key, parsed) {
    var wrap = wraps[key];
    var warn = wrap.querySelector(".warning");
    if (parsed.valid && parsed.large) {
      wrap.setAttribute("data-warning", "true");
      warn.textContent = "That is a very large amount. Please check it.";
    } else {
      wrap.removeAttribute("data-warning");
      warn.textContent = "";
    }
  }

  // ---- showing the result ---------------------------------------------------
  function showPlaceholder(text) {
    card.hidden = true;
    placeholder.hidden = false;
    placeholder.querySelector("p").textContent = text;
  }

  var lastState = null;
  var completedSent = false;

  function describe(est) {
    var left = est.leftAfterLivingCents;
    var gap = fmt(Math.abs(est.surplusCents));
    if (est.state === "shortfall") {
      if (left < 0) {
        return {
          eyebrow: "Your living costs are more than your income",
          body: "Your living costs are " + fmt(-left) + " more than your take-home pay, before any debt repayments. Please check the amounts, and consider speaking to a consultant. The assessment is free.",
        };
      }
      return {
        eyebrow: "Your repayments are more than what is left",
        body: "After living costs you have " + fmt(left) + " a month, but your debt repayments come to " + fmt(est.debtCents) + ". That is a shortfall of " + gap + " each month. Debt review may be worth exploring, and a consultant can assess your situation for free.",
      };
    }
    if (est.state === "tight") {
      return {
        eyebrow: "Your budget is tight",
        body: "You would have " + fmt(est.surplusCents) + " left each month, which is less than " + engine.TIGHT_PERCENT + "% of your income. A consultant can help you plan before things get harder.",
      };
    }
    return {
      eyebrow: "Your budget balances",
      body: est.debtCents === 0
        ? "With no debt repayments entered, you would have " + fmt(est.surplusCents) + " left each month after living costs."
        : "You would have " + fmt(est.surplusCents) + " left each month after living costs and debt repayments. If you would like a second opinion, a consultant can talk it through with you.",
    };
  }

  function ratio(part, whole) {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(1, part / whole));
  }

  function render(est) {
    var short = est.state === "shortfall";
    var d = describe(est);

    placeholder.hidden = true;
    card.hidden = false;

    els.box.className = "result-figure " + BOX_CLASS[est.state];
    els.eyebrow.textContent = d.eyebrow;
    els.body.textContent = d.body;
    els.label.textContent = short ? "monthly shortfall" : "left each month";
    els.th.textContent = short ? "Monthly shortfall" : "Monthly surplus";

    tween(els.amount, est.surplusCents, fmt);
    tween(els.amount2, est.surplusCents, fmt);
    tween(els.left, est.leftAfterLivingCents, fmt);
    if (est.debtPercent === null) {
      els.pct._v = undefined;
      els.pct.textContent = "—";
    } else {
      tween(els.pct, est.debtPercent, function (n) { return n + "%"; });
    }

    var vals = { income: est.incomeCents, living: est.livingCents, debt: est.debtCents };
    KEYS.forEach(function (k) {
      card.querySelector('[data-r-bar="' + k + '"]').style.setProperty("--s", String(k === "income" ? (est.incomeCents > 0 ? 1 : 0) : ratio(vals[k], est.incomeCents)));
      card.querySelector('[data-r-v="' + k + '"]').textContent = fmt(vals[k]);
    });
    els.chart.setAttribute(
      "aria-label",
      "Take-home pay " + fmt(est.incomeCents) + ", living costs " + fmt(est.livingCents) + ", debt repayments " + fmt(est.debtCents) + "."
    );

    if (est.state !== lastState) {
      els.actions.innerHTML = ACTIONS[est.state]; // static markup, no visitor input
      lastState = est.state;
    }

    if (!completedSent) {
      completedSent = true;
      if (window.ndcTrack) window.ndcTrack("calculator_completed", {});
    }
    return d;
  }

  var latest = null;
  function update() {
    var parsed = {};
    KEYS.forEach(function (k) { parsed[k] = read(k); setWarning(k, parsed[k]); });

    // An error already on screen clears the moment the value is fixed.
    KEYS.forEach(function (k) { if (parsed[k].valid && wraps[k].hasAttribute("data-invalid")) setError(k, parsed[k]); });

    var anyEntered = KEYS.some(function (k) { return !parsed[k].empty; });
    resetBtn.hidden = !anyEntered;
    latest = null;

    if (KEYS.some(function (k) { return !parsed[k].valid; })) {
      showPlaceholder("Check the amounts you entered to see your estimate.");
      return;
    }
    if (parsed.income.cents <= 0) {
      showPlaceholder(anyEntered ? "Enter your take-home pay to see your estimate." : "Enter your take-home pay and your living costs or debt repayments to see what is left each month.");
      return;
    }
    if (parsed.living.empty && parsed.debt.empty) {
      showPlaceholder("Add your living costs or debt repayments to see what is left each month.");
      return;
    }

    var est = engine.estimateSimple(parsed.income.cents, parsed.living.cents, parsed.debt.cents);
    var d = render(est);
    latest = { est: est, d: d };
  }

  // Announce the settled result to screen readers (not every keystroke).
  function announce() {
    if (!sr) return;
    if (!latest) { sr.textContent = ""; return; }
    var e = latest.est;
    sr.textContent =
      latest.d.eyebrow + ". Left after living costs " + fmt(e.leftAfterLivingCents) +
      (e.debtPercent === null ? "" : ". Debt repayments are " + e.debtPercent + " percent of income") +
      ". " + (e.state === "shortfall" ? "Monthly shortfall of " + fmt(Math.abs(e.surplusCents)) : "Monthly surplus of " + fmt(e.surplusCents)) + ".";
  }

  var started = false;
  var raf = null;
  form.addEventListener("input", function () {
    if (!started) {
      started = true;
      if (window.ndcTrack) window.ndcTrack("calculator_started", {});
    }
    if (raf) return;
    raf = window.requestAnimationFrame(function () { raf = null; update(); });
  });

  // On leaving a field (value changed): show its error if any, and announce.
  form.addEventListener("change", function (e) {
    var key = e.target && e.target.name;
    if (KEYS.indexOf(key) !== -1) setError(key, read(key));
    update();
    announce();
  });

  resetBtn.addEventListener("click", function () {
    KEYS.forEach(function (k) { inputs[k].value = ""; setError(k, { valid: true }); setWarning(k, { valid: true }); });
    lastState = null;
    update();
    announce();
    inputs.income.focus();
  });

  update();
})();
