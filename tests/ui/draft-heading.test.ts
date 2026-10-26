// The heading over a planning draft follows its cause (#626): the plan page's draft notice
// (ui/plan/CalcWarnings.vue) and the wizard's Review (ui/wizard/ReviewStep.vue) name a budget
// only when the planner measured one, so a stopped search is not called a budget problem.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { carryOptions } from '../../public/state.ts';
import { draftAdvice } from '../../public/app/draft-advice.ts';
import { draftHeading } from '../../public/app/views/calculated.ts';
import { $$, generated, go, open, page } from './setup.ts';
import type { StoredStage } from '../../public/types/index.ts';

const STOPPED =
  'The whole-machine search stopped before it could prove the best plan for this combination. Try fewer alternates or precise balancing; no resource shortage has been established.';

const stages: Record<string, StoredStage> = {
  stopped: { feasible: false, reason: STOPPED },
  recipes: {
    feasible: false,
    reason: 'The selected recipe/power options cannot support this combination.',
  },
  // An older saved plan: a reason sentence and nothing else.
  older: { feasible: false, reason: 'Needs more iron.' },
  short: {
    feasible: false,
    reason: 'This phase needs more Coal than the entered budgets provide.',
    shortfalls: [{ name: 'Coal', needed: 10, budget: 5 }],
  },
  power: {
    feasible: false,
    reason: 'The goal exceeds the available resource or power budgets.',
    shortfalls: [],
  },
  hours: { feasible: false, reason: 'It fits at about 12 hours.', minHours: 12 },
  whole: { feasible: false, reason: 'Whole machines need more.', wholeMachinesOnly: true },
};
const overBudget = new Set(['short', 'power', 'hours', 'whole']);

// The bold heading of each warning notice on the page; Build sequence's repeat of the draft's
// heading (#1020, data-draft-steps) is left out, as tests/ui/plan-tabs.test.ts covers it.
const headings = () =>
  $$('.notice.warn:not([data-draft-steps]) > b:first-child').map(b => (b.textContent || '').trim());

// The wizard opens over an open save, as boot() leaves one, and the frame around it reads it;
// each test opens its own rather than relying on one an earlier test opened (#864).
beforeEach(() => {
  page();
  open();
});

test('the plan page names a budget only when one is short', () => {
  for (const [kind, stage] of Object.entries(stages)) {
    page();
    const plan = generated();
    plan.stages['3'] = stage as (typeof plan.stages)['3'];
    open({ calculated: plan });
    go('plan');
    render();
    const expected = overBudget.has(kind) ? 'Planning draft — budget exceeded.' : 'Planning draft.';
    assert.deepEqual(headings(), [expected], kind);
    assert.ok(
      $$('.notice.warn').some(n => (n.textContent || '').includes(stage.reason!)),
      `${kind}: the reason follows`,
    );
  }
});

test('the wizard Review heads each draft phase by its cause', () => {
  const plan = generated();
  setWizard({
    step: 5,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(plan.settings),
    preview: {
      ...plan,
      settings: { ...plan.settings, phase: '1' },
      stages: {
        ...plan.stages,
        3: stages.stopped as (typeof plan.stages)['3'],
        4: stages.short as (typeof plan.stages)['4'],
      },
    },
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  assert.deepEqual(headings(), ['Phase 3:', 'Phase 4 — budget exceeded:']);
});

// The Review table's Budget column follows the same rule as the heading (#632): a stopped
// search, recipes that cannot make the goal and an older saved plan are planning drafts, not
// phases that need their budgets adjusted.
test('the wizard Review Budget column names a budget only when one is short', () => {
  const plan = generated();
  const kinds = Object.keys(stages);
  setWizard({
    step: 5,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(plan.settings),
    preview: {
      ...plan,
      settings: { ...plan.settings, phase: '1' },
      stages: {
        ...plan.stages,
        ...Object.fromEntries(kinds.map((kind, i) => [String(i + 2), stages[kind]])),
      } as typeof plan.stages,
    },
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  const budget = Object.fromEntries(
    $$('table tbody tr').map(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => (td.textContent || '').trim());
      return [cells[0], cells[1]];
    }),
  );
  assert.equal(budget['1'], 'Within the default budgets', 'no budgets entered (#1072)');
  kinds.forEach((kind, i) =>
    assert.equal(
      budget[String(i + 2)],
      overBudget.has(kind) ? 'Needs adjustment' : 'Planning draft',
      kind,
    ),
  );
});

// A whole-machine draft amount the real fit did not confirm (#1091) is worded as a floor.
test('an unconfirmed whole-machine draft amount reads "at least"', () => {
  const snapshot: StoredStage = {
    feasible: false,
    wholeMachinesOnly: true,
    shortfalls: [{ name: 'Crude Oil', needed: 8081, budget: 4500, atLeast: true }],
  };
  const settings = { limits: { 'Crude Oil': 4500 } };
  // 8,081 m³/min in the test's locale, whatever its separators.
  const budget = () => draftAdvice(snapshot, settings).levers[0]!.text;
  assert.match(budget(), /Crude Oil to at least 8.081\sm/);
  delete snapshot.shortfalls![0]!.atLeast;
  assert.match(budget(), /Crude Oil to about 8.081\sm/);
});

// A cap draft with no time that fits (#1221: more time does not help) carries `capShortfalls`
// alone; it is named as the cap it is, on the plan page and in Review, with the cap's lever (#1020).
test('a cap draft without minHours is headed by its cap and offers to raise it', () => {
  const cap: StoredStage = {
    feasible: false,
    reason:
      "Without the cap, this phase's plan needs 4,141.4 MW; the cap is 900 MW. The planner found no plan within the cap. Raise the cap (Goals).",
    capShortfalls: [{ name: 'mw', needed: 4141.4, cap: 900 }],
  };
  const plan = generated();
  plan.stages['3'] = cap as (typeof plan.stages)['3'];
  open({ calculated: plan });
  go('plan');
  render();
  assert.deepEqual(headings(), ['Planning draft — cap exceeded.']);
  assert.deepEqual(
    $$<HTMLElement>('[data-draft-lever]').map(item => item.dataset.draftLever),
    ['phaseCap'],
  );
  assert.ok($$('[data-draft-lever="phaseCap"] [data-draft-edit="3"]').length, 'opens step 3');
  setWizard({
    step: 5,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(plan.settings),
    preview: {
      ...plan,
      settings: { ...plan.settings, phase: '1' },
      stages: { ...plan.stages, 5: cap as (typeof plan.stages)['5'] },
    },
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  assert.ok(headings().includes('Phase 5 — cap exceeded:'), headings().join(' | '));
});

// A build-cost draft over a cap, with no budget shortfall (#1019): the build cost within the
// phase's time is the cause, so the heading names it before the cap. A cap draft alone keeps "cap
// exceeded", a build-cost draft with a shortfall keeps "budget exceeded".
test('a build-cost draft over a cap is headed by its build cost first', () => {
  const capShortfalls = [{ name: 'mw' as const, needed: 48387.9, cap: 1000 }];
  const draft = (extra: Partial<StoredStage>): StoredStage => ({
    feasible: false,
    reason: 'Counting what its buildings cost to build, this phase does not fit in its 1 h.',
    ...extra,
  });
  const cost = { hours: 1, buildings: { Miner: 4 }, parts: { 'Iron Plate': 40 } };
  assert.equal(
    draftHeading(draft({ buildCost: cost, capShortfalls, minHours: 3 })),
    'Planning draft — build cost and cap exceeded.',
  );
  assert.equal(
    draftHeading(draft({ buildCost: cost, capShortfalls }), '5'),
    'Phase 5 — build cost and cap exceeded:',
  );
  assert.equal(
    draftHeading(draft({ capShortfalls })),
    'Planning draft — cap exceeded.',
    'a cap draft is the cap',
  );
  assert.equal(
    draftHeading(
      draft({
        buildCost: cost,
        capShortfalls,
        shortfalls: [{ name: 'Coal', needed: 10, budget: 5 }],
      }),
    ),
    'Planning draft — budget exceeded.',
  );
  assert.equal(
    draftHeading(draft({ buildCost: cost, minHours: 3 })),
    'Planning draft — budget exceeded.',
    'without a cap it reads as before',
  );
});
