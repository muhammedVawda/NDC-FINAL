/*
  Budget & Debt Calculator — pure calculation engine.
  No DOM access here on purpose, so this file can be loaded both in the
  browser (calculator.js drives the UI with it) and in Node for the
  automated test harness in scripts/test-calculator.mjs.

  All money is handled as INTEGER CENTS internally to avoid floating point
  currency errors. Only convert to/from decimal Rand at the input/output
  boundary (parseCurrency / formatRands).
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NDCBudgetEngine = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LARGE_VALUE_THRESHOLD_CENTS = 100000000; // R1,000,000 — flag for confirmation, never clamp

  /**
   * Parse a user-typed currency string into integer cents.
   * Accepts: "R11 000", "11,000.50", "11000.5", "11.000,50", pasted values
   * with stray spaces, an empty string (treated as 0 / not provided).
   * Rejects negative numbers and anything non-numeric.
   */
  function parseCurrency(raw) {
    if (raw === null || raw === undefined) raw = "";
    var str = String(raw).trim();

    if (str === "") {
      return { valid: true, empty: true, cents: 0, large: false };
    }

    // Strip a leading currency symbol (R / ZAR) and surrounding space.
    str = str.replace(/^(ZAR|R)\s*/i, "");

    if (/-/.test(str)) {
      return { valid: false, empty: false, cents: null, large: false, reason: "negative" };
    }

    // Collapse internal whitespace (used as a thousands grouping, e.g. "11 000").
    var stripped = str.replace(/\s+/g, "");

    if (stripped === "") {
      return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
    }

    if (!/^[0-9.,]+$/.test(stripped)) {
      return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
    }

    var dotCount = (stripped.match(/\./g) || []).length;
    var commaCount = (stripped.match(/,/g) || []).length;
    var normalized = null;

    // Validate that `intPart` is either plain digits, or digits grouped in
    // threes by `groupSep` (e.g. "11.000.000"). Rejects malformed grouping
    // like "1..2" or "1.23.456" instead of silently stripping it.
    function validGrouping(intPart, groupSep) {
      if (intPart === "") return false;
      if (/^[0-9]+$/.test(intPart)) return true;
      var esc = groupSep === "." ? "\\." : ",";
      var re = new RegExp("^[0-9]{1,3}(" + esc + "[0-9]{3})+$");
      return re.test(intPart);
    }

    if (dotCount > 0 && commaCount > 0) {
      var lastDot = stripped.lastIndexOf(".");
      var lastComma = stripped.lastIndexOf(",");
      var decimalSep = lastDot > lastComma ? "." : ",";
      var groupSep = decimalSep === "." ? "," : ".";
      var splitAt = Math.max(lastDot, lastComma);
      var intPart = stripped.slice(0, splitAt).split(groupSep).join("");
      var fracPart = stripped.slice(splitAt + 1);
      var rawIntPart = stripped.slice(0, splitAt);
      if (!validGrouping(rawIntPart, groupSep) || !/^[0-9]{1,2}$/.test(fracPart)) {
        return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
      }
      normalized = (intPart || "0") + "." + fracPart;
    } else if (commaCount > 0) {
      var afterLastComma = stripped.slice(stripped.lastIndexOf(",") + 1);
      if (commaCount === 1 && afterLastComma.length === 2 && /^[0-9]{2}$/.test(afterLastComma)) {
        var beforeComma = stripped.slice(0, stripped.lastIndexOf(","));
        if (!/^[0-9]+$/.test(beforeComma)) {
          return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
        }
        normalized = (beforeComma || "0") + "." + afterLastComma;
      } else {
        if (!validGrouping(stripped, ",")) {
          return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
        }
        normalized = stripped.split(",").join("");
      }
    } else if (dotCount > 0) {
      var afterLastDot = stripped.slice(stripped.lastIndexOf(".") + 1);
      if (dotCount === 1 && afterLastDot.length <= 2) {
        var beforeDot = stripped.slice(0, stripped.lastIndexOf("."));
        if (!/^[0-9]*$/.test(beforeDot) || !/^[0-9]*$/.test(afterLastDot)) {
          return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
        }
        normalized = (beforeDot || "0") + "." + (afterLastDot || "0");
      } else {
        if (!validGrouping(stripped, ".")) {
          return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
        }
        normalized = stripped.split(".").join("");
      }
    } else {
      normalized = stripped;
    }

    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(normalized)) {
      return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
    }

    var parts = normalized.split(".");
    var wholePart = parts[0] || "0";
    var fracPart = (parts[1] || "").padEnd(2, "0").slice(0, 2);
    var cents = parseInt(wholePart, 10) * 100 + parseInt(fracPart || "0", 10);

    if (!Number.isFinite(cents) || Number.isNaN(cents)) {
      return { valid: false, empty: false, cents: null, large: false, reason: "nonnumeric" };
    }

    return {
      valid: true,
      empty: false,
      cents: cents,
      large: cents > LARGE_VALUE_THRESHOLD_CENTS,
    };
  }

  /** Format integer cents as a South African Rand amount, e.g. 1100000 -> "R11 000". */
  function formatRands(cents) {
    var sign = cents < 0 ? "-" : "";
    var abs = Math.abs(Math.round(cents));
    var whole = Math.floor(abs / 100);
    var remainder = abs % 100;
    var wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    var out = "R" + wholeStr;
    if (remainder !== 0) {
      out += "," + String(remainder).padStart(2, "0");
    }
    return sign + out;
  }

  var INCOME_FIELDS = ["takeHome", "otherIncome"];
  var EXPENSE_FIELDS = [
    "housing",
    "utilities",
    "groceries",
    "transport",
    "insurance",
    "communication",
    "educationChildcare",
    "otherExpenses",
  ];
  var DEBT_FIELDS = [
    "homeLoan",
    "vehicleFinance",
    "creditCards",
    "storeCards",
    "personalLoans",
    "otherDebt",
  ];

  /**
   * Sum a set of already-parsed field results (see parseCurrency) into a
   * total in cents, treating empty/blank fields as 0.
   */
  function sumFields(parsedByField, fieldNames) {
    var total = 0;
    fieldNames.forEach(function (name) {
      var parsed = parsedByField[name];
      if (parsed && parsed.valid && !parsed.empty) total += parsed.cents;
    });
    return total;
  }

  /**
   * Core calculation. Takes an object of { fieldName: parseCurrency-result }
   * for every income/expense/debt field and returns totals plus the result
   * state (A–E) per the calculator specification.
   */
  function computeBudget(parsedByField) {
    var incomeCents = sumFields(parsedByField, INCOME_FIELDS);
    var expenseCents = sumFields(parsedByField, EXPENSE_FIELDS);
    var debtCents = sumFields(parsedByField, DEBT_FIELDS);

    var availableCents = incomeCents - expenseCents; // I - E
    var surplusCents = availableCents - debtCents; // I - E - D

    var state;
    if (availableCents < 0) {
      state = "A"; // essential expenses exceed income
    } else if (availableCents === 0) {
      state = "B"; // nothing left before debt repayments
    } else if (debtCents === 0) {
      state = "E"; // no debt repayments entered
    } else if (surplusCents < 0) {
      state = "C"; // repayments exceed what's left
    } else {
      state = "D"; // balances, with a remaining amount
    }

    return {
      incomeCents: incomeCents,
      expenseCents: expenseCents,
      debtCents: debtCents,
      availableCents: availableCents,
      surplusCents: surplusCents,
      state: state,
    };
  }

  return {
    parseCurrency: parseCurrency,
    formatRands: formatRands,
    computeBudget: computeBudget,
    INCOME_FIELDS: INCOME_FIELDS,
    EXPENSE_FIELDS: EXPENSE_FIELDS,
    DEBT_FIELDS: DEBT_FIELDS,
    LARGE_VALUE_THRESHOLD_CENTS: LARGE_VALUE_THRESHOLD_CENTS,
  };
});
