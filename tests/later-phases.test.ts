// What a production line and a factory grow to in the later phases of the same plan (#1299,
// public/app/later-phases.ts), and the rough footprint in foundations (public/app/footprints.ts).
// The line is the same by its row id in every phase; only the stored plan's stages are read, so
// nothing is stored or recalculated. Numbers are written as in en-US.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDATION_M2, MACHINE_FOOTPRINTS, machineFoundations } from '../public/app/footprints.ts';
import {
  groupGrowth,
  groupGrowthText,
  laterPhase,
  lineGrowth,
  lineGrowthText,
} from '../public/app/later-phases.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, StoredCalculatedPlan, StoredStage } from '../public/types/index.ts';

// A row with only what these read; the rest are the neutral values a real row carries.
const row = (id: string, machine: string, machines: number): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine,
  power: 4,
  inputs: {},
  outputs: { [id]: machines * 10 },
  equivalent: machines,
  machines,
  lastClock: 100,
  peakMW: machines * 4,
  generationMW: 0,
});

// A plan of the given stages on a real plan's frame: every other phase plans nothing.
let framePlan: StoredCalculatedPlan | undefined;
const frame = (): StoredCalculatedPlan => (framePlan ??= calculate({ wholeMachines: true }));
const planOf = (stages: Partial<Record<'1' | '2' | '3' | '4' | '5', CalcRow[]>>) => {
  const none: StoredStage = { feasible: false };
  const stageOf = (key: '1' | '2' | '3' | '4' | '5'): StoredStage =>
    stages[key] ? { feasible: true, rows: stages[key] } : none;
  return {
    ...frame(),
    stages: {
      '1': stageOf('1'),
      '2': stageOf('2'),
      '3': stageOf('3'),
      '4': stageOf('4'),
      '5': stageOf('5'),
    },
  } satisfies StoredCalculatedPlan;
};

test('a line that grows says what it needs in each later phase (#1299)', () => {
  const plan = planOf({
    '3': [row('plastic', 'Refinery', 41)],
    '4': [row('plastic', 'Refinery', 89)],
    '5': [row('plastic', 'Refinery', 225)],
  });
  const growth = lineGrowth(plan, '3', 'plastic');
  assert.deepEqual(growth, {
    machine: 'Refinery',
    phases: [
      { phase: '4', machines: 89 },
      { phase: '5', machines: 225 },
    ],
    droppedAfter: null,
  });
  assert.equal(lineGrowthText(growth!), 'Phase 4: 89 · Phase 5: 225 Refineries');
  // From Phase 4 only Phase 5 is later.
  assert.equal(lineGrowthText(lineGrowth(plan, '4', 'plastic')!), 'Phase 5: 225 Refineries');
  // Large counts are grouped, a single machine is named in the singular.
  const big = planOf({
    '4': [row('screw', 'Constructor', 3)],
    '5': [row('screw', 'Constructor', 1250)],
  });
  assert.equal(lineGrowthText(lineGrowth(big, '4', 'screw')!), 'Phase 5: 1,250 Constructors');
  const one = planOf({ '4': [row('rod', 'Constructor', 3)], '5': [row('rod', 'Constructor', 1)] });
  assert.equal(lineGrowthText(lineGrowth(one, '4', 'rod')!), 'Phase 5: 1 Constructor');
});

test('nothing to say when every later phase builds the line the same, or none is planned', () => {
  const same = planOf({
    '3': [row('wire', 'Constructor', 6)],
    '4': [row('wire', 'Constructor', 6)],
    '5': [row('wire', 'Constructor', 6)],
  });
  assert.equal(lineGrowth(same, '3', 'wire'), null);
  // The last phase of the plan, and Phase 5, have nothing after them.
  const ends = planOf({ '3': [row('wire', 'Constructor', 6)] });
  assert.equal(lineGrowth(ends, '3', 'wire'), null);
  assert.equal(lineGrowth(same, '5', 'wire'), null);
  // A line the phase shown does not build, a missing plan.
  assert.equal(lineGrowth(same, '3', 'cable'), null);
  assert.equal(lineGrowth(null, '3', 'wire'), null);
  // A phase without rows (infeasible, or not planned) does not count as a later phase.
  const gap = planOf({
    '3': [row('wire', 'Constructor', 6)],
    '5': [row('wire', 'Constructor', 6)],
  });
  assert.equal(lineGrowth(gap, '3', 'wire'), null);
});

test('a line later phases drop says it is not needed after its last phase', () => {
  const plan = planOf({
    '3': [row('ingot', 'Smelter', 12), row('other', 'Smelter', 1)],
    '4': [row('ingot', 'Smelter', 30), row('other', 'Smelter', 1)],
    '5': [row('other', 'Smelter', 1)],
  });
  assert.equal(
    lineGrowthText(lineGrowth(plan, '3', 'ingot')!),
    'Phase 4: 30 Smelters · not needed after Phase 4',
  );
  // From Phase 4, no later phase has it at all.
  const growth = lineGrowth(plan, '4', 'ingot');
  assert.deepEqual(growth, { machine: 'Smelter', phases: [], droppedAfter: '4' });
  assert.equal(lineGrowthText(growth!), 'Not needed after Phase 4');
  // The same machines up to the phase that drops it still say so.
  const kept = planOf({
    '3': [row('ingot', 'Smelter', 12)],
    '4': [row('ingot', 'Smelter', 12)],
    '5': [row('other', 'Smelter', 1)],
  });
  assert.equal(
    lineGrowthText(lineGrowth(kept, '3', 'ingot')!),
    'Phase 4: 12 Smelters · not needed after Phase 4',
  );
});

test('a phase between that does not build the line says none', () => {
  const plan = planOf({
    '3': [row('fuel', 'Refinery', 6)],
    '4': [row('other', 'Refinery', 1)],
    '5': [row('fuel', 'Refinery', 4)],
  });
  assert.equal(
    lineGrowthText(lineGrowth(plan, '3', 'fuel')!),
    'Phase 4: none · Phase 5: 4 Refineries',
  );
  // delivered.ts's lookup of the first later phase that builds the line reads the same stages.
  assert.equal(laterPhase(plan, '3', 'fuel'), '5');
  assert.equal(laterPhase(plan, '4', 'other'), null);
});

test('the lines of a real plan grow by their own row ids', () => {
  const plan = frame();
  for (const line of plan.stages['3']!.rows!) {
    const growth = lineGrowth(plan, '3', line.id);
    if (!growth) continue;
    for (const { phase, machines } of growth.phases)
      assert.equal(
        machines,
        plan.stages[phase]!.rows!.find(other => other.id === line.id)?.machines ?? 0,
        `${line.name} in Phase ${phase}`,
      );
  }
  // Iron Ingot grows in every later phase of the whole-machine plan.
  const ingot = plan.stages['3']!.rows!.find(line => line.id === 'Recipe_IngotIron_C')!;
  assert.match(
    lineGrowthText(lineGrowth(plan, '3', ingot.id)!),
    /^Phase 4: [\d,]+ · Phase 5: [\d,]+ Smelters$/,
  );
});

test('machine footprints in foundations', () => {
  // A foundation is 8 m × 8 m.
  assert.equal(FOUNDATION_M2, 64);
  // A Packager stands on one foundation, a Constructor on 1.25, a Refinery on 3.4375.
  assert.equal(machineFoundations('Packager', 1), 1);
  assert.equal(machineFoundations('Constructor', 4), 5);
  assert.equal(machineFoundations('Refinery', 2), 6.875);
  // A building the table does not know takes none, rather than a guess.
  assert.equal(machineFoundations('Space Elevator', 3), 0);
  // Every machine a plan's lines use has a footprint.
  const machines = new Set(
    Object.values(frame().stages).flatMap(stage => (stage?.rows || []).map(line => line.machine)),
  );
  for (const machine of machines)
    assert.ok(MACHINE_FOOTPRINTS[machine], `${machine} has a footprint`);
});

test('a factory counts its share of its lines in each phase, with their foundations', () => {
  const plan = planOf({
    '3': [row('plate', 'Constructor', 8), row('rod', 'Constructor', 4), row('pipe', 'Refinery', 2)],
    '4': [row('plate', 'Constructor', 16), row('rod', 'Constructor', 4)],
    '5': [row('plate', 'Constructor', 40), row('pipe', 'Refinery', 10)],
  });
  const groups = {
    groups: [
      { id: 'fg-a', name: 'Alpha' },
      { id: 'fg-b', name: 'Beta' },
    ],
    assignments: {
      plate: [{ group: 'fg-a', rate: null }],
      // Split evenly with Beta: half its machines here.
      rod: [
        { group: 'fg-a', rate: null },
        { group: 'fg-b', rate: null },
      ],
      pipe: [{ group: 'fg-b', rate: null }],
    },
  };
  const sizes = groupGrowth(plan, '3', 'fg-a', groups);
  assert.deepEqual(sizes, [
    { phase: '3', machines: 10, foundations: 12.5 },
    { phase: '4', machines: 18, foundations: 22.5 },
    { phase: '5', machines: 40, foundations: 50 },
  ]);
  assert.equal(
    groupGrowthText(sizes),
    'Phase 3: 10 machines, ≈\u00a013 foundations · Phase 4: 18, ≈\u00a023 · Phase 5: 40, ≈\u00a050',
  );
  // Beta: half the rods and the Refineries, which Phase 4 does not build.
  assert.equal(
    groupGrowthText(groupGrowth(plan, '3', 'fg-b', groups)),
    'Phase 3: 4 machines, ≈\u00a010 foundations · Phase 4: 2, ≈\u00a03 · Phase 5: 10, ≈\u00a035',
  );
  // From Phase 5 only that phase; a factory with no machine anywhere has nothing to say.
  assert.equal(
    groupGrowthText(groupGrowth(plan, '5', 'fg-a', groups)),
    'Phase 5: 40 machines, ≈\u00a050 foundations',
  );
  assert.deepEqual(groupGrowth(plan, '3', 'fg-c', groups), []);
  assert.deepEqual(groupGrowth(null, '3', 'fg-a', groups), []);
  // One machine is a machine.
  const one = planOf({ '5': [row('plate', 'Packager', 1)] });
  assert.equal(
    groupGrowthText(groupGrowth(one, '5', 'fg-a', groups)),
    'Phase 5: 1 machine, ≈\u00a01 foundation',
  );
});
