// The heading over a planning draft follows its cause (#626): the plan page's draft notice
// (ui/plan/CalcWarnings.vue) and the wizard's Review (ui/wizard/ReviewStep.vue) name a budget
// only when the planner measured one, so a stopped search is not called a budget problem.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { carryOptions } from '../../public/state.ts';
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

// The bold heading of each warning notice on the page.
const headings = () => $$('.notice.warn > b:first-child').map(b => (b.textContent || '').trim());

beforeEach(() => page());

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
  assert.equal(budget['1'], 'Within entered limits');
  kinds.forEach((kind, i) =>
    assert.equal(
      budget[String(i + 2)],
      overBudget.has(kind) ? 'Needs adjustment' : 'Planning draft',
      kind,
    ),
  );
});
