// How homeGroup (public/app/group-order.ts) breaks a tie between two groups' shares of a row, as
// the code comment and AGENTS.md describe it (#928): a membership with a fixed rate comes before
// an open one, then the saved order. Changing this would silently move rows between groups in
// the build order of existing saves, so the rule is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeGroup, rowPlaces, type GroupsInput } from '../public/app/group-order.ts';
import type { CalcRow, GroupAssignment } from '../public/types/index.ts';

const row = (total: number): CalcRow => ({
  id: 'r',
  name: 'r',
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs: {},
  outputs: { Wire: total },
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 4,
  generationMW: 0,
});
const groupsOf = (memberships: GroupAssignment[]): GroupsInput => ({
  groups: ['a', 'b', 'c'].map(id => ({ id, name: id })),
  assignments: { r: memberships },
});

test('on a tie, a fixed-rate membership wins over an open one saved before it', () => {
  // Of 20: b takes its fixed 10, a the open rest, 10.
  const groups = groupsOf([
    { group: 'a', rate: null },
    { group: 'b', rate: 10 },
  ]);
  assert.deepEqual(Object.fromEntries(rowPlaces(row(20), groups)), { b: 0.5, a: 0.5 });
  assert.equal(homeGroup(row(20), groups), 'b');
});

test('on a tie between two open memberships, the earlier saved one wins', () => {
  const groups = groupsOf([
    { group: 'c', rate: null },
    { group: 'a', rate: null },
  ]);
  assert.equal(homeGroup(row(20), groups), 'c');
});

test('on a tie between two fixed rates, the earlier saved one wins', () => {
  const groups = groupsOf([
    { group: 'c', rate: 10 },
    { group: 'b', rate: 10 },
  ]);
  assert.equal(homeGroup(row(20), groups), 'c');
});

test('without a tie the larger share wins, whatever the order', () => {
  const groups = groupsOf([
    { group: 'a', rate: null },
    { group: 'b', rate: 9 },
  ]);
  assert.equal(homeGroup(row(20), groups), 'a');
});
