(function () {
  "use strict";
  var engine = window.NDCBudgetEngine;
  if (!engine) return;

  var form = document.querySelector("[data-calculator]");
  if (!form) return;

  var STEP_NAMES = ["income", "expenses", "debts", "results"];
  var STEP_LABELS = ["Income", "Expenses", "Debts", "Results"];
  var FIELDS_BY_STEP = [
    engine.INCOME_FIELDS,
    engine.EXPENSE_FIELDS,
    engine.DEBT_FIELDS,
    [],
  ];
  var REQUIRED_FIELDS = ["takeHome"];

  var state = {
    step: 1,
    values: {}, // raw string values, preserved verbatim across steps
  };

  var liveRegion = document.querySelector("[data-calc-live]");
  var progressList = document.querySelector("[data-calc-progress]");

  function announce(message) {
    if (liveRegion) liveRegion.textContent = message;
  }

  function fieldEl(name) {
    return form.querySelector('[name="' + name + '"]');
  }

  function fieldWrap(name) {
    return form.querySelector('[data-field="' + name + '"]');
  }

  function setError(name, message) {
    var wrap = fieldWrap(name);
    if (!wrap) return;
    var errorEl = wrap.querySelector(".error");
    if (message) {
      wrap.setAttribute("data-invalid", "true");
      if (errorEl) errorEl.textContent = message;
    } else {
      wrap.removeAttribute("data-invalid");
    }
  }

  function setWarning(name, message) {
    var wrap = fieldWrap(name);
    if (!wrap) return;
    var warnEl = wrap.querySelector(".warning");
    if (message) {
      wrap.setAttribute("data-warning", "true");
      if (warnEl) warnEl.textContent = message;
    } else {
      wrap.removeAttribute("data-warning");
    }
  }

  function validateField(name, options) {
    options = options || {};
    var el = fieldEl(name);
    if (!el) return { valid: true };
    var raw = el.value;
    var parsed = engine.parseCurrency(raw);
    var required = REQUIRED_FIELDS.indexOf(name) !== -1;

    if (!parsed.valid) {
      setError(name, "Enter a valid amount using numbers only (e.g. 11000 or R11 000).");
      setWarning(name, "");
      return { valid: false, parsed: parsed };
    }
    if (required && parsed.empty) {
      setError(name, "Enter an amount, or 0 if this doesn't apply to you.");
      setWarning(name, "");
      return { valid: false, parsed: parsed };
    }
    setError(name, "");
    if (parsed.large) {
      setWarning(name, "That's a large amount (" + engine.formatRands(parsed.cents) + "). Please check it's correct before continuing.");
    } else {
      setWarning(name, "");
    }
    return { valid: true, parsed: parsed };
  }

  function collectAllParsed() {
    var all = {};
    engine.INCOME_FIELDS.concat(engine.EXPENSE_FIELDS, engine.DEBT_FIELDS).forEach(function (name) {
      var el = fieldEl(name);
      all[name] = engine.parseCurrency(el ? el.value : "");
    });
    return all;
  }

  function validateStep(stepIndex) {
    var names = FIELDS_BY_STEP[stepIndex - 1] || [];
    var ok = true;
    names.forEach(function (name) {
      var result = validateField(name);
      if (!result.valid) ok = false;
    });
    return ok;
  }

  function updateProgress() {
    if (!progressList) return;
    var items = progressList.querySelectorAll("li");
    items.forEach(function (li, i) {
      var stepNum = i + 1;
      var track = li.querySelector(".track span");
      if (stepNum < state.step) {
        li.setAttribute("data-state", "done");
        if (track) track.style.width = "100%";
      } else if (stepNum === state.step) {
        li.setAttribute("data-state", "current");
        if (track) track.style.width = "55%";
      } else {
        li.removeAttribute("data-state");
        if (track) track.style.width = "0%";
      }
    });
  }

  function showStep(n, options) {
    var isInitial = !!(options && options.initial);
    state.step = n;
    form.querySelectorAll(".calc-step").forEach(function (section) {
      var isActive = Number(section.getAttribute("data-step")) === n;
      section.setAttribute("data-active", isActive ? "true" : "false");
    });
    updateProgress();
    if (n === 4) renderResults();

    // Don't steal scroll position or keyboard focus on the very first
    // render — only when the user actively moves between steps. Grabbing
    // focus/scroll on initial page load would yank a visitor away from the
    // page's normal entry point (skip link, header) before they've done
    // anything.
    if (isInitial) return;

    announce("Step " + n + " of 4: " + STEP_LABELS[n - 1]);
    var heading = form.querySelector('.calc-step[data-active="true"] h2');
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
    window.scrollTo({ top: form.offsetTop - 90, behavior: "auto" });
    if (window.ndcTrack) {
      if (n === 4) window.ndcTrack("calculator_completed", {});
      else window.ndcTrack("calculator_step_viewed", { step: n });
    }
  }

  function goNext() {
    if (state.step >= 4) return;
    if (!validateStep(state.step)) {
      var firstInvalid = form.querySelector('.calc-step[data-active="true"] [data-invalid="true"] input');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    showStep(state.step + 1);
  }

  function goBack() {
    if (state.step <= 1) return;
    showStep(state.step - 1);
  }

  function resetAll() {
    form.reset();
    form.querySelectorAll(".field").forEach(function (wrap) {
      wrap.removeAttribute("data-invalid");
      wrap.removeAttribute("data-warning");
    });
    showStep(1);
  }

  function amountLabel(cents) {
    return engine.formatRands(Math.abs(cents));
  }

  function renderResults() {
    var mount = document.querySelector("[data-calc-results]");
    if (!mount) return;
    var parsed = collectAllParsed();
    var result = engine.computeBudget(parsed);

    var figureClass = "result-figure--positive";
    var headline = "";
    var body = "";
    var figureText = "";

    if (result.state === "A") {
      figureClass = "result-figure--negative";
      headline = "Your essential expenses are more than your income";
      figureText = amountLabel(result.availableCents) + " short, before any debt repayments";
      body = "Right now, essential monthly expenses add up to more than the income entered — before any debt repayments are even considered. It's worth double-checking the amounts entered, and it may help to talk it through with a consultant.";
    } else if (result.state === "B") {
      figureClass = "result-figure--zero";
      headline = "There's nothing left for debt repayments";
      figureText = "R0 available before debt repayments";
      body = "After essential expenses, none of the income entered is left over before any debt repayments. Even a small change in expenses could make a difference.";
    } else if (result.state === "C") {
      figureClass = "result-figure--negative";
      headline = "Current repayments are more than what's left in the budget";
      figureText = amountLabel(result.surplusCents) + " short, after debt repayments";
      body = "After essential expenses, there is " + engine.formatRands(result.availableCents) + " left each month — but the debt repayments entered add up to more than that. This doesn't automatically mean any particular option applies; a consultant can help work through it.";
    } else if (result.state === "D") {
      figureClass = "result-figure--positive";
      headline = "The budget balances, with money left over";
      figureText = amountLabel(result.surplusCents) + " left over each month";
      body = "After essential expenses and current debt repayments, there is money left over each month. This doesn't necessarily mean debt review is needed — it simply reflects where these numbers stand today.";
    } else {
      figureClass = "result-figure--zero";
      headline = "Budget summary";
      figureText = amountLabel(result.availableCents) + " left before any debt repayments";
      body = "No current debt repayments were entered. Based on the income and essential expenses entered, this is what's left over each month before any debt repayments.";
    }

    mount.innerHTML =
      '<div class="result-figure ' + figureClass + '">' +
        '<p class="eyebrow" style="color:inherit;">' + headline + "</p>" +
        '<p class="result-figure__amount">' + figureText + "</p>" +
        "<p>" + body + "</p>" +
      "</div>" +
      '<table class="summary-table" aria-label="Budget summary">' +
        "<tbody>" +
        "<tr><th scope=\"row\">Total monthly income</th><td>" + engine.formatRands(result.incomeCents) + "</td></tr>" +
        "<tr><th scope=\"row\">Essential living expenses</th><td>" + engine.formatRands(result.expenseCents) + "</td></tr>" +
        "<tr><th scope=\"row\">Available before debt repayments</th><td>" + engine.formatRands(result.availableCents) + "</td></tr>" +
        "<tr><th scope=\"row\">Current monthly debt repayments</th><td>" + engine.formatRands(result.debtCents) + "</td></tr>" +
        "<tr><th scope=\"row\">Remaining balance</th><td>" + engine.formatRands(result.surplusCents) + "</td></tr>" +
        "</tbody>" +
      "</table>" +
      '<div class="card" style="background:var(--color-neutral-100); border-color:var(--border-subtle);">' +
        "<h3>What about a restructured repayment plan?</h3>" +
        "<p>A personalised repayment estimate requires an assessment. It depends on details this calculator doesn't collect, and a smaller monthly payment does not necessarily mean a lower total cost over time.</p>" +
      "</div>";
  }

  // Prevent-default on mousedown for step-navigation buttons so clicking
  // "Next" while an adjacent field shows an error doesn't blur that field
  // mid-click: the blur-triggered validation can clear the error text and
  // shift the layout between mousedown and mouseup, which can make the
  // browser drop the click entirely because its target moved.
  form.querySelectorAll(".calc-actions button").forEach(function (btn) {
    btn.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });
  });

  form.querySelectorAll("[data-step-next]").forEach(function (btn) {
    btn.addEventListener("click", goNext);
  });
  form.querySelectorAll("[data-step-back]").forEach(function (btn) {
    btn.addEventListener("click", goBack);
  });
  form.querySelectorAll("[data-step-reset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (window.confirm("Clear everything you've entered and start over?")) resetAll();
    });
  });
  form.querySelectorAll("[data-step-edit]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      showStep(1);
    });
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    goNext();
  });

  engine.INCOME_FIELDS.concat(engine.EXPENSE_FIELDS, engine.DEBT_FIELDS).forEach(function (name) {
    var el = fieldEl(name);
    if (!el) return;
    el.addEventListener("blur", function () {
      validateField(name);
    });
    el.addEventListener("paste", function () {
      window.setTimeout(function () {
        validateField(name);
      }, 0);
    });
  });

  showStep(1, { initial: true });
})();
