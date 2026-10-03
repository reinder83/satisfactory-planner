// "Removed steps in this phase" names a renamed step by the title the user gave it, as the
// checklist did before it was removed, not by its generated title (#639,
// public/app/tasks.ts removedPlanTasks, public/app/ui/plan/Checklist.vue).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks, removedPlanTasks } from '../../public/app/tasks.ts';
import { $, go, openMigrated, page } from './setup.ts';
import type { TaskEdits } from '../../public/types/index.ts';

beforeEach(() => {
  page();
  openMigrated();
  setQuery('');
  setHideDone(false);
  go('plan');
  setPlanEditing(true);
  render();
});

const removedTitle = (id: string) =>
  $(`#main .removed-steps [data-restore-task="${id}"]`)!
    .closest('.removed-step')!
    .querySelector('span')!
    .textContent!.trim();

test('a renamed step is listed under its edited title once removed', async () => {
  const [step, other] = planTasks();
  assert.ok(step && other, 'the plan shows at least two steps');
  const edits: TaskEdits = {
    order: {},
    removed: [step.id, other.id],
    titles: { [step.id]: 'My renamed step' },
    bodies: {},
    links: {},
  };
  openMigrated({ state: { taskEdits: edits } });
  go('plan');
  setPlanEditing(true);
  render();
  await nextTick();
  assert.equal(removedTitle(step.id), 'My renamed step');
  assert.equal(removedTitle(other.id), other.title, 'an unedited step keeps its title');
  assert.deepEqual(
    removedPlanTasks().map(t => t.title),
    ['My renamed step', other.title],
  );
});
