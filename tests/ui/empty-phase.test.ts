// A phase without steps says why: every step was removed (then Removed steps restores them), or
// it never had any, as a plan guide without steps for the phase (#646,
// public/app/ui/plan/Checklist.vue), on a profile migrated from the handbook (#387).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, go, migratedPlan, openMigrated, page } from './setup.ts';

beforeEach(() => {
  page();
  setQuery('');
  setHideDone(false);
});

const emptyText = () => $('#main .checklist .empty-state')?.textContent?.trim() || '';

async function show(editing: boolean) {
  go('plan');
  setPlanEditing(editing);
  render();
  await nextTick();
}

test('a phase that never had steps says so and points to Add task', async () => {
  // A guide without phases, as the handbook in the issue, and nothing removed.
  const plan = migratedPlan();
  plan.guide = { ...plan.guide!, phases: {} };
  openMigrated({ calculated: plan });
  assert.equal(planTasks().length, 0);
  for (const editing of [false, true]) {
    await show(editing);
    assert.equal(
      emptyText(),
      'This phase has no steps yet. Add a task below to start its checklist.',
      editing ? 'while editing' : 'outside edit mode',
    );
    assert.equal($('#main .removed-steps'), null, 'nothing is listed as removed');
  }
});

test('a phase whose steps were all removed points to restoring them', async () => {
  openMigrated();
  const ids = planTasks().map(t => t.id);
  assert.ok(ids.length, 'the migrated phase has steps');
  openMigrated({
    state: { taskEdits: { order: {}, removed: ids, titles: {}, bodies: {}, links: {} } },
  });
  await show(false);
  assert.equal(
    emptyText(),
    'Every step of this phase is removed. Choose Edit steps to restore them.',
  );
  await show(true);
  assert.equal(
    emptyText(),
    'Every step of this phase is removed. Use Removed steps below to restore them.',
  );
  assert.ok($('#main .removed-steps'), 'Removed steps lists them');
});
