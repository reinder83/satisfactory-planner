// A build-plan step's edit-mode buttons name the step they act on (#577,
// public/app/ui/plan/PlanStep.vue): Edit and Remove are announced as "Edit: <step title>" and
// "Remove: <step title>", like "Move up: <step title>", so a screen reader user can tell the ~36
// Edit buttons apart. Their visible text stays "Edit" and "Remove".
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, go, open, page } from './setup.ts';

beforeEach(() => {
  page();
  open();
  setQuery('');
  setHideDone(false);
  go('plan');
  setPlanEditing(true);
  render();
});

const stepTitle = (id: string) => {
  const moveUp = $(`#main [data-move-task="${id}"][data-dir="-1"]`);
  assert.ok(moveUp, 'the step has a Move up button');
  const label = moveUp.getAttribute('aria-label') ?? '';
  assert.ok(label.startsWith('Move up: '), label);
  return label.slice('Move up: '.length);
};

test('every step’s Edit and Remove buttons are named after the step', () => {
  const edits = $$('#main [data-edit-task]');
  assert.ok(edits.length > 1, 'the plan shows several steps');
  for (const edit of edits) {
    const id = edit.getAttribute('data-edit-task')!;
    const title = stepTitle(id);
    assert.ok(title.length > 0, id);
    assert.equal(edit.getAttribute('aria-label'), 'Edit: ' + title);
    assert.equal(edit.textContent!.trim(), 'Edit');
    const remove = $(`#main [data-remove-step="${id}"]`);
    assert.ok(remove, id);
    assert.equal(remove.getAttribute('aria-label'), 'Remove: ' + title);
    assert.equal(remove.textContent!.trim(), 'Remove');
  }
});
