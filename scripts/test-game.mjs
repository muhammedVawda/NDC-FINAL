import { createRequire } from "module";
const require = createRequire(import.meta.url);
const engine = require("../assets/js/game-engine.js");

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

// ---------- Baseline / initial state ----------
const s0 = engine.initialState(42);
assertEqual(s0.round, 0, "initial round is 0");
assertEqual(
  s0.flexibleBudget,
  engine.BASELINE.income - engine.BASELINE.essentialExpenses - engine.BASELINE.debtRepayments,
  "initial flexible budget = income - essentials - debt, exactly"
);
assertEqual(s0.buffer, engine.BASELINE.startingBuffer, "initial buffer = starting buffer");
assertEqual(engine.isComplete(s0), false, "fresh game is not complete");

// ---------- Determinism: same seed always yields the same 4 scenarios ----------
const seedA1 = [0, 1, 2, 3].map((i) => engine.scenarioForRound(777, i).id);
const seedA2 = [0, 1, 2, 3].map((i) => engine.scenarioForRound(777, i).id);
assertEqual(seedA1, seedA2, "same seed produces the same scenario sequence every time");

// Different seeds *can* diverge (not a strict guarantee for any two seeds,
// but across a spread of seeds we should see more than one distinct
// week-1 scenario, proving the pool is actually being used for variety).
const week1Ids = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => engine.scenarioForRound(seed, 0).id));
assertTrue(week1Ids.size > 1, "different seeds produce more than one distinct week-1 scenario (replay variety)");

// ---------- Playing a full game: no double-counting ----------
function playSeedTakingFirstChoiceEveryRound(seed) {
  let state = engine.initialState(seed);
  while (!engine.isComplete(state)) {
    const scenario = engine.scenarioForRound(state.seed, state.round);
    const choice = scenario.choices[0];
    state = engine.applyChoice(state, scenario.id, choice.id);
  }
  return state;
}

const played = playSeedTakingFirstChoiceEveryRound(42);
assertEqual(engine.isComplete(played), true, "game completes after 4 rounds");
assertEqual(played.log.length, 4, "log has exactly one entry per round");

// Reconstruct totals independently from the log and verify they match the
// running state exactly — this is the core "no double-counting" check.
const sumFlexibleDeltas = played.log.reduce((sum, e) => sum + e.flexibleDelta, 0);
const sumBufferDeltas = played.log.reduce((sum, e) => sum + e.bufferDelta, 0);
assertEqual(
  played.flexibleBudget,
  engine.BASELINE.income - engine.BASELINE.essentialExpenses - engine.BASELINE.debtRepayments + sumFlexibleDeltas,
  "final flexible budget equals starting flexible budget plus the sum of logged flexible deltas (no leakage)"
);
assertEqual(
  played.buffer,
  engine.BASELINE.startingBuffer + sumBufferDeltas,
  "final buffer equals starting buffer plus the sum of logged buffer deltas (no leakage)"
);

// ---------- Essentials and debt are never touched by any choice, ever ----------
for (let roundIndex = 0; roundIndex < 4; roundIndex++) {
  const round = engine.ROUNDS[roundIndex];
  for (const scenario of round.pool) {
    for (const choice of scenario.choices) {
      assertTrue(
        choice.flexibleDelta === undefined || typeof choice.flexibleDelta === "number" || typeof choice.flexibleDelta === "string",
        `choice "${choice.id}" in scenario "${scenario.id}" has a well-typed flexibleDelta`
      );
    }
  }
}
// essentialExpenses/debtRepayments are constants on BASELINE, not fields on
// state that any applyChoice call can mutate — assert the object is frozen
// and that summarize() always reports the fixed baseline values untouched.
assertTrue(Object.isFrozen(engine.BASELINE), "BASELINE is frozen so essentials/debt can't be mutated at runtime");
const summary = engine.summarize(played);
assertEqual(summary.essentialExpenses, engine.BASELINE.essentialExpenses, "summary essentials always equal the fixed baseline");
assertEqual(summary.debtRepayments, engine.BASELINE.debtRepayments, "summary debt repayments always equal the fixed baseline");

// ---------- Transfer choices (round 4) net to zero across the two pots ----------
{
  // Find a seed whose week-4 scenario is the one with a buffer-transfer
  // choice (the other week-4 pool scenario, "treat-or-save", has none).
  let transferSeed = null;
  for (let seed = 1; seed < 200; seed++) {
    if (engine.scenarioForRound(seed, 3).id === "month-end-buffer") {
      transferSeed = seed;
      break;
    }
  }
  assertTrue(transferSeed !== null, "a seed exists whose week-4 scenario offers a buffer-transfer choice");

  let state = engine.initialState(transferSeed);
  // Play through weeks 1-3 with the first offered choice each time (some
  // round-3 scenarios are genuine unexpected costs with no zero-cost
  // option, by design) so we land on *some* known flexible balance before
  // testing the week-4 transfer invariant against it.
  for (let i = 0; i < 3; i++) {
    const scenario = engine.scenarioForRound(state.seed, state.round);
    state = engine.applyChoice(state, scenario.id, scenario.choices[0].id);
  }
  const beforeTransfer = state.flexibleBudget;
  const scenario4 = engine.scenarioForRound(state.seed, state.round);
  const transferChoice = scenario4.choices.find(
    (c) => c.flexibleDelta === "transfer-to-buffer-80" || c.flexibleDelta === "transfer-to-buffer-50"
  );
  const bufferBefore = state.buffer;
  state = engine.applyChoice(state, scenario4.id, transferChoice.id);
  const entry = state.log[state.log.length - 1];
  assertEqual(
    entry.flexibleDelta + entry.bufferDelta,
    0,
    "a buffer transfer choice nets to exactly zero across flexible + buffer (money moved, not created or destroyed)"
  );
  assertEqual(state.flexibleBudget, beforeTransfer + entry.flexibleDelta, "flexible budget reduced by exactly the transferred amount");
  assertEqual(state.buffer, bufferBefore + entry.bufferDelta, "buffer increased by exactly the transferred amount");
}

// ---------- A genuine shortfall is actually reachable, not just handled in theory ----------
{
  function playPriciest(seed) {
    let state = engine.initialState(seed);
    while (!engine.isComplete(state)) {
      const scenario = engine.scenarioForRound(state.seed, state.round);
      const priciestFlexible = scenario.choices.reduce((worst, c) => {
        const val = typeof c.flexibleDelta === "number" ? c.flexibleDelta : 0;
        const worstVal = typeof worst.flexibleDelta === "number" ? worst.flexibleDelta : 0;
        return val < worstVal ? c : worst;
      }, scenario.choices[0]);
      state = engine.applyChoice(state, scenario.id, priciestFlexible.id);
    }
    return state;
  }

  let shortfallState = null;
  for (let seed = 1; seed < 1000; seed++) {
    const result = playPriciest(seed);
    if (result.flexibleBudget < 0) {
      shortfallState = result;
      break;
    }
  }
  assertTrue(shortfallState !== null, "at least one seed exists where consistently picking the priciest flexible-only choice each round produces a genuine negative balance");
  if (shortfallState) {
    const s = engine.summarize(shortfallState);
    assertTrue(s.shortfall > 0, "summary reports a positive shortfall amount for this path, not manufactured success");
    assertEqual(s.shortfall, -shortfallState.flexibleBudget, "reported shortfall exactly matches the true negative balance");
  }
}

// ---------- Shortfall handling: never clamped, always honest (general case) ----------
{
  let state = engine.initialState(99);
  // Deliberately take the most expensive flexible-budget choice every round.
  while (!engine.isComplete(state)) {
    const scenario = engine.scenarioForRound(state.seed, state.round);
    const priciest = scenario.choices.reduce((worst, c) => {
      const val = typeof c.flexibleDelta === "number" ? c.flexibleDelta : 0;
      const worstVal = typeof worst.flexibleDelta === "number" ? worst.flexibleDelta : 0;
      return val < worstVal ? c : worst;
    }, scenario.choices[0]);
    state = engine.applyChoice(state, scenario.id, priciest.id);
  }
  const s = engine.summarize(state);
  // Whether or not this particular path actually goes negative, the
  // invariant under test is that summarize() reports the *true* signed
  // value, never Math.max(0, ...)-clamped.
  assertEqual(s.remainingFlexible, state.flexibleBudget, "summary remainingFlexible is the true (possibly negative) value, never clamped");
  assertTrue(s.shortfall >= 0, "shortfall is always reported as a non-negative magnitude");
  if (state.flexibleBudget < 0) {
    assertEqual(s.shortfall, -state.flexibleBudget, "shortfall exactly matches the negative flexible budget's magnitude");
  } else {
    assertEqual(s.shortfall, 0, "no shortfall reported when flexible budget is non-negative");
  }
}

// ---------- Invalid transitions are rejected, not silently ignored ----------
{
  let state = engine.initialState(5);
  const scenario = engine.scenarioForRound(state.seed, state.round);
  let threw = false;
  try {
    engine.applyChoice(state, scenario.id, "not-a-real-choice-id");
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, "applying an unknown choice id throws instead of silently no-opping");

  threw = false;
  try {
    engine.applyChoice(state, "wrong-scenario-id", scenario.choices[0].id);
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, "applying a choice against the wrong scenario id throws");

  let complete = state;
  for (let i = 0; i < 4; i++) {
    const sc = engine.scenarioForRound(complete.seed, complete.round);
    complete = engine.applyChoice(complete, sc.id, sc.choices[0].id);
  }
  threw = false;
  try {
    engine.applyChoice(complete, "anything", "anything");
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, "applying a choice after the game is complete throws rather than corrupting state");

  threw = false;
  try {
    engine.summarize(state); // state is not complete yet
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, "summarize() refuses to run before the game is complete");
}

// ---------- Every scenario/choice has the fields the UI depends on ----------
for (let roundIndex = 0; roundIndex < engine.ROUNDS.length; roundIndex++) {
  const round = engine.ROUNDS[roundIndex];
  assertTrue(round.pool.length >= 2, `round ${roundIndex + 1} has at least 2 scenarios in its pool (replay variety)`);
  for (const scenario of round.pool) {
    assertTrue(scenario.choices.length >= 2 && scenario.choices.length <= 3, `scenario "${scenario.id}" has 2-3 choices`);
    for (const choice of scenario.choices) {
      assertTrue(typeof choice.label === "string" && choice.label.length > 0, `choice "${choice.id}" has a label`);
      assertTrue(typeof choice.preview === "string" && choice.preview.length > 0, `choice "${choice.id}" has a rand-impact preview shown before confirming`);
      assertTrue(typeof choice.explanation === "string" && choice.explanation.length > 0, `choice "${choice.id}" has a post-choice explanation`);
    }
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
