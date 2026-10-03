// The "Removed steps in this phase" panel names the step each Restore button acts on (#612,
// public/app/ui/plan/RemovedSteps.vue): Restore is announced as "Restore: <step title>", like
// "Edit: <step title>" and "Remove: <step title>" in the checklist (#577), so a screen reader
// user can tell several removed steps' Restore buttons apart. Its visible text stays "Restore".
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import type { TaskEdits } from '../../public/types/index.ts';
import { $$, go, openMigrated, page } from './setup.ts';

beforeEach(() => {
  page();
  setQuery('');
  setHideDone(false);
});

test('every removed step’s Restore button is named after the step', () => {
  const taskEdits: Partial<TaskEdits> = {
    removed: ['phase-3-survey', 'phase-3-iron', 'phase-3-retire-power'],
  };
  openMigrated({ state: { taskEdits: taskEdits as TaskEdits } });
  go('plan');
  setPlanEditing(true);
  render();
  const rows = $$('#main .removed-steps .removed-step');
  assert.equal(rows.length, 3, 'the panel lists the three removed steps');
  const labels = new Set<string>();
  for (const row of rows) {
    const title = row.querySelector('span')!.textContent!.trim();
    assert.ok(title.length > 0, 'the row shows the step title');
    const restore = row.querySelector('[data-restore-task]')!;
    assert.ok(restore, title);
    assert.equal(restore.getAttribute('aria-label'), 'Restore: ' + title);
    assert.equal(restore.textContent!.trim(), 'Restore');
    labels.add(restore.getAttribute('aria-label')!);
  }
  assert.equal(labels.size, 3, 'the three Restore buttons have different names');
});
