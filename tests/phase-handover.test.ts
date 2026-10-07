// The handover from one phase to the next (#1069, public/app/handover.ts): a line marked running in
// the phase before that this phase builds again under the same row id is already standing, so its
// step says what to add or change, and the build plan's handover summary counts the lines kept,
// the machines added, the clocks changed, the lines still to build and the ones retired. It only
// reads the stored plan and the saved checks: no tick is written, changed or dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carriedLine, carriedText, handoverText, phaseHandover } from '../public/app/handover.ts';
import { formatNumber as n, retiredLines } from '../public/progression.ts';
import type { CalcRow, StoredCalculatedPlan } from '../public/types/index.ts';

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

// Phase 1 runs eight Smelters, the last at 7.75%; Phase 2 needs fourteen, the last at 82.25%, as
// in the issue. The plate line keeps its size, the rod line only changes its clock, the screw
// line shrinks, the wire line is retired and the cable line is new.
const plan = (): Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'> =>
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
        ],
      },
      '2': {
        rows: [
          row('Iron Ingot', 'Smelter', 14, 82.25),
          row('Iron Plate', 'Constructor', 3, 100),
          row('Iron Rod', 'Constructor', 1, 82.25),
          row('Screw', 'Constructor', 3, 50),
          row('Cable', 'Constructor', 4, 100),
        ],
      },
    },
  }) as unknown as Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>;

const ALL_RUNNING = Object.freeze({
  'calc-1-Iron Ingot': true,
  'calc-1-Iron Plate': true,
  'calc-1-Iron Rod': true,
  'calc-1-Screw': true,
  'calc-1-Wire': true,
});

const text = (checks: Record<string, boolean>, id: string) => {
  const stored = plan(),
    line = stored.stages['2']!.rows!.find(candidate => candidate.id === id)!;
  const carried = carriedLine(stored, checks, '2', id);
  return carried ? carriedText(carried, line) : null;
};

test('a line marked running in Phase 1 says what Phase 2 adds or changes on it', () => {
  assert.equal(
    text(ALL_RUNNING, 'Iron Ingot'),
    `Running since Phase 1: 8 × Smelter, the last at ${n(7.75)}%. Add 6 machines, and raise ` +
      `the last Phase 1 Smelter from ${n(7.75)}% to 100%. `,
  );
  assert.equal(
    text(ALL_RUNNING, 'Iron Rod'),
    `Running since Phase 1: 1 × Constructor, the last at ${n(7.75)}%. Nothing to add: raise ` +
      `the last Constructor from ${n(7.75)}% to ${n(82.25)}%. `,
  );
  assert.equal(
    text(ALL_RUNNING, 'Iron Plate'),
    'Running since Phase 1: 3 × Constructor. Nothing to add or change. ',
  );
  assert.equal(
    text(ALL_RUNNING, 'Screw'),
    'Running since Phase 1: 5 × Constructor. This phase needs 2 machines fewer: switch off 2 and ' +
      'set the last one to 50%. ',
  );
  assert.equal(text(ALL_RUNNING, 'Cable'), null, 'a new line has nothing carried');
});

test('only a line marked running in the phase before carries', () => {
  assert.equal(text({}, 'Iron Ingot'), null, 'nothing marked running');
  assert.equal(text({ 'calc-2-Iron Ingot': true }, 'Iron Ingot'), null, 'its own tick is not one');
  const stored = plan();
  // Phase 1 is the plan's first phase: nothing before it hands over.
  assert.equal(carriedLine(stored, ALL_RUNNING, '1', 'Iron Ingot'), null);
  // Post Phase 5 works on Phase 5's own steps and checks.
  assert.equal(carriedLine(stored, { 'calc-4-Iron Ingot': true }, 'post', 'Iron Ingot'), null);
  // A plan made for Phase 2 never built Phase 1, whatever a tick there says.
  const late = plan();
  late.settings.phase = '2';
  assert.equal(carriedLine(late, ALL_RUNNING, '2', 'Iron Ingot'), null);
  // A plan guide (a profile migrated from the handbook) has its own steps.
  const guided = { ...plan(), guide: { phases: {} } } as unknown as typeof stored;
  assert.equal(carriedLine(guided, ALL_RUNNING, '2', 'Iron Ingot'), null);
});

test('the handover summary counts kept, added, clocks, to build and retired', () => {
  const stored = plan();
  const handover = phaseHandover(stored, ALL_RUNNING, '2')!;
  assert.deepEqual(handover, { from: '1', kept: 4, add: 6, clocks: 3, build: 1, retire: 1 });
  assert.equal(retiredLines(stored, 2).length, handover.retire, 'the retire step lists as many');
  assert.equal(
    handoverText(handover),
    'From Phase 1: keep 4 lines already running, adding 6 machines and changing 3 clocks; build ' +
      'the other 1; retire 1.',
  );
  const none = phaseHandover(stored, {}, '2')!;
  assert.equal(
    handoverText(none),
    'From Phase 1: nothing marked running there carries over, so build all 5 lines; retire 1.',
  );
  // Once every Phase 2 line is marked running the handover is done.
  const done = Object.fromEntries(
    stored.stages['2']!.rows!.map(line => ['calc-2-' + line.id, true]),
  );
  assert.equal(phaseHandover(stored, { ...ALL_RUNNING, ...done }, '2'), null);
  assert.equal(phaseHandover(stored, ALL_RUNNING, '1'), null, 'no phase before Phase 1');
  assert.equal(phaseHandover(stored, ALL_RUNNING, 'post'), null);
});

test('the handover reads the saved ticks and running marks, never changes them', () => {
  const checks = { ...ALL_RUNNING, 'calc-2-Iron Plate': true, 'recipe-unlock-x': false };
  const before = structuredClone(checks);
  Object.freeze(checks);
  const stored = plan(),
    storedBefore = structuredClone(stored);
  for (const line of stored.stages['2']!.rows!) {
    const carried = carriedLine(stored, checks, '2', line.id);
    if (carried) carriedText(carried, line);
  }
  handoverText(phaseHandover(stored, checks, '2')!);
  assert.deepEqual(checks, before, 'no tick is added, changed or dropped');
  assert.deepEqual(stored, storedBefore, 'the stored plan is not recalculated or changed');
});
