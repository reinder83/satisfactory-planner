// Where focus goes after a confirmed removal (#286, public/app/ui/refocus.ts), and after an
// action without a confirmation whose button goes (#290): the removed row's control goes with it, so focus moves to the same control in the next row, else the
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
  setWizard,
  state,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  catalog,
  generated,
  go,
  handbook,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { StorageEdits, TaskEdits, WorkspaceSummary } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
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
  const customTasks = ['one', 'two', 'three'].map(name => ({
    id: 'custom-' + name,
    phase: '3' as const,
    title: 'Task ' + name,
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
      index = list.findIndex(b => b.querySelector('.bay-letter')!.textContent === letter);
    const next = list[index + 1] ?? list[index - 1]!;
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

test('removing a profile moves focus to the next profile’s ⋯ menu', async () => {
  const profiles = ['original', 'second', 'third'].map(id => ({
    id,
    kind: 'original' as const,
    name: 'Profile ' + id,
    completed: 0,
    phase: '3' as const,
  }));
  const save = (saveProfiles: typeof profiles) => ({
    id: 's',
    name: 'World',
    activeProfile: 'original',
    profiles: saveProfiles,
  });
  open({ workspace: { saves: [save(profiles)] } as Partial<WorkspaceSummary> });
  const before = { ...workspace },
    after = { ...workspace, saves: [save(profiles.filter(p => p.id !== 'second'))] };
  // The page asks for the summary when it opens (#418): the removal's result only after it.
  let removed = false;
  stubFetch({
    '/api/remove-profile': () => ((removed = true), {}),
    '/api/workspace': () => (removed ? after : before),
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
  // Remove is in the card's ⋯ menu (#238), which closes and gives ⋯ focus when it is chosen.
  press('[data-profile-menu="second"]');
  await settle();
  assert.ok(focusedOn('[data-duplicate-profile="second"]'), describeFocus());
  press('[data-remove-profile="second"]');
  await vi.waitFor(() => assert.ok(!$('[data-remove-profile="second"]')));
  await settle();
  assert.ok(focusedOn('[data-profile-menu="third"]'), describeFocus());
  assert.equal($('#profile-menu-s-third')!.hidden, true, 'its menu stays closed');
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

// --- Actions without a confirmation whose button goes (#290) ---

test('Restore on a removed step moves focus to the next Restore, else the previous one, else the restored step', async () => {
  stubFetch({ '/api/update': applyUpdate });
  const taskEdits: Partial<TaskEdits> = {
    removed: ['phase-3-survey', 'phase-3-iron', 'phase-3-retire-power'],
  };
  open({ state: { taskEdits: taskEdits as TaskEdits } });
  go('plan');
  setPlanEditing(true);
  render();
  const [first, second, third] = $$('[data-restore-task]').map(b => b.dataset.restoreTask!);
  press(`[data-restore-task="${second}"]`);
  await settle();
  assert.ok(!$(`[data-restore-task="${second}"]`), 'the step is restored');
  assert.ok(focusedOn(`[data-restore-task="${third}"]`), describeFocus());
  // The last one: no next Restore, so the one before it.
  press(`[data-restore-task="${third}"]`);
  await settle();
  assert.ok(focusedOn(`[data-restore-task="${first}"]`), describeFocus());
  // The only one: the list goes, and focus goes to the restored step in the checklist.
  press(`[data-restore-task="${first}"]`);
  await settle();
  assert.equal($('.removed-steps'), null, 'nothing is left to restore');
  assert.ok(focusedOn(`#main .checklist [data-remove-step="${first}"]`), describeFocus());
});

test('clearing a container moves focus to the next ✕ in its bay, else the previous one, else the add field', async () => {
  stubFetch({ '/api/update': applyUpdate });
  const storageEdits = {
    bays: [{ id: 'S', name: 'Overflow', floor: 'ground' }],
    slots: { S01: 'Wire', S02: 'Cable', S03: 'Quickwire' },
  } as Partial<StorageEdits> as StorageEdits;
  open({ state: { storageEdits } });
  go('storage');
  setLayoutEditing(true);
  render();
  press('[data-clear-slot="S02"]');
  await settle();
  assert.ok(!$('[data-clear-slot="S02"]'), 'the container is cleared');
  assert.ok(focusedOn('[data-clear-slot="S03"]'), describeFocus());
  // The last container of the bay: the previous one, not the next bay's.
  press('[data-clear-slot="S03"]');
  await settle();
  assert.ok(focusedOn('[data-clear-slot="S01"]'), describeFocus());
  press('[data-clear-slot="S01"]');
  await settle();
  assert.ok(focusedOn('#bay-draft-S'), describeFocus());
});

test('Restore on a hidden bay or floor moves focus to the next Restore, else what came back', async () => {
  stubFetch({ '/api/update': applyUpdate });
  const storageEdits = {
    hiddenBays: ['A', 'B', 'O'],
    hiddenFloors: ['workshop'],
  } as Partial<StorageEdits> as StorageEdits;
  open({ state: { storageEdits } });
  go('storage');
  setLayoutEditing(true);
  render();
  press('[data-restore-bay="A"]');
  await settle();
  assert.ok(!$('[data-restore-bay="A"]'), 'the bay is restored');
  assert.ok(focusedOn('[data-restore-bay="B"]'), describeFocus());
  // The hidden floor is the last row: the one before it.
  press('[data-restore-floor="workshop"]');
  await settle();
  assert.ok(!$('[data-restore-floor="workshop"]'), 'the floor is restored');
  assert.ok(focusedOn('[data-restore-bay="O"]'), describeFocus());
  press('[data-restore-bay="O"]');
  await settle();
  assert.ok(focusedOn('[data-restore-bay="B"]'), describeFocus());
  // The last one, on this floor: its Hide bay.
  press('[data-restore-bay="B"]');
  await settle();
  assert.equal($('[data-hidden-bays]'), null, 'nothing is left to restore');
  assert.ok(focusedOn('[data-hide-bay="B"]'), describeFocus());
});

test('the last hidden bay or floor restored moves focus to its floor tab', async () => {
  stubFetch({ '/api/update': applyUpdate });
  // O is an upper-floor bay, restored from the ground floor.
  open({ state: { storageEdits: { hiddenBays: ['O'] } as Partial<StorageEdits> as StorageEdits } });
  go('storage');
  setLayoutEditing(true);
  render();
  press('[data-restore-bay="O"]');
  await settle();
  assert.ok(focusedOn('#main .tabs [data-floor="upper"]'), describeFocus());
  open({
    state: {
      storageEdits: { hiddenFloors: ['workshop'] } as Partial<StorageEdits> as StorageEdits,
    },
  });
  go('storage');
  setLayoutEditing(true);
  render();
  await nextTick();
  press('[data-restore-floor="workshop"]');
  await settle();
  assert.ok(focusedOn('#main .tabs [data-floor="workshop"]'), describeFocus());
});

test('removing a factory from a group moves focus to its next ✕, else its Add to group', async () => {
  stubFetch({ '/api/update': applyUpdate });
  open({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cable factory' },
          { id: 'fg-plates1', name: 'Stitched plates' },
        ],
        assignments: {
          wire: [
            { group: 'fg-cable01', rate: 300 },
            { group: 'fg-plates1', rate: null },
          ],
        },
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  // Wire's card in the cable factory's section goes with its first ✕.
  const card = $('[data-unassign="wire"][data-group="fg-cable01"]')!.closest('.assign-editor')!;
  press('[data-unassign="wire"][data-group="fg-cable01"]');
  await settle();
  assert.ok(!$('[data-unassign="wire"][data-group="fg-cable01"]'), 'wire left the group');
  assert.equal(card.isConnected, false, 'that card went with it');
  assert.ok(focusedOn('[data-unassign="wire"][data-group="fg-plates1"]'), describeFocus());
  press('[data-unassign="wire"][data-group="fg-plates1"]');
  await settle();
  assert.ok(!$('[data-unassign="wire"]'), 'wire is in no group');
  assert.ok(focusedOn('[data-assign-add="wire"]'), describeFocus());
});

test('removing a supply row moves focus to the next Remove, else the previous one, else the blank row', async () => {
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 1,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(generated().settings),
    preview: null,
    carryFrom: null,
    carry: {},
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    supplyRows: [
      { name: 'Modular Frame', rate: '50' },
      { name: 'Computer', rate: '20' },
      { name: 'Wire', rate: '10' },
    ],
  });
  go('wizard');
  render();
  const items = () => $$<HTMLInputElement>('input[name=supplyItem]').map(i => i.value);
  press('[data-supply-remove="1"]');
  await settle();
  assert.deepEqual(items(), ['Modular Frame', 'Wire', ''], 'Computer is removed');
  assert.ok(focusedOn('[data-supply-remove="1"]'), describeFocus());
  // The last filled row: the blank row takes its place, so the row before it.
  press('[data-supply-remove="1"]');
  await settle();
  assert.deepEqual(items(), ['Modular Frame', '']);
  assert.ok(focusedOn('[data-supply-remove="0"]'), describeFocus());
  press('[data-supply-remove="0"]');
  await settle();
  assert.deepEqual(items(), ['']);
  assert.ok(focusedOn('[data-supply-row="0"] input[name=supplyItem]'), describeFocus());
});

test('Mute and Unmute move focus to the button that takes their place', async () => {
  render();
  press('[data-ada-mute="on"]');
  await settle();
  assert.ok(focusedOn('[data-ada-mute="off"]'), describeFocus());
  press('[data-ada-mute="off"]');
  await settle();
  assert.ok(focusedOn('[data-ada-mute="on"]'), describeFocus());
});

test('Fill, Reset and Undo in the node survey move focus to the button that takes their place', async () => {
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 4,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: {
      ...structuredClone(generated().settings),
      purity: 'vanilla',
      distribution: 'original',
    },
    preview: null,
    carryFrom: null,
    carry: {},
    mode: 'extraction',
    extractionStep: 2,
    extractionReturn: { mode: 'advanced', step: 4, guidedStep: 1 },
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  press('[data-node-reset]');
  await settle();
  assert.ok(focusedOn('[data-node-undo]'), describeFocus());
  press('[data-node-undo]');
  await settle();
  assert.ok(focusedOn('[data-node-reset]'), describeFocus());
  // Emptied, the survey offers Fill, which gives way to the filled counts and their Undo or Reset.
  press('[data-node-reset]');
  await settle();
  press('[data-node-preset]');
  await settle();
  assert.equal($('[data-node-preset]'), null, 'the counts are filled');
  assert.ok(focusedOn('[data-node-undo], [data-node-reset]'), describeFocus());
});
