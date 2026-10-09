// Each factory's part of the handover from the phase before (#1069, handoverLines and placeHandover
// in public/app/handover.ts), as the Factories page shows it: every line of the phase is kept as it
// runs, kept with machines to add or switch off or a clock to change (with the build-plan step's own
// sentence), new in this phase, or built in the phase before but not marked running there; the
// lines retired go with the factory their row id belongs to. A factory's counts are the build
// plan's summary counted over its lines. It only reads the stored plan and the saved checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import {
  carriedChange,
  carriedLine,
  carriedText,
  handoverLines,
  handoverText,
  phaseHandover,
  placeHandover,
  type HandoverLines,
} from '../public/app/handover.ts';
import { rowMemberships, UNGROUPED } from '../public/app/group-order.ts';
import { formatNumber as n, retiredLines, retiredLineText } from '../public/progression.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const row = (id: string, machine: string, machines: number, lastClock: number): CalcRow =>
  ({
    id,
    name: id,
    phase: 1,
    machine,
    power: 4,
    inputs: {},
    outputs: { [id]: 30 },
    equivalent: machines - 1 + lastClock / 100,
    machines,
    lastClock,
    peakMW: 4 * machines,
    generationMW: 0,
  }) as CalcRow;

// The issue's example (as in tests/phase-handover.test.ts): Iron Ingot grows, Iron Plate stays,
// Iron Rod changes only its clock, Screw shrinks, Wire is retired and Cable is new; Copper Ingot
// runs in both phases.
type Plan = Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>;
const smallPlan = (): Plan =>
  ({
    settings: { phase: '1' },
    stages: {
      '1': {
        rows: [
          row('Iron Ingot', 'Smelter', 8, 7.75),
          row('Iron Plate', 'Constructor', 3, 100),
          row('Iron Rod', 'Constructor', 1, 7.75),
          row('Screw', 'Constructor', 5, 100),
          row('Wire', 'Constructor', 2, 50),
          row('Copper Ingot', 'Smelter', 2, 100),
        ],
      },
      '2': {
        rows: [
          row('Iron Ingot', 'Smelter', 14, 82.25),
          row('Iron Plate', 'Constructor', 3, 100),
          row('Iron Rod', 'Constructor', 1, 82.25),
          row('Screw', 'Constructor', 3, 50),
          row('Cable', 'Constructor', 4, 100),
          row('Copper Ingot', 'Smelter', 3, 100),
        ],
      },
    },
  }) as Plan;

// Phase 1 ran everything but Copper Ingot.
const RAN = Object.freeze({
  'calc-1-Iron Ingot': true,
  'calc-1-Iron Plate': true,
  'calc-1-Iron Rod': true,
  'calc-1-Screw': true,
  'calc-1-Wire': true,
});

// Two factories: Iron (the iron lines and the retired Wire) and Wire works (Cable); Copper Ingot is
// in no factory.
const GROUPS: FactoryGroups = {
  groups: [
    { id: 'fg-iron', name: 'Iron' },
    { id: 'fg-wire', name: 'Wire works' },
  ],
  assignments: {
    'Iron Ingot': [{ group: 'fg-iron', rate: null }],
    'Iron Plate': [{ group: 'fg-iron', rate: null }],
    'Iron Rod': [{ group: 'fg-iron', rate: null }],
    Screw: [{ group: 'fg-iron', rate: null }],
    Wire: [{ group: 'fg-iron', rate: null }],
    Cable: [{ group: 'fg-wire', rate: null }],
  },
};
// A place as the Factories page draws it: a factory's rows have a membership in it, Ungrouped's
// none.
const inPlace =
  (place: string, groups: FactoryGroups = GROUPS) =>
  (line: Pick<CalcRow, 'id' | 'onSite'>) => {
    const memberships = rowMemberships(line, groups);
    return place === UNGROUPED
      ? !memberships.length
      : memberships.some(membership => membership.group === place);
  };
const ids = (lines: { row: CalcRow }[]) => lines.map(line => line.row.id);

test("each line of the phase gets its handover status and the step's own change sentence", () => {
  const handover = handoverLines(smallPlan(), RAN, '2')!;
  assert.equal(handover.from, '1');
  assert.deepEqual(
    handover.lines.map(line => [line.row.id, line.status, line.change]),
    [
      [
        'Iron Ingot',
        'add',
        `Add 6 machines, and raise the last Phase 1 Smelter from ${n(7.75)}% to 100%.`,
      ],
      ['Iron Plate', 'keep', ''],
      [
        'Iron Rod',
        'add',
        `Nothing to add: raise the last Constructor from ${n(7.75)}% to ${n(82.25)}%.`,
      ],
      [
        'Screw',
        'add',
        'This phase needs 2 machines fewer: switch off 2 and set the last one to 50%.',
      ],
      ['Cable', 'new', ''],
      // Phase 1 built it but did not mark it running.
      ['Copper Ingot', 'build', ''],
    ],
  );
  assert.deepEqual(
    handover.retired.map(line => [line.id, retiredLineText(line)]),
    [['Wire', '2 × Wire (Constructor)']],
  );
  // The build-plan step opens with what runs, then the same sentence.
  const stored = smallPlan(),
    ingot = stored.stages['2']!.rows![0]!,
    carried = carriedLine(stored, RAN, '2', ingot.id)!;
  assert.equal(
    carriedText(carried, ingot),
    `Running since Phase 1: 8 × Smelter, the last at ${n(7.75)}%. ${carriedChange(carried, ingot)} `,
  );
});

test("a factory's handover counts and lists its own lines and the lines it retires", () => {
  const handover = handoverLines(smallPlan(), RAN, '2')!;
  const iron = placeHandover(handover, inPlace('fg-iron'))!;
  assert.deepEqual(iron.counts, { from: '1', kept: 4, add: 6, clocks: 3, build: 0, retire: 1 });
  assert.deepEqual(ids(iron.keep), ['Iron Plate']);
  assert.deepEqual(ids(iron.add), ['Iron Ingot', 'Iron Rod', 'Screw']);
  assert.deepEqual([ids(iron.new), ids(iron.build)], [[], []]);
  assert.deepEqual(
    iron.retire.map(line => line.id),
    ['Wire'],
  );
  assert.equal(
    handoverText(iron.counts),
    'From Phase 1: keep 4 lines already running, adding 6 machines and changing 3 clocks; retire 1.',
  );
  const wire = placeHandover(handover, inPlace('fg-wire'))!;
  assert.deepEqual(wire.counts, { from: '1', kept: 0, add: 0, clocks: 0, build: 1, retire: 0 });
  assert.deepEqual(ids(wire.new), ['Cable']);
  assert.equal(
    handoverText(wire.counts),
    'From Phase 1: nothing marked running there carries over, so build its one line.',
  );
  const ungrouped = placeHandover(handover, inPlace(UNGROUPED))!;
  assert.deepEqual(ids(ungrouped.build), ['Copper Ingot']);
  assert.equal(ungrouped.retire.length, 0);
});

test("a factory's handover goes once its lines are marked running here, the page's once all are", () => {
  const stored = smallPlan();
  const ironDone = {
    ...RAN,
    'calc-2-Iron Ingot': true,
    'calc-2-Iron Plate': true,
    'calc-2-Iron Rod': true,
    'calc-2-Screw': true,
  };
  const handover = handoverLines(stored, ironDone, '2')!;
  assert.equal(placeHandover(handover, inPlace('fg-iron')), null, 'every Iron line runs here');
  assert.ok(placeHandover(handover, inPlace('fg-wire')), 'Cable is still to build');
  // A line ticked here keeps its status: the counts are the build plan's, which do not move as
  // lines are ticked.
  assert.equal(handover.lines.find(line => line.row.id === 'Iron Ingot')!.status, 'add');
  const all = Object.fromEntries(
    stored.stages['2']!.rows!.map(line => ['calc-2-' + line.id, true]),
  );
  assert.equal(handoverLines(stored, { ...RAN, ...all }, '2'), null);
  // Nothing before Phase 1, nothing into Post Phase 5 or on a plan guide, nothing in a phase
  // before the profile's start phase.
  assert.equal(handoverLines(stored, RAN, '1'), null);
  assert.equal(handoverLines(stored, { 'calc-4-Iron Ingot': true }, 'post'), null);
  assert.equal(handoverLines({ ...stored, guide: { phases: {} } } as Plan, RAN, '2'), null);
  const late = smallPlan();
  late.settings.phase = '2';
  assert.equal(handoverLines(late, RAN, '2'), null);
});

// On a real plan from Phase 1 (#1069): 1 → 2 and 2 → 3, with the phase before all running or every
// other line running. Every Phase N row is put in one of two factories or none, by its place in the
// list, and so is every retired row, so the places split the phase between them.
let made: CurrentCalculatedPlan | undefined;
const realPlan = () => structuredClone((made ??= calculate({ phase: '1' })));

const groupsFor = (rowIds: string[]): FactoryGroups => ({
  groups: [
    { id: 'fg-a', name: 'Alpha' },
    { id: 'fg-b', name: 'Beta' },
  ],
  assignments: Object.fromEntries(
    rowIds
      .map((id, i) => [id, i % 3] as const)
      .filter(([, place]) => place < 2)
      .map(([id, place]) => [id, [{ group: place ? 'fg-b' : 'fg-a', rate: null }]]),
  ),
});

function checkPlaces(stored: CurrentCalculatedPlan, from: StageKey, to: StageKey, every: number) {
  const checks = Object.fromEntries(
    stored.stages[from]
      .rows!.filter((_, i) => i % every === 0)
      .map(line => ['calc-' + from + '-' + line.id, true]),
  );
  const frozenChecks = structuredClone(checks),
    frozenPlan = structuredClone(stored);
  const handover = handoverLines(stored, checks, to) as HandoverLines;
  const label = `${from} → ${to}, every ${every}`;
  assert.ok(handover, label);
  // Each line's status follows the carried line and the phase before's rows.
  const before = new Set(stored.stages[from].rows!.map(line => line.id));
  for (const line of handover.lines) {
    const carried = carriedLine(stored, checks, to, line.row.id);
    const expected = carried
      ? carriedChange(carried, line.row) === 'Nothing to add or change.'
        ? 'keep'
        : 'add'
      : before.has(line.row.id)
        ? 'build'
        : 'new';
    assert.equal(line.status, expected, `${label}: ${line.row.id}`);
    if (line.status === 'add') assert.equal(line.change, carriedChange(carried!, line.row));
  }
  assert.deepEqual(
    handover.retired.map(line => line.id),
    retiredLines(stored, Number(to)).map(line => line.id),
  );
  // The places split the phase: their counts add up to the build plan's summary.
  const groups = groupsFor([...stored.stages[to].rows!, ...handover.retired].map(line => line.id));
  const places = ['fg-a', 'fg-b', UNGROUPED].map(place =>
    placeHandover(handover, inPlace(place, groups)),
  );
  const whole = phaseHandover(stored, checks, to)!;
  const sum = { from, kept: 0, add: 0, clocks: 0, build: 0, retire: 0 };
  for (const place of places) {
    assert.ok(place, label);
    for (const key of ['kept', 'add', 'clocks', 'build', 'retire'] as const)
      sum[key] += place.counts[key];
    assert.equal(place.counts.kept, place.keep.length + place.add.length);
    assert.equal(place.counts.build, place.new.length + place.build.length);
  }
  assert.deepEqual(sum, whole, label);
  assert.deepEqual(checks, frozenChecks, 'no tick is added, changed or dropped');
  assert.deepEqual(stored, frozenPlan, 'the stored plan is not changed');
  return { whole, handover };
}

test('on a real plan the factories split the handover 1 → 2 and 2 → 3', () => {
  const stored = realPlan();
  const oneTwo = checkPlaces(stored, '1', '2', 1);
  // Phase 2 keeps lines of Phase 1, changes some and builds new ones.
  const statuses = new Set(oneTwo.handover.lines.map(line => line.status));
  for (const status of ['keep', 'add', 'new'] as const) assert.ok(statuses.has(status), status);
  assert.ok(!statuses.has('build'), 'everything Phase 1 built ran');
  const partly = checkPlaces(stored, '1', '2', 2);
  assert.ok(
    partly.handover.lines.some(line => line.status === 'build'),
    'partly running',
  );
  assert.ok(partly.whole.kept < oneTwo.whole.kept);
  const twoThree = checkPlaces(stored, '2', '3', 1);
  // Phase 3 retires a line of Phase 2.
  assert.ok(twoThree.whole.retire > 0);
  checkPlaces(stored, '2', '3', 2);
});
