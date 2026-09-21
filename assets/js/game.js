/*
  The Month-End Challenge — UI layer.
  All accounting lives in game-engine.js (pure, unit-tested). This file only
  renders state and translates DOM events into engine calls — it never
  computes a Rand amount itself, beyond formatting for display.
*/
(function () {
  "use strict";

  var root = document.querySelector("[data-game-root]");
  if (!root || !window.NdcGameEngine) return;

  var Engine = window.NdcGameEngine;
  var busy = false; // guards against rapid double-clicks applying a choice twice
  var gameState = null;
  var pendingChoice = null; // { scenario, choice } selected but not yet confirmed

  function fmtRand(amount) {
    var n = Math.round(amount);
    var sign = n < 0 ? "−" : "";
    return sign + "R" + Math.abs(n).toLocaleString("en-ZA");
  }

  function track(eventName, meta) {
    if (window.ndcTrack) window.ndcTrack(eventName, meta || {});
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === "class") node.className = attrs[key];
      else if (key === "html") node.innerHTML = attrs[key];
      else if (key === "text") node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function focusHeading(container) {
    var heading = container.querySelector("h2, h3");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: false });
  }

  function newSeed() {
    // crypto.getRandomValues when available, falling back to Date.now();
    // either way this seed is never sent anywhere, only used locally to
    // pick this playthrough's four scenarios.
    if (window.crypto && window.crypto.getRandomValues) {
      var arr = new Uint32Array(1);
      window.crypto.getRandomValues(arr);
      return arr[0];
    }
    return Date.now() >>> 0;
  }

  // ---------------- Intro screen ----------------
  function renderIntro() {
    root.innerHTML = "";
    var card = el("div", { class: "card game-intro" });
    card.appendChild(el("h2", { text: "Before you start" }));
    card.appendChild(
      el("p", {
        text:
          "You’ll play as a fictional household with a fixed monthly take-home income. Essential costs and debt repayments are already accounted for — you’ll decide what happens with what’s left, across four weeks.",
      })
    );

    var assumptions = el("ul", { class: "stack game-assumptions mt-0" }, [
      el("li", { html: "<strong>Monthly take-home income:</strong> " + fmtRand(Engine.BASELINE.income) }),
      el("li", { html: "<strong>Essential expenses (rent, groceries, electricity, transport, insurance):</strong> " + fmtRand(Engine.BASELINE.essentialExpenses) }),
      el("li", { html: "<strong>Required debt repayments:</strong> " + fmtRand(Engine.BASELINE.debtRepayments) }),
      el("li", { html: "<strong>Starting emergency buffer:</strong> " + fmtRand(Engine.BASELINE.startingBuffer) }),
    ]);
    card.appendChild(assumptions);

    var startingFlexible = Engine.BASELINE.income - Engine.BASELINE.essentialExpenses - Engine.BASELINE.debtRepayments;
    card.appendChild(
      el("p", {
        class: "game-flexible-note",
        html: "That leaves <strong>" + fmtRand(startingFlexible) + "</strong> in flexible budget for the month — this is what your choices will affect.",
      })
    );

    var playBtn = el("button", { type: "button", class: "btn btn-gold btn-block", "data-action": "play" }, [
      document.createTextNode("Play the Challenge"),
    ]);
    playBtn.addEventListener("click", startGame);
    card.appendChild(playBtn);

    root.appendChild(card);
  }

  function startGame() {
    gameState = Engine.initialState(newSeed());
    pendingChoice = null;
    track("game_started");
    renderRound();
  }

  // ---------------- Round screen ----------------
  function renderRound() {
    if (busy) return;
    root.innerHTML = "";
    var scenario = Engine.scenarioForRound(gameState.seed, gameState.round);
    var totalRounds = Engine.ROUNDS.length;

    var wrap = el("div", { class: "game-round" });

    // Progress + dashboard
    var progress = el("div", { class: "game-progress" }, [
      el("p", { class: "eyebrow mt-0", text: "Week " + (gameState.round + 1) + " of " + totalRounds }),
    ]);
    var track_ = el("div", { class: "game-progress__track" });
    var fill = el("div", { class: "game-progress__fill" });
    fill.style.width = Math.round((gameState.round / totalRounds) * 100) + "%";
    track_.appendChild(fill);
    progress.appendChild(track_);
    wrap.appendChild(progress);

    var dashboard = el("div", { class: "game-dashboard grid grid--2" }, [
      el("div", { class: "game-stat" }, [
        el("span", { class: "game-stat__label", text: "Flexible budget remaining" }),
        el("span", { class: "game-stat__value" + (gameState.flexibleBudget < 0 ? " is-negative" : ""), text: fmtRand(gameState.flexibleBudget) }),
      ]),
      el("div", { class: "game-stat" }, [
        el("span", { class: "game-stat__label", text: "Emergency buffer" }),
        el("span", { class: "game-stat__value" + (gameState.buffer < 0 ? " is-negative" : ""), text: fmtRand(gameState.buffer) }),
      ]),
    ]);
    wrap.appendChild(dashboard);

    // Scenario card
    var card = el("div", { class: "card game-scenario" });
    card.appendChild(el("h2", { text: scenario.title }));
    card.appendChild(el("p", { text: scenario.prompt }));

    var choiceList = el("div", { class: "stack game-choice-list", role: "group", "aria-label": "Your options" });
    scenario.choices.forEach(function (choice) {
      var btn = el("button", {
        type: "button",
        class: "game-choice",
        "data-choice-id": choice.id,
        "aria-pressed": "false",
      });
      btn.appendChild(el("span", { class: "game-choice__label", text: choice.label }));
      btn.appendChild(el("span", { class: "game-choice__preview", text: choice.preview }));
      btn.addEventListener("click", function () {
        selectChoice(scenario, choice, wrap, card, choiceList);
      });
      choiceList.appendChild(btn);
    });
    card.appendChild(choiceList);

    var confirmArea = el("div", { class: "game-confirm-area", "data-confirm-area": "" });
    card.appendChild(confirmArea);

    wrap.appendChild(card);
    root.appendChild(wrap);
    focusHeading(wrap);
  }

  function selectChoice(scenario, choice, wrap, card, choiceList) {
    if (busy) return;
    pendingChoice = { scenario: scenario, choice: choice };

    // Mark the selected button, keep the rest visible but clearly inactive.
    Array.prototype.forEach.call(choiceList.querySelectorAll(".game-choice"), function (btn) {
      var isSelected = btn.getAttribute("data-choice-id") === choice.id;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    var confirmArea = card.querySelector("[data-confirm-area]");
    confirmArea.innerHTML = "";
    var panel = el("div", { class: "game-confirm-panel", role: "status" });
    panel.appendChild(
      el("p", { class: "mt-0", html: "You picked: <strong>" + choice.label + "</strong> — " + choice.preview + "." })
    );
    var actions = el("div", { class: "cluster" });
    var confirmBtn = el("button", { type: "button", class: "btn btn-gold" }, [document.createTextNode("Confirm this choice")]);
    var backBtn = el("button", { type: "button", class: "btn btn-outline" }, [document.createTextNode("Choose differently")]);
    confirmBtn.addEventListener("click", function () {
      confirmChoice(wrap, card);
    });
    backBtn.addEventListener("click", function () {
      pendingChoice = null;
      confirmArea.innerHTML = "";
      Array.prototype.forEach.call(choiceList.querySelectorAll(".game-choice"), function (btn) {
        btn.classList.remove("is-selected");
        btn.setAttribute("aria-pressed", "false");
      });
    });
    actions.appendChild(confirmBtn);
    actions.appendChild(backBtn);
    panel.appendChild(actions);
    confirmArea.appendChild(panel);
    confirmBtn.focus();
  }

  function confirmChoice(wrap, card) {
    if (busy || !pendingChoice) return;
    busy = true;
    var scenario = pendingChoice.scenario;
    var choice = pendingChoice.choice;

    var previousFlexible = gameState.flexibleBudget;
    var previousBuffer = gameState.buffer;
    gameState = Engine.applyChoice(gameState, scenario.id, choice.id);
    var entry = gameState.log[gameState.log.length - 1];
    pendingChoice = null;

    // Replace the scenario card content with the outcome, then a Continue
    // button — never silently jump to the next round without feedback.
    var choiceList = card.querySelector(".game-choice-list");
    var confirmArea = card.querySelector("[data-confirm-area]");
    if (choiceList) choiceList.setAttribute("aria-hidden", "true");
    choiceList.querySelectorAll("button").forEach(function (btn) {
      btn.disabled = true;
    });
    confirmArea.innerHTML = "";

    var outcome = el("div", { class: "game-outcome", role: "status" });
    outcome.appendChild(el("p", { class: "mt-0", html: "<strong>" + choice.label + "</strong>" }));
    outcome.appendChild(el("p", { text: choice.explanation }));

    var changes = [];
    if (entry.flexibleDelta !== 0) {
      changes.push((entry.flexibleDelta > 0 ? "+" : "") + fmtRand(entry.flexibleDelta) + " flexible budget");
    }
    if (entry.bufferDelta !== 0) {
      changes.push((entry.bufferDelta > 0 ? "+" : "") + fmtRand(entry.bufferDelta) + " emergency buffer");
    }
    if (changes.length) {
      outcome.appendChild(el("p", { class: "game-outcome__delta", text: "Change: " + changes.join(", ") }));
    }

    var newBalances = el("p", {
      class: "game-outcome__balances",
      html:
        "Now: flexible budget " +
        fmtRand(gameState.flexibleBudget) +
        (gameState.flexibleBudget !== previousFlexible ? "" : "") +
        " &middot; buffer " +
        fmtRand(gameState.buffer),
    });
    outcome.appendChild(newBalances);

    var isLastRound = Engine.isComplete(gameState);
    var continueBtn = el("button", { type: "button", class: "btn btn-gold" }, [
      document.createTextNode(isLastRound ? "See your results" : "Continue to week " + (gameState.round + 1)),
    ]);
    continueBtn.addEventListener("click", function () {
      busy = false;
      if (isLastRound) {
        renderResults();
      } else {
        renderRound();
      }
    });
    outcome.appendChild(continueBtn);
    confirmArea.appendChild(outcome);
    continueBtn.focus();
  }

  // ---------------- Results screen ----------------
  function buildObservations(summary) {
    var notes = [];
    var usedBuffer = summary.log.some(function (e) {
      return e.bufferDelta < 0;
    });
    var grewBuffer = summary.finalBuffer > summary.startingBuffer && !usedBuffer;
    var hadUnexpected = summary.unexpectedCost > 0;

    if (hadUnexpected) {
      notes.push(
        "An unexpected cost came up this month (" +
          fmtRand(summary.unexpectedCost) +
          " in total) — that's common, which is exactly why having a buffer helps."
      );
    }
    if (usedBuffer) {
      notes.push("You drew on your emergency buffer when something unplanned came up. That's what it's there for — using it isn't a setback.");
    } else if (grewBuffer) {
      notes.push("You grew your emergency buffer this month instead of spending everything available, which gives you more room next time.");
    }
    if (summary.shortfall > 0) {
      notes.push(
        "This month's choices added up to " +
          fmtRand(summary.shortfall) +
          " more than your flexible budget covered. That happens — it's useful information about where the pressure points were, not a verdict on you."
      );
    } else if (notes.length < 2) {
      notes.push("You finished the month with " + fmtRand(summary.remainingFlexible) + " still in your flexible budget.");
    }
    if (notes.length < 2) {
      notes.push("Every choice here was a genuine trade-off — there usually isn't one single “right” answer, only what fits your situation.");
    }
    return notes.slice(0, 3);
  }

  function renderResults() {
    root.innerHTML = "";
    var summary = Engine.summarize(gameState);
    track("game_completed", { outcome: summary.shortfall > 0 ? "shortfall" : "balanced" });

    var wrap = el("div", { class: "game-results" });
    wrap.appendChild(el("h2", { text: "Your month, in numbers" }));
    wrap.appendChild(
      el("p", { text: "Remember: this is a fictional simulation with made-up figures. Nothing here was saved or sent anywhere." })
    );

    var table = el("table", { class: "summary-table" });
    var rows = [
      ["Starting income", fmtRand(summary.income)],
      ["Essential expenses", "−" + fmtRand(summary.essentialExpenses)],
      ["Debt repayments", "−" + fmtRand(summary.debtRepayments)],
      ["Unexpected costs during the month", summary.unexpectedCost > 0 ? "−" + fmtRand(summary.unexpectedCost) : "R0"],
      [summary.shortfall > 0 ? "Shortfall" : "Remaining flexible budget", (summary.shortfall > 0 ? "−" : "") + fmtRand(summary.shortfall > 0 ? summary.shortfall : summary.remainingFlexible)],
      ["Final emergency buffer", fmtRand(summary.finalBuffer)],
    ];
    rows.forEach(function (row) {
      var tr = el("tr", {}, [el("th", { scope: "row", text: row[0] }), el("td", { text: row[1] })]);
      table.appendChild(tr);
    });
    wrap.appendChild(table);

    var resultCard = el("div", {
      class: "card game-result-banner " + (summary.shortfall > 0 ? "game-result-banner--shortfall" : "game-result-banner--ok"),
    });
    resultCard.appendChild(
      el("p", {
        class: "mt-0",
        text:
          summary.shortfall > 0
            ? "This month didn't quite balance — by " + fmtRand(summary.shortfall) + "."
            : "This fictional month balanced, with " + fmtRand(summary.remainingFlexible) + " left over.",
      })
    );
    wrap.appendChild(resultCard);

    var obsHeading = el("h3", { text: "A few observations" });
    wrap.appendChild(obsHeading);
    var obsList = el("ul", { class: "stack mt-0" });
    buildObservations(summary).forEach(function (note) {
      obsList.appendChild(el("li", { text: note }));
    });
    wrap.appendChild(obsList);

    var actions = el("div", { class: "cluster game-results__actions" });
    var restartBtn = el("button", { type: "button", class: "btn btn-gold" }, [document.createTextNode("Try another month")]);
    restartBtn.addEventListener("click", function () {
      startGame();
    });
    actions.appendChild(restartBtn);
    actions.appendChild(
      el("a", { class: "btn btn-outline", href: "/calculator.html" }, [document.createTextNode("Explore our calculators")])
    );
    actions.appendChild(
      el("a", { class: "btn btn-outline", href: "/contact.html" }, [document.createTextNode("Speak to an NDC consultant")])
    );
    wrap.appendChild(actions);

    root.appendChild(wrap);
    focusHeading(wrap);
  }

  renderIntro();
})();
