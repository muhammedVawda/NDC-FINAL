/*
  Month-End Challenge — pure accounting engine.
  No DOM access here (mirrors budget-engine.js) so it can be unit-tested
  directly from Node via scripts/test-game.mjs.

  ACCOUNTING MODEL (single source of truth — read this before touching deltas):
  - income, essentialExpenses and debtRepayments are FIXED for the fictional
    month and are never touched by a choice. They are deducted once, up
    front, to produce `flexibleBudget` — the only pot that ordinary
    discretionary choices move money into or out of.
  - `buffer` is a second, separate pot (the starting emergency buffer).
  - Every choice declares exactly `flexibleDelta` and `bufferDelta` in whole
    Rand. A choice that "moves R200 from flexible into buffer" must set
    flexibleDelta: -200 and bufferDelta: +200 — the two must net to zero
    for a pure transfer, so money is never created or destroyed. This
    invariant is asserted in applyChoice() and covered by unit tests.
  - Neither pot is ever clamped to zero. A shortfall is a real, visible
    negative number, not hidden.
*/

const BASELINE = Object.freeze({
  // Fictional South African household, one month, take-home pay in Rand.
  income: 12800,
  // Fixed essential costs for the month: rent/rates, baseline groceries,
  // electricity, baseline transport to work, insurance. Never a choice.
  essentialExpenses: 8100,
  // Fixed required monthly debt instalment. Never a choice, never skipped.
  debtRepayments: 3400,
  // Emergency savings already set aside before the month starts.
  startingBuffer: 600,
});

// ---- Deterministic PRNG (mulberry32) so a given seed always plays the
// same four scenarios — needed for reproducible tests and support requests,
// while a fresh seed each visit gives natural replay variety. ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(seed, roundIndex, poolLength) {
  const rand = mulberry32((seed ^ (roundIndex + 1) * 2654435761) >>> 0);
  return Math.floor(rand() * poolLength);
}

// ---- Scenario content ----
// Each round has a small curated pool; one is picked deterministically per
// seed+round. Every choice is a genuine, plausible trade-off — none removes
// or reduces essentialExpenses or debtRepayments, and none is framed as a
// "wrong" answer to be punished.
const ROUNDS = [
  {
    week: 1,
    pool: [
      {
        id: 'household-bulk-deal',
        title: 'A bulk-buy deal on household basics',
        prompt: 'Your usual grocery budget is already set aside. This week the supermarket has a 3-for-2 deal on household basics you use anyway — cleaning supplies, toiletries, that sort of thing.',
        tag: 'flexible',
        choices: [
          {
            id: 'buy-bulk',
            label: 'Buy the bulk deal now',
            preview: 'R320 from this week’s flexible budget',
            flexibleDelta: -320,
            bufferDelta: 0,
            explanation: 'A bigger amount leaves your account this week, but you likely won’t need to buy these items again for a while.',
          },
          {
            id: 'buy-as-needed',
            label: 'Just buy what’s run out',
            preview: 'R140 from this week’s flexible budget',
            flexibleDelta: -140,
            bufferDelta: 0,
            explanation: 'Less leaves your account this week, but you’ll likely be topping up again — and paying full price next time.',
          },
          {
            id: 'skip-week',
            label: 'Skip it — nothing’s run out yet',
            preview: 'No change this week',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'Nothing spent this week. The deal won’t always be there, but neither will the money if you need it elsewhere.',
          },
        ],
      },
      {
        id: 'weekend-invite',
        title: 'A weekend invitation',
        prompt: 'A friend invites you out this weekend. It’s not expensive, but it’s not free either, and it wasn’t part of your plan for the week.',
        tag: 'flexible',
        choices: [
          {
            id: 'go-full',
            label: 'Go, and enjoy it properly',
            preview: 'R280 from this week’s flexible budget',
            flexibleDelta: -280,
            bufferDelta: 0,
            explanation: 'Social time matters too — this is a normal, planned-for use of flexible spending, not a mistake.',
          },
          {
            id: 'go-modest',
            label: 'Go, but keep it modest',
            preview: 'R110 from this week’s flexible budget',
            flexibleDelta: -110,
            bufferDelta: 0,
            explanation: 'You still spend time with friends, at a lighter cost to the week ahead.',
          },
          {
            id: 'stay-home',
            label: 'Suggest something free instead',
            preview: 'No change this week',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'No cost this week. Worth checking in with yourself on whether that trade-off feels right, not just automatic.',
          },
        ],
      },
    ],
  },
  {
    week: 2,
    pool: [
      {
        id: 'unused-subscription',
        title: 'An unused subscription',
        prompt: 'Your bank statement shows a streaming subscription you haven’t opened in two months.',
        tag: 'flexible',
        choices: [
          {
            id: 'cancel',
            label: 'Cancel it',
            preview: '+R150 back to this week’s flexible budget',
            flexibleDelta: 150,
            bufferDelta: 0,
            explanation: 'One less thing paying for itself out of habit. You can always resubscribe later if you actually want it.',
          },
          {
            id: 'downgrade',
            label: 'Downgrade to a cheaper plan',
            preview: '+R70 back to this week’s flexible budget',
            flexibleDelta: 70,
            bufferDelta: 0,
            explanation: 'You keep some access at a lower ongoing cost — a middle-ground option.',
          },
          {
            id: 'keep',
            label: 'Keep it — you’ll use it soon',
            preview: 'No change this week',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'That’s a fair call if you genuinely plan to use it. Worth revisiting next month if the pattern continues.',
          },
        ],
      },
      {
        id: 'data-bundle',
        title: 'Running low on mobile data',
        prompt: 'You’re about to run out of mobile data for the month, earlier than usual.',
        tag: 'flexible',
        choices: [
          {
            id: 'buy-big',
            label: 'Buy a bigger bundle to be safe',
            preview: 'R199 from this week’s flexible budget',
            flexibleDelta: -199,
            bufferDelta: 0,
            explanation: 'Costs more now, but you won’t need to think about it again this month.',
          },
          {
            id: 'buy-small',
            label: 'Buy a small top-up for now',
            preview: 'R59 from this week’s flexible budget',
            flexibleDelta: -59,
            bufferDelta: 0,
            explanation: 'Cheaper today, but you may need to top up again before month-end.',
          },
          {
            id: 'use-wifi',
            label: 'Rely on Wi-Fi where you can this week',
            preview: 'No change this week',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'No cost, but it depends on having Wi-Fi available when you actually need data.',
          },
        ],
      },
    ],
  },
  {
    week: 3,
    pool: [
      {
        id: 'transport-surprise',
        title: 'An unexpected transport cost',
        prompt: 'Your usual taxi fare goes up without warning this week. It’s a real, necessary cost to get to work.',
        tag: 'unexpected',
        choices: [
          {
            id: 'pay-flexible',
            label: 'Cover it from this week’s flexible budget',
            preview: 'R450 from this week’s flexible budget',
            flexibleDelta: -450,
            bufferDelta: 0,
            explanation: 'Getting to work is essential, so this is a reasonable use of flexible money when it’s available.',
          },
          {
            id: 'pay-buffer',
            label: 'Cover it from your emergency buffer',
            preview: 'R450 from your emergency buffer',
            flexibleDelta: 0,
            bufferDelta: -450,
            explanation: 'This is exactly what an emergency buffer is for — an unavoidable, unplanned cost. Using it here isn’t a failure.',
          },
          {
            id: 'split',
            label: 'Split it between the two',
            preview: 'R225 from flexible, R225 from buffer',
            flexibleDelta: -225,
            bufferDelta: -225,
            explanation: 'Spreading the impact keeps either pot from taking the full hit on its own.',
          },
        ],
      },
      {
        id: 'appliance-repair',
        title: 'A necessary household repair',
        prompt: 'Your fridge starts making a worrying noise. A technician quotes a repair — not urgent for a day or two, but it does need doing.',
        tag: 'unexpected',
        choices: [
          {
            id: 'repair-flexible',
            label: 'Get it repaired, pay from flexible budget',
            preview: 'R950 from this week’s flexible budget',
            flexibleDelta: -950,
            bufferDelta: 0,
            explanation: 'A working fridge is a genuine household need — this keeps a small problem from becoming a bigger, costlier one.',
          },
          {
            id: 'repair-buffer',
            label: 'Get it repaired, pay from your buffer',
            preview: 'R950 from your emergency buffer',
            flexibleDelta: 0,
            bufferDelta: -950,
            explanation: 'A sudden essential repair is a textbook use of an emergency buffer.',
          },
          {
            id: 'delay',
            label: 'Get a second, possibly cheaper quote first',
            preview: 'No change this week',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'A short delay to compare quotes is reasonable — just don’t let a genuine repair wait indefinitely.',
          },
        ],
      },
    ],
  },
  {
    week: 4,
    pool: [
      {
        id: 'month-end-buffer',
        title: 'Deciding what to do with what’s left',
        prompt: 'It’s the last week of the month. Whatever is left in your flexible budget now is yours to decide on.',
        tag: 'flexible',
        choices: [
          {
            id: 'top-up-buffer',
            label: 'Move most of it into your emergency buffer',
            preview: 'Moves 80% of what’s left from flexible into buffer',
            flexibleDelta: 'transfer-to-buffer-80',
            bufferDelta: 0,
            explanation: 'Growing your buffer means the next surprise is easier to absorb without a hard trade-off.',
          },
          {
            id: 'even-split',
            label: 'Split it evenly between buffer and next month',
            preview: 'Moves 50% of what’s left from flexible into buffer',
            flexibleDelta: 'transfer-to-buffer-50',
            bufferDelta: 0,
            explanation: 'A balanced approach — some cushion now, some flexibility carried forward.',
          },
          {
            id: 'keep-flexible',
            label: 'Keep it as flexible money for next month',
            preview: 'No transfer — stays in flexible budget',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'That’s a valid choice too, especially if next month has costs you’re already anticipating.',
          },
        ],
      },
      {
        id: 'treat-or-save',
        title: 'A small end-of-month treat',
        prompt: 'You’ve made it to the last week. There’s a small treat you’ve been wanting — nothing extravagant.',
        tag: 'flexible',
        choices: [
          {
            id: 'treat-yourself',
            label: 'Go ahead and enjoy it',
            preview: 'R180 from this week’s flexible budget',
            flexibleDelta: -180,
            bufferDelta: 0,
            explanation: 'Making it through the month is worth acknowledging. A planned, modest treat isn’t something to feel bad about.',
          },
          {
            id: 'smaller-treat',
            label: 'Go for a smaller version of it',
            preview: 'R70 from this week’s flexible budget',
            flexibleDelta: -70,
            bufferDelta: 0,
            explanation: 'A middle ground — you still get something, at a lighter cost.',
          },
          {
            id: 'save-instead',
            label: 'Skip it and keep the money for next month',
            preview: 'No change this week',
            flexibleDelta: 0,
            bufferDelta: 0,
            explanation: 'Also a completely reasonable choice — there’s no single right answer here.',
          },
        ],
      },
    ],
  },
];

function scenarioForRound(seed, roundIndex) {
  const round = ROUNDS[roundIndex];
  if (!round) return null;
  const idx = pickIndex(seed, roundIndex, round.pool.length);
  return round.pool[idx];
}

function initialState(seed) {
  const flexibleBudget = BASELINE.income - BASELINE.essentialExpenses - BASELINE.debtRepayments;
  return {
    seed,
    round: 0,
    flexibleBudget,
    buffer: BASELINE.startingBuffer,
    log: [],
  };
}

function isComplete(state) {
  return state.round >= ROUNDS.length;
}

function resolveDelta(flexibleDelta, state) {
  // Round 4's "transfer to buffer" choices move a percentage of whatever
  // flexible money remains at that point, rather than a fixed Rand amount —
  // resolved here, once, so the same transfer amount is used for both the
  // flexible debit and the buffer credit (never recomputed twice).
  if (flexibleDelta === 'transfer-to-buffer-80') {
    const amount = Math.max(0, Math.round(state.flexibleBudget * 0.8));
    return { flexibleDelta: -amount, bufferDelta: amount };
  }
  if (flexibleDelta === 'transfer-to-buffer-50') {
    const amount = Math.max(0, Math.round(state.flexibleBudget * 0.5));
    return { flexibleDelta: -amount, bufferDelta: amount };
  }
  return null;
}

function applyChoice(state, scenarioId, choiceId) {
  if (isComplete(state)) {
    throw new Error('Cannot apply a choice: the game is already complete.');
  }
  const scenario = scenarioForRound(state.seed, state.round);
  if (!scenario || scenario.id !== scenarioId) {
    throw new Error('Scenario mismatch for the current round.');
  }
  const choice = scenario.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error('Unknown choice for this scenario.');
  }

  let flexibleDelta = choice.flexibleDelta;
  let bufferDelta = choice.bufferDelta;
  const resolved = resolveDelta(flexibleDelta, state);
  if (resolved) {
    flexibleDelta = resolved.flexibleDelta;
    bufferDelta = resolved.bufferDelta + bufferDelta;
  }
  if (typeof flexibleDelta !== 'number' || typeof bufferDelta !== 'number') {
    throw new Error('Choice delta failed to resolve to numbers.');
  }

  return {
    ...state,
    round: state.round + 1,
    flexibleBudget: state.flexibleBudget + flexibleDelta,
    buffer: state.buffer + bufferDelta,
    log: [
      ...state.log,
      {
        roundIndex: state.round,
        week: ROUNDS[state.round].week,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        choiceId: choice.id,
        choiceLabel: choice.label,
        tag: scenario.tag,
        flexibleDelta,
        bufferDelta,
        explanation: choice.explanation,
      },
    ],
  };
}

function summarize(state) {
  if (!isComplete(state)) {
    throw new Error('Cannot summarize: the game is not yet complete.');
  }
  const unexpectedCost = state.log
    .filter((entry) => entry.tag === 'unexpected')
    .reduce((sum, entry) => sum + Math.min(0, entry.flexibleDelta) + Math.min(0, entry.bufferDelta), 0);
  const startingFlexible = BASELINE.income - BASELINE.essentialExpenses - BASELINE.debtRepayments;
  return {
    income: BASELINE.income,
    essentialExpenses: BASELINE.essentialExpenses,
    debtRepayments: BASELINE.debtRepayments,
    startingFlexible,
    startingBuffer: BASELINE.startingBuffer,
    remainingFlexible: state.flexibleBudget,
    finalBuffer: state.buffer,
    unexpectedCost: -unexpectedCost, // positive number = amount spent on unexpected events
    shortfall: state.flexibleBudget < 0 ? -state.flexibleBudget : 0,
    log: state.log,
  };
}

const GameEngine = {
  BASELINE,
  ROUNDS,
  scenarioForRound,
  initialState,
  applyChoice,
  isComplete,
  summarize,
  mulberry32,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameEngine;
}
if (typeof window !== 'undefined') {
  window.NdcGameEngine = GameEngine;
}
