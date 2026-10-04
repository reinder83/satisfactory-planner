// A row that no existing group takes a real share of is built as Ungrouped (#942): homeGroup in
// public/app/group-order.ts names a group only where rowPlaces (the Logistics page and a group's
// flow) gives that group a share above LINK_DUST. Before, a row whose only fixed rates were too
// small to count, or whose total was zero, was built with its first membership's group, whose
// flow page did not show it. Rows with a real share in a group keep the home group they had.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupedRows,
  groupedSteps,
  homeGroup,
  LINK_DUST,
  rowMemberships,
  rowPlaces,
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

const KNOWN = ['g1', 'g2', 'g3'],
  REMOVED = ['gone'];
const groupsOf = (assignments: Record<string, GroupAssignment[]>): GroupsInput => ({
  groups: KNOWN.map(id => ({ id, name: id })),
  assignments,
});

// homeGroup as it was on main before #942 (after #900 and #928), frozen here to show that every
// row with a real share in a group keeps its home group.
function mainHomeGroup(r: CalcRow, groups: GroupsInput): string {
  let home: string | undefined,
    largest = 0;
  for (const [place, share] of rowPlaces(r, groups))
    if (place !== UNGROUPED && share > largest + LINK_DUST) [home, largest] = [place, share];
  if (home) return home;
  const known = new Set((groups?.groups || []).map(group => group.id));
  const memberships = rowMemberships(r, groups);
  if (rowTotal(r) > LINK_DUST && memberships.some(membership => !known.has(membership.group)))
    return UNGROUPED;
  const first = memberships[0]?.group;
  return first && known.has(first) ? first : UNGROUPED;
}

// Whether rowPlaces gives an existing group a share above dust.
const anyGroupShare = (r: CalcRow, groups: GroupsInput) =>
  [...rowPlaces(r, groups)].some(([place, share]) => place !== UNGROUPED && share > LINK_DUST);

test('the issue’s row: a fixed rate too small to count leaves the row Ungrouped', () => {
  const r = row('r', 240);
  const groups = groupsOf({ r: [{ group: 'g1', rate: 0.0001 }] });
  const places = rowPlaces(r, groups);
  assert.deepEqual([...places.keys()], [UNGROUPED], 'the tiny share is dropped as dust');
  assert.ok(Math.abs(places.get(UNGROUPED)! - (1 - 0.0001 / 240)) < 1e-12);
  assert.equal(homeGroup(r, groups), UNGROUPED);
  assert.equal(mainHomeGroup(r, groups), 'g1', 'main built it with g1');
  // Several such rates, in any order, and one beside a removed group: still Ungrouped.
  for (const memberships of [
    [
      { group: 'g2', rate: 0.0001 },
      { group: 'g1', rate: 0.0002 },
    ],
    [
      { group: 'g1', rate: 0.0001 },
      { group: 'gone', rate: 3 },
    ],
  ])
    assert.equal(homeGroup(r, groupsOf({ r: memberships })), UNGROUPED);
  // A small rate that is still more than dust of the row counts, as rowPlaces counts it.
  const small = groupsOf({ r: [{ group: 'g1', rate: 0.001 }] });
  assert.ok(anyGroupShare(r, small));
  assert.equal(homeGroup(r, small), 'g1');
});

test('a row with a total of zero or dust is Ungrouped, whatever its memberships', () => {
  const rows = [
    row('none', 0),
    row('dust', LINK_DUST / 2),
    row('exactly-dust', LINK_DUST),
    row('idle-generator', 0, { outputs: {}, generationMW: 0 }),
  ];
  for (const r of rows)
    for (const memberships of [
      [{ group: 'g1', rate: null }],
      [{ group: 'g2', rate: 5 }],
      [
        { group: 'g3', rate: null },
        { group: 'g1', rate: null },
      ],
    ]) {
      const groups = groupsOf({ [r.id]: memberships });
      const what = `${r.id} ${JSON.stringify(memberships)}`;
      assert.deepEqual([...rowPlaces(r, groups)], [[UNGROUPED, 1]], what);
      assert.equal(homeGroup(r, groups), UNGROUPED, what);
      assert.equal(mainHomeGroup(r, groups), memberships[0]!.group, `${what}: main`);
    }
  // A group's own line made on site follows the same rule (rowMemberships gives it its group).
  const line = row('wire:g1', 0, { onSite: { group: 'g1', recipe: 'wire' } });
  assert.equal(homeGroup(line, groupsOf({})), UNGROUPED);
  assert.equal(homeGroup(row('wire:g1', 30, { onSite: line.onSite }), groupsOf({})), 'g1');
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

// Rows with every kind of membership: open, fixed, tied, fixed rates too small to count or just
// above dust, removed groups, groups' own lines made on site; and totals of zero, dust, ordinary
// and large, of production lines and of generators.
function generatedRows(count: number, seed: number) {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const cases: { row: CalcRow; groups: GroupsInput }[] = [];
  for (let i = 0; i < count; i++) {
    const kind = next();
    const total =
      kind < 0.08
        ? 0
        : kind < 0.12
          ? LINK_DUST * next() * 2
          : kind < 0.2
            ? Math.round(next() * 50000) + 1000
            : Math.round(next() * 2400) / 10 + 0.1;
    const generator = next() < 0.1;
    const extra: Partial<CalcRow> = generator ? { outputs: {}, generationMW: total } : {};
    if (next() < 0.08) extra.onSite = { group: pick([...KNOWN, ...REMOVED]), recipe: 'wire' };
    const id = extra.onSite ? `wire:${extra.onSite.group}` : `row-${i}`;
    const r = row(id, generator ? 0 : total, extra);
    const memberships: GroupAssignment[] = [];
    const size = Math.floor(next() * 4);
    for (let m = 0; m < size; m++) {
      const rateKind = next();
      const rate =
        rateKind < 0.3
          ? null
          : rateKind < 0.4 && total
            ? total / 2 // exact ties
            : rateKind < 0.6
              ? pick([0.0001, 0.00002, total * LINK_DUST * next(), total * LINK_DUST * 1.5]) ||
                0.0001 // too small to count, or just above dust
              : Math.round(next() * Math.max(total, 1) * 15) / 10 + 0.1;
      memberships.push({ group: pick(next() < 0.85 ? KNOWN : REMOVED), rate });
    }
    cases.push({ row: r, groups: groupsOf(memberships.length ? { [id]: memberships } : {}) });
  }
  return cases;
}

const describe = (r: CalcRow, groups: GroupsInput) =>
  `${r.id} ${JSON.stringify(rowMemberships(r, groups))} of ${rowTotal(r)}`;

test('homeGroup is Ungrouped exactly when rowPlaces gives no existing group a share', () => {
  let ungrouped = 0,
    grouped = 0;
  for (const { row: r, groups } of generatedRows(6000, 942)) {
    const home = homeGroup(r, groups),
      places = rowPlaces(r, groups),
      what = describe(r, groups);
    if (anyGroupShare(r, groups)) {
      grouped++;
      assert.notEqual(home, UNGROUPED, what);
      // The group it names has a real share, and no group has a larger one.
      assert.ok((places.get(home) || 0) > LINK_DUST, `${what}: ${home} has a share`);
      for (const [place, share] of places)
        if (place !== UNGROUPED)
          assert.ok(share <= places.get(home)! + LINK_DUST, `${what}: ${place} over ${home}`);
    } else {
      ungrouped++;
      assert.equal(home, UNGROUPED, what);
    }
  }
  // The generator reaches both sides.
  assert.ok(ungrouped > 500 && grouped > 500, `${ungrouped} ungrouped, ${grouped} grouped`);
});

test('rows with a real share in a group keep the home group they had on main', () => {
  let changed = 0;
  for (const { row: r, groups } of generatedRows(6000, 869)) {
    const what = describe(r, groups);
    if (anyGroupShare(r, groups))
      assert.equal(homeGroup(r, groups), mainHomeGroup(r, groups), what);
    else if (mainHomeGroup(r, groups) !== UNGROUPED) changed++;
  }
  // The generator does reach the rows #942 is about.
  assert.ok(changed > 0);
});

test('the build order builds a row no group really takes after the groups, with the same ids', () => {
  // ingot and rod are g1's; plate uses ingot and has a fixed rate in g1.
  const ingot = row('ingot', 30),
    plate = row('plate', 240, {}, { 'ingot item': 30 }),
    rod = row('rod', 10);
  const rows = [ingot, plate, rod];
  const groupsWith = (rate: number) =>
    groupsOf({
      ingot: [{ group: 'g1', rate: null }],
      plate: [{ group: 'g1', rate }],
      rod: [{ group: 'g1', rate: null }],
    });
  const order = (rate: number) => groupedRows(rows, groupsWith(rate)).map(r => r.id);
  // A rate too small to count: plate is Ungrouped, so it follows g1's run.
  assert.deepEqual(order(0.0001), ['ingot', 'rod', 'plate']);
  // A real rate: plate is g1's, and the planner's order stands.
  assert.deepEqual(order(10), ['ingot', 'plate', 'rod']);
  assert.deepEqual(order(0.0001), ['ingot', 'rod', 'plate'], 'the memo keeps each answer apart');
  // The build plan's steps: the same steps and ids, only the production steps reordered.
  type Step = { id: string; row?: CalcRow };
  const steps: Step[] = [
    { id: 'power' },
    ...rows.map(r => ({ id: `calc-1-${r.id}`, row: r })),
    { id: 'storage' },
  ];
  const ordered = groupedSteps(steps, groupsWith(0.0001));
  assert.deepEqual(
    ordered.map(step => step.id),
    ['power', 'calc-1-ingot', 'calc-1-rod', 'calc-1-plate', 'storage'],
  );
  assert.deepEqual(ordered.map(step => step.id).sort(), steps.map(step => step.id).sort());
  assert.ok(
    ordered.every(step => steps.includes(step)),
    'the steps themselves, unchanged',
  );
});
