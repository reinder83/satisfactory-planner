// Removing a build-plan step or a factory asks nothing; the toast offers Undo (#1334, X-4). Undo, by
// its button or by Ctrl+Z, puts back exactly what the removal took: the step in its place with its
// checkmark; the factory in its place in the list with its lines' shares, links, items made on
// site, map pin, owner and the stations it owned. Deleting a personal task still asks, as its
// text cannot come back.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { toastShortcut } from '../../public/app/api.ts';
import {
  setFactoryEditing,
  setFactoryFilter,
  setHideDone,
  setQuery,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  generated,
  go,
  open,
  openMigrated,
  page,
  stubFetch,
} from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const undo = () => $<HTMLButtonElement>('#toast [data-toast-action]');
const ctrlZ = () => toastShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));

beforeEach(() => {
  page();
  setQuery('');
  setHideDone(false);
  setFactoryFilter('all');
  setFactoryEditing(false);
});

// Build plan steps ------------------------------------------------------------------------

async function editPlan() {
  openMigrated({ state: { checks: { 'phase-3-iron': true } } });
  const asked = answerConfirms(true);
  go('plan');
  render();
  await nextTick();
  const updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  return { asked, updates };
}
const order = () => planTasks().map(step => step.id);

test('Remove on a step asks nothing and offers Undo; Undo puts it back in its place with its tick', async () => {
  const { asked, updates } = await editPlan();
  const before = order();
  const at = before.indexOf('phase-3-iron');
  assert.ok(at > 0, 'a ticked step with steps around it');
  const checks = structuredClone(state.checks);
  $('[data-remove-step="phase-3-iron"]')!.click();
  await settle();
  assert.deepEqual(asked, [], 'no confirmation');
  assert.equal($('#confirm[open]'), null);
  assert.ok(!order().includes('phase-3-iron'), 'the step is gone');
  assert.ok(state.taskEdits?.removed.includes('phase-3-iron'));
  const sent = updates.filter(([path]) => path === '/api/update').map(([, body]) => body);
  assert.deepEqual(sent, [{ type: 'taskRemove', id: 'phase-3-iron' }], 'the same write as before');
  assert.match(text($('#toast')), /^Removed “.+” from your build plan\. Its checkmark is kept\./);
  assert.equal(text(undo()), 'Undo');
  assert.equal(undo()!.getAttribute('aria-keyshortcuts'), 'Control+Z Meta+Z');
  undo()!.focus();
  undo()!.click();
  await settle();
  assert.deepEqual(order(), before, 'same position');
  assert.deepEqual(state.checks, checks, 'same ticks');
  assert.ok(!state.taskEdits?.removed.includes('phase-3-iron'));
  assert.deepEqual(updates.at(-1)![1], { type: 'taskRestore', id: 'phase-3-iron' });
  assert.match(text($('#toast')), /is back in your build plan/);
  assert.equal(
    document.activeElement,
    $('[data-task="phase-3-iron"] summary'),
    'focus goes to the restored step',
  );
});

test('Ctrl+Z puts a removed step back too', async () => {
  await editPlan();
  const before = order();
  $('[data-remove-step="phase-3-iron"]')!.click();
  await settle();
  ctrlZ();
  await settle();
  assert.deepEqual(order(), before);
});

test('after Remove on a step focus goes to the next step, never to its Remove button', async () => {
  await editPlan();
  const next = order()[order().indexOf('phase-3-iron') + 1]!;
  const remove = $<HTMLElement>('[data-remove-step="phase-3-iron"]')!;
  remove.focus();
  remove.click();
  await settle();
  const now = document.activeElement as HTMLElement;
  assert.equal(now.closest('[data-task]')?.getAttribute('data-task'), next, 'the next step');
  assert.equal(now.tagName, 'SUMMARY');
  assert.equal(now.closest('#toast'), null);
});

test('deleting a personal task still asks, as its text cannot come back', async () => {
  openMigrated({ state: { customTasks: [{ id: 'custom-1', phase: '3', title: 'Mine' }] } });
  const asked = answerConfirms(false);
  go('plan');
  render();
  await nextTick();
  const updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  $('[data-remove-step="custom-1"]')!.click();
  await settle();
  assert.equal(asked.length, 1);
  assert.deepEqual(updates, [], 'declined: nothing sent');
});

// Factories -------------------------------------------------------------------------------

const A = 'fg-alpha',
  B = 'fg-beta',
  C = 'fg-gamma';

function groups(ids: string[]): FactoryGroups {
  return {
    groups: [
      { id: A, name: 'Alpha' },
      { id: B, name: 'Beta', owner: 'Anna', layout: { zoom: 1.5 } },
      { id: C, name: 'Gamma' },
    ],
    assignments: {
      [ids[0]!]: [
        { group: A, rate: null },
        { group: B, rate: 30 },
        { group: C, rate: null },
      ],
      [ids[1]!]: [{ group: B, rate: null }],
      [ids[2]!]: [{ group: A, rate: null }],
    },
    links: {
      [`${A}:${B}`]: { mode: 'truck', roundTripMin: 4, fuel: 'Packaged Fuel' },
      [`${B}:${C}`]: { mode: 'drone', roundTripMin: 6 },
      [`${A}:${C}`]: { mode: 'tractor', roundTripMin: 3, fuel: 'Packaged Fuel' },
    },
    local: { [B]: ['Iron Ingot'], [C]: ['Copper Ingot'] },
  };
}

async function showFactories() {
  const plan = generated();
  const ids = plan.stages['3']!.rows!.map(row => row.id);
  open({
    calculated: plan,
    phase: '3',
    state: {
      version: 30,
      factoryGroups: groups(ids),
      factoryPlaces: { [B]: { x: 12, y: 34 }, [C]: { x: 5, y: 6 } },
      trainStations: [
        {
          id: 'ts-one01',
          name: 'One',
          owner: { kind: 'factory', id: B },
          platforms: [{ kind: 'empty' }],
        },
        {
          id: 'ts-two02',
          name: 'Two',
          owner: { kind: 'factory', id: C },
          platforms: [{ kind: 'empty' }],
        },
      ],
    },
  });
  const asked = answerConfirms(false);
  go('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  const updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  return { asked, updates };
}
const names = () => $$('#main .user-group [data-section-heading], #main .user-group h2').length;
const headings = () => $$('#main .user-group').map(section => section.id.replace('section-', ''));

test('Remove on a factory asks nothing and keeps its lines; Undo restores it exactly', async () => {
  const { asked, updates } = await showFactories();
  const before = structuredClone({
    groups: state.factoryGroups,
    places: state.factoryPlaces,
    stations: state.trainStations,
  });
  const order = headings();
  assert.ok(names() > 0);
  $(`[data-remove-group="${B}"]`)!.click();
  await settle();
  assert.deepEqual(asked, [], 'no confirmation');
  assert.equal($('#confirm[open]'), null);
  assert.deepEqual(
    updates.filter(([path]) => path === '/api/update').map(([, body]) => body),
    [{ type: 'factoryGroupRemove', id: B }],
  );
  assert.ok(!state.factoryGroups.groups.some(group => group.id === B));
  assert.equal(state.factoryPlaces?.[B], undefined, 'off the map');
  assert.equal(
    state.trainStations?.find(station => station.id === 'ts-one01')?.owner,
    undefined,
    'its station lost its owner',
  );
  assert.match(text($('#toast')), /^Removed “Beta”\. Its production lines stay in the list/);
  assert.equal(text(undo()), 'Undo');
  undo()!.focus();
  undo()!.click();
  await settle();
  assert.deepEqual(
    { groups: state.factoryGroups, places: state.factoryPlaces, stations: state.trainStations },
    before,
    'the factory, its lines, links, items, pin and stations are all back',
  );
  assert.deepEqual(headings(), order, 'same place in the list');
  assert.match(text($('#toast')), /“Beta” is back/);
  assert.equal(document.activeElement, $(`#section-${B} [data-section-heading]`));
});

test('Ctrl+Z restores a removed factory too, from the middle of the list', async () => {
  await showFactories();
  const before = structuredClone(state.factoryGroups);
  $(`[data-remove-group="${A}"]`)!.click();
  await settle();
  ctrlZ();
  await settle();
  assert.deepEqual(state.factoryGroups, before);
});

test('after Remove on a factory focus goes to the next factory’s name', async () => {
  await showFactories();
  const remove = $<HTMLElement>(`[data-remove-group="${A}"]`)!;
  remove.focus();
  remove.click();
  await settle();
  const now = document.activeElement as HTMLElement;
  assert.ok(now.matches('[data-section-heading]') || now.closest('[data-section-heading]'));
  assert.equal(now.closest('.user-group')?.id, `section-${B}`);
});

test('Undo sends nothing once another profile is open', async () => {
  const { updates } = await showFactories();
  $(`[data-remove-group="${C}"]`)!.click();
  await settle();
  assert.ok(undo());
  const sent = updates.length;
  open({ profileId: 'other' });
  await settle();
  ctrlZ();
  await settle();
  assert.equal(updates.length, sent, 'nothing is sent to the other profile');
});
