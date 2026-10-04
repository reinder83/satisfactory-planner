// A row's home group (homeGroup, the build plan's site) and its places (rowPlaces, the Logistics
// page and a group's flow) in public/app/group-order.ts agree, also when the row keeps a
// membership of a removed group (#900). Rows without one keep the home group they had before,
// unless no group has a share of them: those are Ungrouped since #942 (home-group-dust.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupedRows,
  homeGroup,
  LINK_DUST,
  rowMemberships,
  rowPlaces,
  rowShares,
  rowTotal,
  UNGROUPED,
  type GroupsInput,
} from '../public/app/group-order.ts';
import type { CalcRow, GroupAssignment } from '../public/types/index.ts';

const row = (
  id: string,
  total: number,
  extra: Partial<CalcRow> = {},
  inputs: CalcRow['inputs'] = {},
): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs: total ? { [`${id} item`]: total } : {},
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 4,
  generationMW: 0,
  ...extra,
});

const KNOWN = ['g1', 'g2', 'g3', 'g4'],
  REMOVED = ['gone', 'gone-too'];
const groupsOf = (assignments: Record<string, GroupAssignment[]>): GroupsInput => ({
  groups: KNOWN.map(id => ({ id, name: id })),
  assignments,
});

// homeGroup as released before #900, kept here to show that rows without a removed group's
// membership keep their home group.
function releasedHomeGroup(row: CalcRow, groups: GroupsInput): string {
  const known = new Set((groups?.groups || []).map(group => group.id));
  const memberships = rowMemberships(row, groups).filter(membership => known.has(membership.group));
  if (!memberships.length) return UNGROUPED;
  let home = memberships[0]!.group,
    largest = 0;
  for (const [place, share] of rowShares(rowTotal(row), memberships))
    if (place !== UNGROUPED && share > largest + LINK_DUST) [home, largest] = [place, share];
  return home;
}

test('the issue’s row: a removed group’s fixed rate takes up the row, so it is Ungrouped', () => {
  const r = row('r', 17.2);
  const groups = groupsOf({
    r: [
      { group: 'gone', rate: 41.68 },
      { group: 'g1', rate: null },
      { group: 'g3', rate: 18.78 },
    ],
  });
  assert.deepEqual([...rowPlaces(r, groups)], [[UNGROUPED, 1]]);
  assert.equal(homeGroup(r, groups), UNGROUPED);
  // Released: g3, a group whose flow page does not show the row.
  assert.equal(releasedHomeGroup(r, groups), 'g3');
  // The order of the memberships does not matter: with an existing group first, still Ungrouped.
  const reordered = groupsOf({
    r: [
      { group: 'g1', rate: null },
      { group: 'gone', rate: 41.68 },
      { group: 'g3', rate: 18.78 },
    ],
  });
  assert.deepEqual([...rowPlaces(r, reordered)], [[UNGROUPED, 1]]);
  assert.equal(homeGroup(r, reordered), UNGROUPED);
});

test('a removed group’s fixed rate can move the larger share to another group', () => {
  // Of 100: gone 50, g2 30 (fixed), g1 the open rest, 20. Released, without gone, g1 had 70.
  const r = row('r', 100);
  const groups = groupsOf({
    r: [
      { group: 'g1', rate: null },
      { group: 'gone', rate: 50 },
      { group: 'g2', rate: 30 },
    ],
  });
  const places = rowPlaces(r, groups);
  assert.ok(Math.abs(places.get('g2')! - 0.3) < 1e-9);
  assert.ok(Math.abs(places.get('g1')! - 0.2) < 1e-9);
  assert.equal(homeGroup(r, groups), 'g2');
  assert.equal(releasedHomeGroup(r, groups), 'g1');
});

test('the build order follows the new home group, and its memo sees a changed rate', () => {
  // ingot feeds plate; plate is in g1 (open) and g2 (fixed), with a removed group's fixed rate.
  const ingot = row('ingot', 30),
    plate = row('plate', 20, {}, { 'ingot item': 30 }),
    rod = row('rod', 10);
  const rows = [ingot, plate, rod];
  const order = (goneRate: number) =>
    groupedRows(
      rows,
      groupsOf({
        ingot: [{ group: 'g1', rate: null }],
        plate: [
          { group: 'g1', rate: null },
          { group: 'gone', rate: goneRate },
          { group: 'g2', rate: 7 },
        ],
        rod: [{ group: 'g1', rate: null }],
      }),
    ).map(r => r.id);
  // gone takes 2 of 20: g1 has 11, g2 7, so plate is built with g1, in the planner's order.
  assert.deepEqual(order(2), ['ingot', 'plate', 'rod']);
  // gone takes 10: g2 has 7, g1 3, so plate is built with g2, after g1's rows.
  assert.deepEqual(order(10), ['ingot', 'rod', 'plate']);
  assert.deepEqual(order(2), ['ingot', 'plate', 'rod'], 'the memo keeps each answer apart');
});

// A small deterministic generator (mulberry32), so a failure can be replayed.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generatedRows(withRemoved: boolean, count: number, seed: number) {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const cases: { row: CalcRow; groups: GroupsInput }[] = [];
  for (let i = 0; i < count; i++) {
    const total = next() < 0.05 ? 0 : Math.round(next() * 2400) / 10 + 0.1;
    const generator = next() < 0.1;
    const extra: Partial<CalcRow> = generator ? { outputs: {}, generationMW: total } : {};
    // Now and then a group's own line made on site, of an existing or a removed group.
    if (next() < 0.1) extra.onSite = { group: pick([...KNOWN, ...REMOVED]), recipe: 'wire' };
    const id = extra.onSite ? `wire:${extra.onSite.group}` : `row-${i}`;
    const r = row(id, generator ? 0 : total, extra);
    const places = withRemoved ? [...KNOWN, ...REMOVED] : KNOWN;
    const memberships: GroupAssignment[] = [];
    const size = Math.floor(next() * 5);
    for (let m = 0; m < size; m++) {
      const kind = next();
      const rate =
        kind < 0.4
          ? null
          : kind < 0.5 && total
            ? total / 2 // exact ties
            : Math.round(next() * Math.max(total, 1) * 15) / 10 + 0.1;
      memberships.push({ group: pick(places), rate });
    }
    // With removed groups: make sure each row has at least one such membership.
    if (withRemoved && !memberships.some(m => REMOVED.includes(m.group)))
      memberships.splice(Math.floor(next() * (memberships.length + 1)), 0, {
        group: pick(REMOVED),
        rate: next() < 0.5 ? null : Math.round(next() * Math.max(total, 1) * 15) / 10 + 0.1,
      });
    cases.push({ row: r, groups: groupsOf(memberships.length ? { [id]: memberships } : {}) });
  }
  return cases;
}

// What homeGroup must name for the places rowPlaces gives: the group with the largest share (the
// first in rowShares' order on a tie); when no existing group has a share, Ungrouped (#942).
function expectedHome(r: CalcRow, groups: GroupsInput): string {
  const shares = [...rowPlaces(r, groups)].filter(
    ([place, share]) => place !== UNGROUPED && share > LINK_DUST,
  );
  if (shares.length) {
    const top = Math.max(...shares.map(([, share]) => share));
    return shares.find(([, share]) => share >= top - LINK_DUST)![0];
  }
  return UNGROUPED;
}

test('homeGroup names the group rowPlaces gives the largest share, for generated rows', () => {
  for (const withRemoved of [false, true])
    for (const { row: r, groups } of generatedRows(withRemoved, 3000, withRemoved ? 900 : 869)) {
      const home = homeGroup(r, groups),
        places = rowPlaces(r, groups);
      const what = `${r.id} ${JSON.stringify(rowMemberships(r, groups))} of ${rowTotal(r)}`;
      assert.equal(home, expectedHome(r, groups), what);
      const groupShares = [...places].filter(([place]) => place !== UNGROUPED);
      if (groupShares.some(([, share]) => share > LINK_DUST)) {
        // Never a group with less than another, nor one with no share.
        assert.ok((places.get(home) || 0) > LINK_DUST, `${what}: ${home} has a share`);
        for (const [place, share] of groupShares)
          assert.ok(share <= places.get(home)! + LINK_DUST, `${what}: ${place} over ${home}`);
      } else
        // No group has a share, whatever the order of the memberships: rowPlaces puts the row in
        // Ungrouped, and so does homeGroup (#942).
        assert.equal(home, UNGROUPED, what);
    }
});

test('rows without a removed group’s membership keep their home group when a group has a share', () => {
  let changedWithRemoved = 0;
  for (const withRemoved of [false, true])
    for (const { row: r, groups } of generatedRows(withRemoved, 3000, withRemoved ? 7 : 3)) {
      const what = `${r.id} ${JSON.stringify(rowMemberships(r, groups))} of ${rowTotal(r)}`;
      // A row no group has a share of (a total of zero here) is Ungrouped since #942.
      const shared = [...rowPlaces(r, groups)].some(
        ([place, share]) => place !== UNGROUPED && share > LINK_DUST,
      );
      if (!withRemoved && !shared) assert.equal(homeGroup(r, groups), UNGROUPED, what);
      else if (!withRemoved) assert.equal(homeGroup(r, groups), releasedHomeGroup(r, groups), what);
      else if (homeGroup(r, groups) !== releasedHomeGroup(r, groups)) changedWithRemoved++;
    }
  // The generator does reach the rows #900 is about.
  assert.ok(changedWithRemoved > 0);
});
