// "Mark all running" in a factory's header on the Factories page (#1163,
// ui/factories/GroupRunning.vue): one press marks every production line of that factory running in
// the phase shown with one `checks` update through save(), the lines the chips hide included and
// the lines already running left out; the other factories and the ungrouped lines are not touched.
// The toast counts what changed and offers Undo (also Ctrl+Z), which puts the lines back exactly.
// Once all of them run the button offers the reverse. It keeps focus, is not drawn while the
// factories are edited, and a hostile factory name stays text.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { toastShortcut } from '../../public/app/api.ts';
import {
  calculated,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, applyUpdate, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

const ALPHA = 'fg-alpha',
  BETA = 'fg-beta';
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (group: string) => $<HTMLButtonElement>(`#main [data-group-running="${group}"]`);
const undo = () => $<HTMLButtonElement>('#toast [data-toast-action]');
const rowIds = () => calculated!.stages['3']!.rows!.map(row => row.id);
const key = (id: string) => 'calc-3-' + id;

// Alpha holds the first four lines, Beta (a hostile name) the next three, the rest are ungrouped.
function groupsOf(ids: string[]): FactoryGroups {
  return {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: BETA, name: evil },
      { id: 'fg-empty', name: 'Empty' },
    ],
    assignments: Object.fromEntries(
      ids.flatMap((id, i) =>
        i < 4
          ? [[id, [{ group: ALPHA, rate: null }]]]
          : i < 7
            ? [[id, [{ group: BETA, rate: null }]]]
            : [],
      ),
    ),
  };
}

let updates: [string, UpdateOp][];
async function show(checks: (ids: string[]) => Record<string, boolean>) {
  const plan = generated();
  const ids = plan.stages['3']!.rows!.map(row => row.id);
  open({
    calculated: plan,
    phase: '3',
    state: { version: 3, checks: checks(ids), factoryGroups: groupsOf(ids) },
  });
  go('factories');
  render();
  await nextTick();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
}

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
});
afterEach(() => {
  setFactoryFilter('all');
  setFactoryEditing(false);
});

test('each factory with lines offers Mark all running, naming the factory for screen readers', async () => {
  await show(() => ({}));
  const alpha = button(ALPHA)!,
    beta = button(BETA)!;
  assert.equal(text(alpha), 'Mark all running');
  assert.equal(alpha.getAttribute('aria-label'), 'Mark all 4 lines of Alpha running');
  assert.equal(beta.getAttribute('aria-label'), `Mark all 3 lines of ${evil} running`);
  assert.equal($('x-evil'), null, 'the hostile name stays text');
  assert.equal(button('fg-empty'), null, 'an empty factory is not drawn');
  assert.equal($$('#main [data-group-running]').length, 2, 'none for the ungrouped lines');
  // It sits beside the build order link in the factory's header.
  assert.ok(alpha.closest('.site-head')!.querySelector(`[data-group-flow="${ALPHA}"]`));
});

test('a press ticks only the factory’s lines not running yet, says how many, and keeps focus', async () => {
  await show(ids => ({
    [key(ids[0]!)]: true,
    [key(ids[1]!)]: false,
    [key(ids[5]!)]: false,
    [key(ids[9]!)]: true,
    'calc-2-x': true,
  }));
  const before = structuredClone(state.checks);
  const ids = rowIds();
  const alpha = button(ALPHA)!;
  alpha.focus();
  alpha.click();
  await settle();
  const sent = updates.filter(([path]) => path === '/api/update').map(([, body]) => body);
  assert.deepEqual(sent, [
    { type: 'checks', keys: [ids[1], ids[2], ids[3]].map(id => key(id!)), value: true },
  ]);
  assert.deepEqual(state.checks, {
    ...before,
    [key(ids[1]!)]: true,
    [key(ids[2]!)]: true,
    [key(ids[3]!)]: true,
  });
  assert.equal(text($('#toast')), 'Marked 3 lines of Alpha running; 1 already was. Undo');
  assert.equal(text(button(ALPHA)), 'Mark all not running', 'now the reverse');
  assert.equal(document.activeElement, button(ALPHA), 'focus stays on the button');
  const cards = $$<HTMLInputElement>(`#cards-${ALPHA} input[data-check]`);
  assert.equal(cards.length, 4);
  assert.ok(
    cards.every(box => box.checked),
    'every card’s Running box is ticked',
  );
  assert.equal(text(button(BETA)), 'Mark all running', 'the other factory is untouched');
});

test('Undo puts every line back exactly as it was, and focus back on the button', async () => {
  await show(ids => ({ [key(ids[0]!)]: true, [key(ids[1]!)]: false, [key(ids[4]!)]: true }));
  const before = structuredClone(state.checks);
  button(ALPHA)!.click();
  await settle();
  const toastUndo = undo()!;
  assert.equal(text(toastUndo), 'Undo');
  toastUndo.focus();
  toastUndo.click();
  await settle();
  assert.deepEqual(state.checks, before, 'ticked, unticked and never-ticked lines as before');
  assert.equal(text($('#toast')), 'Undone: 3 lines of Alpha are back as they were.');
  assert.equal(text(button(ALPHA)), 'Mark all running');
  assert.equal(document.activeElement, button(ALPHA));
});

test('Ctrl+Z undoes it too, and the reverse clears the lines with an undo of its own', async () => {
  await show(ids => Object.fromEntries(ids.slice(0, 4).map(id => [key(id), true])));
  const before = structuredClone(state.checks);
  const alpha = button(ALPHA)!;
  assert.equal(text(alpha), 'Mark all not running');
  assert.equal(alpha.getAttribute('aria-label'), 'Mark all 4 lines of Alpha not running');
  alpha.focus();
  alpha.click();
  await settle();
  const sent = updates.filter(([path]) => path === '/api/update').map(([, body]) => body);
  assert.deepEqual(sent, [{ type: 'checks', keys: rowIds().slice(0, 4).map(key), value: false }]);
  assert.equal(text($('#toast')), 'Marked 4 lines of Alpha not running. Undo');
  toastShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
  await settle();
  assert.deepEqual(state.checks, before);
  assert.equal(document.activeElement, button(ALPHA));
});

test('a line unticked by hand before Undo keeps its untick', async () => {
  await show(() => ({}));
  const ids = rowIds();
  button(ALPHA)!.click();
  await settle();
  const box = $<HTMLInputElement>(`#cards-${ALPHA} input[data-check="${key(ids[2]!)}"]`)!;
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  undo()!.click();
  await settle();
  assert.deepEqual(state.checks, { [key(ids[2]!)]: false }, 'the others are forgotten again');
  assert.equal(
    text($('#toast')),
    'Undone: 3 lines of Alpha are back as they were; 1 changed since stays as it is.',
  );
});

test('when the Not running chip hides the factory afterwards, focus goes to the next one', async () => {
  await show(() => ({}));
  setFactoryFilter('todo');
  render();
  await nextTick();
  const alpha = button(ALPHA)!;
  alpha.focus();
  alpha.click();
  await settle();
  assert.equal(button(ALPHA), null, 'every Alpha line runs, so the chip hides the factory');
  assert.equal(document.activeElement, button(BETA));
  undo()!.click();
  await settle();
  assert.deepEqual(state.checks, {});
});

test('a failed write ticks nothing and offers no Undo', async () => {
  await show(() => ({}));
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Disk full.' }), { status: 500 });
  button(ALPHA)!.click();
  await settle();
  assert.deepEqual(state.checks, {});
  assert.equal(undo(), null);
  assert.match(text($('#toast')), /Disk full/);
  assert.equal(text(button(ALPHA)), 'Mark all running');
});

test('it is not drawn while the factories are edited', async () => {
  await show(() => ({}));
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($('#main [data-group-running]'), null);
});
