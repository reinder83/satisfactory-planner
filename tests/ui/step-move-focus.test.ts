// Where focus goes when a build-plan step is moved with its ↑ / ↓ (#656,
// public/app/ui/plan/PlanStep.vue): the moved step's row is re-inserted in its new place, which
// takes focus from the pressed arrow, so focus goes back to the same arrow on the moved step,
// never to <body>, and a second press moves it again. At either end of the list the arrow does
// nothing and keeps focus. A control is focused before it is pressed, as the keyboard does. The
// focused element is compared by what identifies it (a boolean, never two elements with
// assert.equal: #287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, go, openMigrated, page, stubFetch } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const arrow = (id: string, dir: number) =>
  `#main [data-move-task="${CSS.escape(id)}"][data-dir="${dir}"]`;
const press = (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector);
  el.focus();
  el.click();
};
const focusedOn = (selector: string) => {
  const want = $(selector);
  assert.ok(want, 'expected ' + selector + ' on the page');
  return document.activeElement === want;
};
const describeFocus = () => document.activeElement?.outerHTML.slice(0, 120) ?? 'null';
const order = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '#main .checklist .task [data-move-task][data-dir="-1"]',
    ),
  ].map(el => el.dataset.moveTask!);

beforeEach(() => {
  page();
  openMigrated();
  setQuery('');
  setHideDone(false);
  stubFetch({ '/api/update': applyUpdate });
  go('plan');
  setPlanEditing(true);
  render();
});

test('Move up keeps focus on the moved step’s Move up, and a second press moves it again', async () => {
  const before = order();
  assert.ok(before.length >= 3, 'the plan has at least three steps');
  const id = before[2]!;
  press(arrow(id, -1));
  await settle();
  assert.equal(order().indexOf(id), 1, 'the step moved up');
  assert.ok(focusedOn(arrow(id, -1)), describeFocus());
  (document.activeElement as HTMLElement).click();
  await settle();
  assert.equal(order().indexOf(id), 0, 'the second press moved it again');
  assert.ok(focusedOn(arrow(id, -1)), describeFocus());
});

test('Move down keeps focus on the moved step’s Move down', async () => {
  const id = order()[0]!;
  press(arrow(id, 1));
  await settle();
  assert.equal(order().indexOf(id), 1, 'the step moved down');
  assert.ok(focusedOn(arrow(id, 1)), describeFocus());
});

test('At either end the arrow does nothing and keeps focus', async () => {
  const before = order();
  press(arrow(before[0]!, -1));
  await settle();
  assert.deepEqual(order(), before);
  assert.ok(focusedOn(arrow(before[0]!, -1)), describeFocus());
  const last = before.at(-1)!;
  press(arrow(last, 1));
  await settle();
  assert.deepEqual(order(), before);
  assert.ok(focusedOn(arrow(last, 1)), describeFocus());
});
