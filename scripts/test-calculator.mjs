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

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
