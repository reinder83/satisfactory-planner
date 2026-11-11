// The Undo of removing a factory (#1334, X-4): `factoryGroupRestore` puts back what
// `factoryGroupRemove` took, in one write, and refuses what does not fit. The page's side
// (restoreUpdate, the toast, Ctrl+Z) is in tests/ui/undo-remove.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, mutate } from '../public/state.ts';
import { restoreUpdate } from '../public/app/factory-restore.ts';
import type { ProgressState, UpdateOp } from '../public/types/index.ts';

function profile(): ProgressState {
  const state = initialState();
  const run = (update: UpdateOp) => mutate(state, update);
  for (const [id, name] of [
    ['fg-alpha', 'Alpha'],
    ['fg-beta', 'Beta'],
    ['fg-gamma', 'Gamma'],
  ] as const)
    run({ type: 'factoryGroupAdd', id, name });
  run({ type: 'factoryGroupOwner', id: 'fg-beta', owner: 'Anna' });
  run({
    type: 'factoryAssign',
    key: 'row-a',
    groups: [{ group: 'fg-alpha' }, { group: 'fg-beta', rate: 30 }, { group: 'fg-gamma' }],
  });
  run({ type: 'factoryLocal', id: 'fg-beta', items: ['Iron Ingot'] });
  run({
    type: 'factoryLinkTransport',
    from: 'fg-alpha',
    to: 'fg-beta',
    mode: 'drone',
    roundTripMin: 5,
  });
  run({ type: 'mapFactory', id: 'fg-beta', value: { x: 10, y: 20 } });
  return structuredClone(state);
}

test('remove then restore gives back the same profile', () => {
  const before = profile();
  const undo = restoreUpdate(before, 'fg-beta')!;
  assert.deepEqual(undo.index, 1);
  const removed = mutate(structuredClone(before), { type: 'factoryGroupRemove', id: 'fg-beta' });
  assert.ok(!removed.factoryGroups.groups.some(group => group.id === 'fg-beta'));
  const restored = mutate(structuredClone(removed), undo);
  assert.deepEqual(restored.factoryGroups, before.factoryGroups, 'groups, shares, links, items');
  assert.deepEqual(restored.factoryPlaces, before.factoryPlaces);
});

test('restore is refused when the factory id is taken, or the update is malformed', () => {
  const before = profile();
  const undo = restoreUpdate(before, 'fg-beta')!;
  assert.throws(() => mutate(structuredClone(before), undo), /Invalid factory/);
  const removed = mutate(structuredClone(before), { type: 'factoryGroupRemove', id: 'fg-beta' });
  for (const bad of [
    { ...undo, index: -1 },
    { ...undo, index: 1.5 },
    { ...undo, group: { id: 'bad id', name: 'x' } },
    { ...undo, assignments: [{ key: 'row-a', index: 0, rate: -3 }] },
    { ...undo, links: { 'fg-beta:fg-nowhere': { mode: 'drone', roundTripMin: 5 } } },
    { ...undo, local: ['Not An Item'] },
    { ...undo, stations: [7] },
  ])
    assert.throws(() => mutate(structuredClone(removed), bad as never));
});

test('a part that no longer fits is skipped, not duplicated', () => {
  const before = profile();
  const undo = restoreUpdate(before, 'fg-beta')!;
  const removed = mutate(structuredClone(before), { type: 'factoryGroupRemove', id: 'fg-beta' });
  // The line was assigned to a new factory meanwhile; the restored factory still comes back.
  const changed = mutate(structuredClone(removed), {
    type: 'factoryAssign',
    key: 'row-a',
    groups: [{ group: 'fg-gamma' }],
  });
  const restored = mutate(structuredClone(changed), undo);
  assert.ok(restored.factoryGroups.groups.some(group => group.id === 'fg-beta'));
  assert.deepEqual(
    restored.factoryGroups.assignments['row-a']!.map(member => member.group),
    ['fg-gamma', 'fg-beta'],
  );
});
