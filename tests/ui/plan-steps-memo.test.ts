// The build plan's steps are worked out once per redraw (#1060, perRedraw in ui/bridge.ts): the
// checklist, its progress bar, ADA and "Removed steps" share one answer, and it is worked out
// again after a redraw or when the progress state or the plan is replaced (a tick, a change of
// phase or settings, another profile), always reading exactly as worked out afresh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import { setState, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { generatedTasks, planTasks, removedPlanTasks } from '../../public/app/tasks.ts';
import { calcTasks, orderedPhaseSteps } from '../../public/app/views/calculated.ts';
import { invalidate } from '../../public/app/ui/bridge.ts';
import { open, page } from './setup.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';

// A plan made for Phase 3, so Phase 5 takes over the lines Phase 4 ran.
const plan = (): StoredCalculatedPlan =>
  JSON.parse(fs.readFileSync('tests/fixtures/plan-before-1065.json', 'utf8')).plan;
// A line Phase 5 builds again after Phase 4 ran it: ticking it in Phase 4 changes its Phase 5
// step (the handover's sentence, #1069).
const carried = (stored: StoredCalculatedPlan) => {
  const earlier = new Set((stored.stages['4']?.rows || []).map(row => row.id));
  return stored.stages['5']!.rows!.find(row => earlier.has(row.id))!.id;
};
// The steps worked out afresh: after a redraw nothing is kept.
const afresh = (phase: '4' | '5') => {
  invalidate();
  return calcTasks(phase);
};

test('one answer per redraw, shared by every caller', () => {
  page();
  open({ calculated: plan(), phase: '5' });
  render();
  const first = calcTasks('5');
  assert.equal(calcTasks('5'), first, 'the same list, not worked out again');
  assert.equal(generatedTasks('5'), first, 'generatedTasks reads the same answer');
  assert.equal(orderedPhaseSteps('5'), orderedPhaseSteps('5'));
  assert.notEqual(calcTasks('4'), first, 'each phase has its own');
  // planTasks and Removed steps read it too; each gets its own list to keep.
  assert.deepEqual(planTasks('5'), planTasks('5'));
  assert.notEqual(planTasks('5'), planTasks('5'));
  assert.deepEqual(removedPlanTasks(), []);
  // A redraw works it out again, reading exactly the same.
  render();
  const again = calcTasks('5');
  assert.notEqual(again, first);
  assert.deepEqual(again, first);
});

test('a tick, a change of phase or another plan is worked out again', () => {
  page();
  const stored = plan();
  open({ calculated: stored, phase: '5' });
  const row = carried(stored);
  const step = () => calcTasks('5').find(task => task.id === 'calc-5-' + row)!.body;
  const before = step();
  // A save replaces the progress state: the Phase 4 tick shows in the Phase 5 step at once.
  setState({ ...state, checks: { ...state.checks, ['calc-4-' + row]: true } });
  const ticked = step();
  assert.notEqual(ticked, before, 'the handover sentence is there without a redraw');
  assert.match(ticked, /^Running since Phase 4/);
  assert.deepEqual(calcTasks('5'), afresh('5'));
  // The saved phase moves with the state: the default phase follows it.
  setState({ ...state, settings: { ...state.settings, phase: '4' } });
  assert.deepEqual(
    planTasks().map(task => task.id),
    planTasks('4').map(task => task.id),
  );
  // Another plan (another profile, or a recalculation) is another answer.
  const other = plan();
  other.stages['5']!.rows![0]!.machines += 1;
  open({ calculated: other, phase: '5', state: { checks: state.checks } });
  assert.deepEqual(calcTasks('5'), afresh('5'));
  assert.notDeepEqual(
    calcTasks('5').map(task => task.body),
    (() => {
      open({ calculated: plan(), phase: '5', state: { checks: state.checks } });
      return calcTasks('5').map(task => task.body);
    })(),
  );
});

test('a change made in place shows after the redraw that follows it', () => {
  page();
  const stored = plan();
  open({ calculated: stored, phase: '5' });
  render();
  const row = carried(stored);
  const before = calcTasks('5');
  state.checks['calc-4-' + row] = true;
  render();
  const after = calcTasks('5');
  assert.notDeepEqual(after, before);
  assert.deepEqual(after, afresh('5'));
});
