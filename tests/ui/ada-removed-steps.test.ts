// ADA's "removed" remark on the build plan (public/ada.ts, facts from adaFacts in
// public/app/ada-panel.ts) counts only the current phase's removed steps, the same steps
// "Removed steps" lists for it, not the steps removed from every phase (#724).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { planTasks, removedPlanTasks } from '../../public/app/tasks.ts';
import { go, openMigrated, page } from './setup.ts';
import type { Phase, TaskEdits } from '../../public/types/index.ts';

beforeEach(() => {
  page();
  setAdaIndex(0);
  adaClearFault();
});

// ADA's remarks on the build plan of `phase`, by id, with `removed` steps removed.
function planRemarks(phase: Phase, removed: string[]) {
  const taskEdits: Partial<TaskEdits> = { removed };
  openMigrated({ phase, state: { taskEdits: taskEdits as TaskEdits } });
  go('plan');
  const remarks = new Map<string, string>();
  for (let i = 0; i < 40; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id) remarks.set(line.id, line.text);
  }
  return remarks;
}

// The ids of the migrated handbook profile's steps of `phase`, before any edits.
function stepIds(phase: Phase) {
  openMigrated({ phase });
  return planTasks().map(t => t.id);
}

test('a step removed in another phase is not counted on this one', () => {
  const [removed] = stepIds('3');
  assert.ok(removed, 'Phase 3 has a step to remove');
  const remarks = planRemarks('4', [removed]);
  assert.equal(removedPlanTasks().length, 0, 'Removed steps lists nothing for Phase 4');
  assert.equal(remarks.has('removed'), false, `no removed remark: ${remarks.get('removed')}`);
});

test('the count names only the steps removed from this phase', () => {
  const [a, b] = stepIds('3'),
    [c] = stepIds('4');
  assert.ok(a && b && c, 'both phases have steps');
  const remarks = planRemarks('4', [a, b, c]);
  assert.equal(removedPlanTasks().length, 1, 'Removed steps lists one step for Phase 4');
  assert.match(remarks.get('removed') || '', /^1 step removed from this phase\./);
});
