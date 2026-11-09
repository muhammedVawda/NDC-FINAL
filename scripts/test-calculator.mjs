import { createRequire } from "module";
const require = createRequire(import.meta.url);
const engine = require("../assets/js/budget-engine.js");

let pass = 0;
let fail = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(actual, label) {
  if (actual) pass++;
  else {
    fail++;
    console.error(`FAIL: ${label} (expected truthy, got ${JSON.stringify(actual)})`);
  }
}

// ---------- parseCurrency ----------
assertEqual(engine.parseCurrency("11000").cents, 1100000, "parse plain integer");
assertEqual(engine.parseCurrency("R11 000").cents, 1100000, "parse R + space grouping");
assertEqual(engine.parseCurrency("11,000.50").cents, 1100050, "parse comma-thousands + dot-decimal");
assertEqual(engine.parseCurrency("11.000,50").cents, 1100050, "parse dot-thousands + comma-decimal");
assertEqual(engine.parseCurrency("11000.5").cents, 1100050, "parse single decimal digit");
assertEqual(engine.parseCurrency("  R 1 234,00 ").cents, 123400, "parse padded R with space grouping + comma decimal");
assertEqual(engine.parseCurrency("").cents, 0, "empty string treated as 0");
assertEqual(engine.parseCurrency("").empty, true, "empty string flagged empty");
assertEqual(engine.parseCurrency("0").cents, 0, "explicit zero");
assertEqual(engine.parseCurrency("-500").valid, false, "negative rejected");
assertEqual(engine.parseCurrency("abc").valid, false, "nonnumeric rejected");
assertEqual(engine.parseCurrency("12ab34").valid, false, "mixed alnum rejected");
assertEqual(engine.parseCurrency("1..2").valid, false, "malformed double-dot rejected");
assertTrue(engine.parseCurrency("1500000").large, "value over R1,000,000 flagged large");
assertEqual(engine.parseCurrency("500000").large, false, "value under threshold not flagged");
assertEqual(engine.parseCurrency("513788").cents, 51378800, "parse regression-case expense figure");
assertEqual(engine.formatRands(1100000), "R11 000", "format whole rand with grouping");
assertEqual(engine.formatRands(123450), "R1 234,50", "format with cents");
assertEqual(engine.formatRands(123400), "R1 234", "format whole amount with .00 shows no decimals");
assertEqual(engine.formatRands(-50278800), "-R502 788", "format negative (internal, not user-facing)");

// ---------- computeBudget: known regression from the supplied screenshot ----------
// Income: R11 000. Expenses: R513 788. Must NOT produce a positive
// "available income" or any proposed savings/repayment — only a shortfall.
{
  const parsed = {
    takeHome: engine.parseCurrency("11000"),
    otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("513788"),
    utilities: engine.parseCurrency(""),
    groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""),
    insurance: engine.parseCurrency(""),
    communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""),
    otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""),
    vehicleFinance: engine.parseCurrency(""),
    creditCards: engine.parseCurrency(""),
    storeCards: engine.parseCurrency(""),
    personalLoans: engine.parseCurrency(""),
    otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.incomeCents, 1100000, "regression: income = R11 000");
  assertEqual(result.expenseCents, 51378800, "regression: expenses = R513 788");
  assertEqual(result.availableCents, 1100000 - 51378800, "regression: available income is deeply negative");
  assertTrue(result.availableCents < 0, "regression: available income is negative, not positive");
  assertEqual(result.state, "A", "regression: state must be A (shortfall), never a savings/eligibility state");
  assertTrue(result.availableCents !== 552400 && result.surplusCents !== 371900, "regression: must not reproduce fabricated R5,524 savings / R3,719 repayment");
}

// ---------- State A: expenses exceed income ----------
{
  const parsed = {
    takeHome: engine.parseCurrency("11000"), otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("15000"), utilities: engine.parseCurrency(""), groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""), insurance: engine.parseCurrency(""), communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""), otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""), vehicleFinance: engine.parseCurrency(""), creditCards: engine.parseCurrency(""),
    storeCards: engine.parseCurrency(""), personalLoans: engine.parseCurrency(""), otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.state, "A", "state A: expenses > income");
  assertEqual(result.availableCents, -400000, "state A: available = -R4 000");
}

// ---------- State B: available income exactly zero ----------
{
  const parsed = {
    takeHome: engine.parseCurrency("10000"), otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("10000"), utilities: engine.parseCurrency(""), groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""), insurance: engine.parseCurrency(""), communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""), otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""), vehicleFinance: engine.parseCurrency(""), creditCards: engine.parseCurrency("500"),
    storeCards: engine.parseCurrency(""), personalLoans: engine.parseCurrency(""), otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.state, "B", "state B: available income is exactly zero");
  assertEqual(result.availableCents, 0, "state B: available = 0");
}

// ---------- State C: repayments exceed what's left ----------
{
  const parsed = {
    takeHome: engine.parseCurrency("15000"), otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("10000"), utilities: engine.parseCurrency(""), groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""), insurance: engine.parseCurrency(""), communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""), otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""), vehicleFinance: engine.parseCurrency(""), creditCards: engine.parseCurrency("8000"),
    storeCards: engine.parseCurrency(""), personalLoans: engine.parseCurrency(""), otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.state, "C", "state C: debt repayments exceed remaining budget");
  assertEqual(result.availableCents, 500000, "state C: available = R5 000");
  assertEqual(result.surplusCents, -300000, "state C: shortfall after debts = -R3 000");
}

// ---------- State D: balances with money left over ----------
{
  const parsed = {
    takeHome: engine.parseCurrency("20000"), otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("8000"), utilities: engine.parseCurrency(""), groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""), insurance: engine.parseCurrency(""), communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""), otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""), vehicleFinance: engine.parseCurrency(""), creditCards: engine.parseCurrency("3000"),
    storeCards: engine.parseCurrency(""), personalLoans: engine.parseCurrency(""), otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.state, "D", "state D: surplus remains after debts");
  assertEqual(result.surplusCents, 900000, "state D: surplus = R9 000");
}

// ---------- State E: no debts entered at all ----------
{
  const parsed = {
    takeHome: engine.parseCurrency("20000"), otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("8000"), utilities: engine.parseCurrency(""), groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""), insurance: engine.parseCurrency(""), communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""), otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""), vehicleFinance: engine.parseCurrency(""), creditCards: engine.parseCurrency(""),
    storeCards: engine.parseCurrency(""), personalLoans: engine.parseCurrency(""), otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.state, "E", "state E: no debt repayments entered");
  assertEqual(result.debtCents, 0, "state E: debt total is zero");
  assertEqual(result.availableCents, 1200000, "state E: available = R12 000, shown as summary only");
}

// ---------- Zero income, zero debts ----------
{
  const parsed = {
    takeHome: engine.parseCurrency("0"), otherIncome: engine.parseCurrency(""),
    housing: engine.parseCurrency("0"), utilities: engine.parseCurrency(""), groceries: engine.parseCurrency(""),
    transport: engine.parseCurrency(""), insurance: engine.parseCurrency(""), communication: engine.parseCurrency(""),
    educationChildcare: engine.parseCurrency(""), otherExpenses: engine.parseCurrency(""),
    homeLoan: engine.parseCurrency(""), vehicleFinance: engine.parseCurrency(""), creditCards: engine.parseCurrency(""),
    storeCards: engine.parseCurrency(""), personalLoans: engine.parseCurrency(""), otherDebt: engine.parseCurrency(""),
  };
  const result = engine.computeBudget(parsed);
  assertEqual(result.state, "B", "zero income + zero expenses: available is exactly 0 -> state B");
}

// ---------------------------------------------------------------------------
// estimateSimple: the live three-figure calculator (take-home / living / debt).
// Every expected value below was worked out by hand, not by running the code:
//   rands x 100 = cents; surplus = income - living - debt; percent = debt/income x 100.
// ---------------------------------------------------------------------------
{
  const c = (rands) => engine.parseCurrency(String(rands)).cents; // cents via the real parser
  const est = (i, l, d) => engine.estimateSimple(c(i), c(l), c(d));

  // The reference case from the brief: R15 000 / R8 000 / R9 000.
  //   left = 15000-8000 = 7000;  surplus = 7000-9000 = -2000;  9000/15000 = 60%.
  let r = est(15000, 8000, 9000);
  assertEqual(engine.formatRands(r.leftAfterLivingCents), "R7 000", "ref case: left after living costs R7 000");
  assertEqual(r.debtPercent, 60, "ref case: debt is 60% of income");
  assertEqual(engine.formatRands(r.surplusCents), "-R2 000", "ref case: shortfall -R2 000");
  assertEqual(r.state, "shortfall", "ref case: shortfall state");

  // Second reference: R20 000 / R10 000 / R12 000 -> left 10 000, surplus -2 000, 60%.
  r = est(20000, 10000, 12000);
  assertEqual([r.leftAfterLivingCents, r.surplusCents, r.debtPercent, r.state], [1000000, -200000, 60, "shortfall"], "R20k/R10k/R12k");

  // Tight: less than 10% of income left AFTER repayments.
  //   20000-10000-9000 = 1000 left = 5% of 20000.  9000/20000 = 45%.
  r = est(20000, 10000, 9000);
  assertEqual([r.surplusCents, r.debtPercent, r.state], [100000, 45, "tight"], "5% left is tight");

  // Boundary: exactly 10% is ok, one cent less is tight.
  //   10000-5000-4000 = 1000 = exactly 10% of 10000.  4000/10000 = 40%.
  r = est(10000, 5000, 4000);
  assertEqual([r.surplusCents, r.debtPercent, r.state], [100000, 40, "ok"], "exactly 10% left is ok");
  r = engine.estimateSimple(1000000, 500000, 400001); // 1 cent more debt: surplus 99 999 cents = 9.9999%
  assertEqual(r.state, "tight", "one cent under 10% is tight");

  // Exactly nothing left is tight (not shortfall): 10000-6000-4000 = 0.
  r = est(10000, 6000, 4000);
  assertEqual([r.surplusCents, r.state], [0, "tight"], "zero left is tight, not shortfall");

  // No debt entered: all of what is left after living costs is surplus; 0%.
  r = est(15000, 8000, 0);
  assertEqual([r.surplusCents, r.debtPercent, r.state], [700000, 0, "ok"], "no repayments -> ok, 0%");

  // Living costs above income: negative 'left' and a shortfall even with no debt.
  r = est(5000, 6000, 0);
  assertEqual([r.leftAfterLivingCents, r.surplusCents, r.state], [-100000, -100000, "shortfall"], "living > income is a shortfall");

  // Nothing entered, and zero income with repayments (percent undefined, never NaN).
  r = est(0, 0, 0);
  assertEqual([r.state, r.debtPercent], ["empty", null], "all zero -> empty, no percentage");
  r = est(0, 0, 500);
  assertEqual([r.state, r.debtPercent, r.surplusCents], ["shortfall", null, -50000], "zero income with repayments -> shortfall, percent null");

  // Decimals and pasted/formatted values go through the real parser first.
  //   "R15 000,50" = 1 500 050 cents; living "8 000.25" = 800 025; left = 700 025 -> "R7 000,25".
  r = engine.estimateSimple(c("R15 000,50"), c("8 000.25"), c("9 000"));
  assertEqual(engine.formatRands(r.leftAfterLivingCents), "R7 000,25", "decimal left after living costs");
  assertEqual(r.debtPercent, 60, "decimal inputs: 900 000 / 1 500 050 = 59.998% rounds to 60");

  // Rounding: 100 cents of 800 = 12.5% rounds half up to 13.
  assertEqual(engine.estimateSimple(800, 0, 100).debtPercent, 13, "12.5% rounds half up to 13");

  // Large figures stay exact integers (no float drift).
  r = est(9999999, 1, 1);
  assertEqual(r.surplusCents, (9999999 - 1 - 1) * 100, "large amounts stay exact");

  // Garbage in must never produce NaN out.
  r = engine.estimateSimple(undefined, null, "abc");
  assertTrue([r.leftAfterLivingCents, r.surplusCents].every(Number.isFinite) && r.state === "empty", "undefined/null/garbage are treated as 0");

  // Parser edge cases feeding the calculator.
  assertEqual(engine.parseCurrency("").empty, true, "blank is empty, not invalid");
  assertEqual(engine.parseCurrency("0").cents, 0, "zero parses to 0 cents");
  assertEqual(engine.parseCurrency("-500").valid, false, "negative is rejected");
  assertEqual(engine.parseCurrency("abc").valid, false, "text is rejected");
  assertEqual(engine.parseCurrency("R 15 000").cents, 1500000, "R prefix and spaces accepted");
  assertEqual(engine.parseCurrency("15,000.50").cents, 1500050, "comma thousands with decimals");
  assertEqual(engine.parseCurrency("15000.5").cents, 1500050, "one decimal digit");
  assertEqual(engine.formatRands(-200000), "-R2 000", "negative formatting");
  assertEqual(engine.formatRands(1850000), "R18 500", "R18 500 style separators");
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
