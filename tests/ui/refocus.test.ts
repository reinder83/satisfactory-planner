// Where focus goes after a confirmed removal (#286, public/app/ui/refocus.ts): the removed
// row's control goes with it, so focus moves to the same control in the next row, else the
// previous one, else the list's "Add…" field or tab, never to <body>. Each list is mounted the
// way the app mounts it; a control is focused before it is pressed, as the keyboard does.
// The focused element is compared by what identifies it (never two elements with assert.equal,
// which crashes the Vitest worker on a mismatch: #287).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import {
  setFactoryEditing,
  setFloor,
  setHideDone,
  setLayoutEditing,
  setPlanEditing,
  setQuery,
  state,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  go,
  handbook,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { StorageEdits, WorkspaceSummary } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};
// Focus a control, then press it.
const press = (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector);
  el.focus();
  el.click();
};
const focused = () => document.activeElement as HTMLElement | null;
// Whether focus is on the element `selector` finds (a boolean, so a failure prints both).
const focusedOn = (selector: string) => {
  const want = $(selector);
  assert.ok(want, 'expected ' + selector + ' on the page');
  return focused() === want;
};
const describeFocus = () => focused()?.outerHTML.slice(0, 120) ?? 'null';

beforeEach(() => {
  page();
  open();
  setQuery('');
  setHideDone(false);
  setPlanEditing(false);
  setFactoryEditing(false);
  setLayoutEditing(false);
  setFloor('ground');
  answerConfirms(true);
});

test('removing a step moves focus to the next step’s Remove, else the previous one', async () => {
  stubFetch({ '/api/update': applyUpdate });
  go('plan');
  setPlanEditing(true);
  render();
  const ids = () => $$('#main .checklist [data-remove-step]').map(b => b.dataset.removeStep);
  const [first, second] = ids();
  press(`[data-remove-step="${first}"]`);
  await settle();
  assert.ok(!$(`[data-remove-step="${first}"]`), 'the step is removed');
  assert.ok(focusedOn(`[data-remove-step="${second}"]`), describeFocus());
  // The last step: no next one, so the one before it.
  const all = ids();
  press(`[data-remove-step="${all.at(-1)}"]`);
  await settle();
  assert.ok(focusedOn(`[data-remove-step="${all.at(-2)}"]`), describeFocus());
});

test('removing the only step shown moves focus to the personal task field', async () => {
  stubFetch({ '/api/update': applyUpdate });
  go('plan');
  setPlanEditing(true);
  // The search leaves one step on screen.
  setQuery('iron halls');
  render();
  assert.equal($$('#main .checklist .task').length, 1);
  press('#main .checklist [data-remove-step]');
  await settle();
  assert.equal($$('#main .checklist .task').length, 0);
  assert.ok(focusedOn('#add-task [name=title]'), describeFocus());
});

test('deleting a personal task moves focus to the next step’s summary, or its Remove while editing', async () => {
  stubFetch({ '/api/update': applyUpdate });
  const customTasks = ['one', 'two', 'three'].map(n => ({
    id: 'custom-' + n,
    phase: '3' as const,
    title: 'Task ' + n,
  }));
  open({ state: { customTasks } });
  go('plan');
  render();
  // Outside edit mode Delete sits in the task's details; the next task's is in closed details.
  press('[data-remove="custom-two"]');
  await settle();
  assert.ok(!$('[data-task="custom-two"]'), 'the task is deleted');
  assert.ok(focusedOn('[data-task="custom-three"] > summary'), describeFocus());
  setPlanEditing(true);
  render();
  await nextTick();
  press('[data-remove-step="custom-three"]');
  await settle();
  assert.ok(focusedOn('[data-remove-step="custom-one"]'), describeFocus());
});

test('removing a factory group moves focus to the next group, else the new group field', async () => {
  stubFetch({ '/api/update': applyUpdate });
  open({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cable factory' },
          { id: 'fg-plates1', name: 'Stitched plates' },
        ],
        assignments: {},
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  press('[data-remove-group="fg-cable01"]');
  await settle();
  assert.ok(!$('[data-remove-group="fg-cable01"]'));
  assert.ok(focusedOn('[data-remove-group="fg-plates1"]'), describeFocus());
  press('[data-remove-group="fg-plates1"]');
  await settle();
  assert.ok(focusedOn('#new-group-name'), describeFocus());
});

test('removing or hiding a bay moves focus to the next bay’s Remove or Hide', async () => {
  stubFetch({ '/api/update': applyUpdate });
  const storageEdits = {
    bays: [
      { id: 'S', name: 'Overflow', floor: 'ground' },
      { id: 'T', name: 'Spare', floor: 'ground' },
    ],
  } as Partial<StorageEdits> as StorageEdits;
  open({ state: { storageEdits } });
  go('storage');
  setLayoutEditing(true);
  render();
  const control = '[data-remove-bay], [data-hide-bay]';
  const bays = () => $$('#main .floor-grid .bay');
  const expectAfter = (letter: string) => {
    const list = bays(),
      at = list.findIndex(b => b.querySelector('.bay-letter')!.textContent === letter);
    const next = list[at + 1] ?? list[at - 1]!;
    return next.querySelector<HTMLElement>(control)!;
  };
  const afterS = expectAfter('S');
  press('[data-remove-bay="S"]');
  await settle();
  assert.ok(!$('[data-remove-bay="S"]'), 'the bay is removed');
  assert.ok(focused() === afterS && afterS.isConnected, describeFocus());
  const afterA = expectAfter('A');
  press('[data-hide-bay="A"]');
  await settle();
  assert.ok(!$('[data-hide-bay="A"]'), 'the bay is hidden');
  assert.ok(focused() === afterA && afterA.isConnected, describeFocus());
});

test('removing an added floor or hiding a built-in one moves focus to the floor tab shown', async () => {
  stubFetch({ '/api/update': applyUpdate });
  const storageEdits = {
    floors: [{ id: 'cf-abcd12', label: 'Basement' }],
  } as Partial<StorageEdits> as StorageEdits;
  open({ state: { storageEdits } });
  go('storage');
  setLayoutEditing(true);
  setFloor('cf-abcd12');
  render();
  press('[data-remove-floor="cf-abcd12"]');
  await settle();
  assert.ok(!$('[data-floor="cf-abcd12"]'), 'the floor is removed');
  assert.ok(focusedOn('[data-floor="ground"].active'), describeFocus());
  setFloor('workshop');
  render();
  await nextTick();
  press('[data-hide-floor="workshop"]');
  await settle();
  assert.ok(!$('[data-floor="workshop"]'), 'the floor is hidden');
  assert.ok(focusedOn('#main .tabs [data-floor].active'), describeFocus());
});

test('removing a profile moves focus to the next profile’s Remove', async () => {
  const profiles = ['original', 'second', 'third'].map(id => ({
    id,
    kind: 'original' as const,
    name: 'Profile ' + id,
    completed: 0,
    phase: '3' as const,
  }));
  const save = (ps: typeof profiles) => ({
    id: 's',
    name: 'World',
    activeProfile: 'original',
    profiles: ps,
  });
  open({ workspace: { saves: [save(profiles)] } as Partial<WorkspaceSummary> });
  const after = { ...workspace, saves: [save(profiles.filter(p => p.id !== 'second'))] };
  stubFetch({
    '/api/remove-profile': {},
    '/api/workspace': after,
    '/plan.json': handbook,
    '/progression.json': JSON.parse(fs.readFileSync('public/progression.json', 'utf8')),
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'original', kind: 'original', name: 'Profile original' },
      state: structuredClone(state),
      plan: null,
      handbook,
    }),
  });
  // boot() after the removal opens the page the address names, as on a reload.
  location.hash = '#profiles';
  go('profiles');
  render();
  press('[data-remove-profile="second"]');
  await vi.waitFor(() => assert.ok(!$('[data-remove-profile="second"]')));
  await settle();
  assert.ok(focusedOn('[data-remove-profile="third"]'), describeFocus());
});

test('Cancel, or a removal that fails, leaves focus on the control that asked', async () => {
  go('plan');
  setPlanEditing(true);
  render();
  const id = $$('#main .checklist [data-remove-step]')[1]!.dataset.removeStep;
  answerConfirms(false);
  press(`[data-remove-step="${id}"]`);
  await settle();
  assert.ok(focusedOn(`[data-remove-step="${id}"]`), describeFocus());
  // No /api/update reply: the save fails and the step stays.
  stubFetch({});
  answerConfirms(true);
  press(`[data-remove-step="${id}"]`);
  await settle();
  assert.ok($(`[data-remove-step="${id}"]`), 'the step is still there');
  assert.ok(focusedOn(`[data-remove-step="${id}"]`), describeFocus());
});
