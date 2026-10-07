// buildStatus (public/app/build-status.ts): what a half-built calculated stage produces from the
// rows ticked as built, on small hand-made stages and on a real plan from planner.ts.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildStatus } from '../public/app/build-status.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, StoredCalculatedPlan, StoredStage } from '../public/types/index.ts';

// A row with only what buildStatus reads; the rest are the neutral values a real row carries.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs'], extra = {}) => ({
  id,
  name: id,
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 4,
  generationMW: 0,
  ...extra,
});
const stage = (rows: CalcRow[], rest: Partial<StoredStage> = {}): StoredStage => ({
  feasible: true,
  rows,
  raw: { Ore: 30 },
  supplied: {},
  storage: {},
  drone: {},
  delivery: {},
  ...rest,
});
const ticked = (...ids: string[]) => Object.fromEntries(ids.map(id => ['calc-1-' + id, true]));
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);

// Ore (raw) -> ingot -> plate, and the plates go to the elevator.
const chain = stage(
  [row('ingot', { Ore: 30 }, { Ingot: 30 }), row('plate', { Ingot: 30 }, { Plate: 20 })],
  { delivery: { Plate: { target: 1000, rate: 20 } } },
);

test('nothing built delivers nothing, and the next step is the first that helps', () => {
  const status = buildStatus(chain, {}, '1');
  assert.deepEqual(
    status.rows.map(r => [r.id, r.built, r.share]),
    [
      ['ingot', false, 0],
      ['plate', false, 0],
    ],
  );
  assert.equal(status.deliveryShare, 0);
  assert.equal(status.delivery[0]!.now, 0);
  assert.equal(status.builtCount, 0);
  assert.equal(status.rowCount, 2);
  // Neither row alone delivers, and nothing is built to unblock: build order decides.
  assert.deepEqual(status.next, { id: 'ingot', gain: 0, unblocks: 0 });
});

test('a built row without its supplier is starved and says what it is short of', () => {
  const status = buildStatus(chain, ticked('plate'), '1');
  assert.deepEqual(status.rows[1], { id: 'plate', built: true, share: 0, shortOf: 'Ingot' });
  assert.equal(status.deliveryShare, 0);
  // Building the ingot line lets the plates flow: the whole delivery.
  assert.equal(status.next!.id, 'ingot');
  close(status.next!.gain, 1, 'gain');
});

test('everything built delivers the plan in full, with nothing left to build', () => {
  const status = buildStatus(chain, ticked('ingot', 'plate'), '1');
  assert.ok(status.rows.every(r => r.built && r.share === 1 && !r.shortOf));
  close(status.delivery[0]!.now, 20, 'plates now');
  assert.equal(status.deliveryShare, 1);
  assert.equal(status.next, null);
  close(status.produced.Plate!, 20, 'plates made');
});

test('a short item is shared in proportion to what the plan gives each use', () => {
  // The ingot line makes half what the plate line and the storage refill together need.
  const shared = stage(
    [row('ingot', { Ore: 30 }, { Ingot: 10 }), row('plate', { Ingot: 10 }, { Plate: 5 })],
    { storage: { Ingot: 10 }, delivery: { Plate: { target: 100, rate: 5 } } },
  );
  const status = buildStatus(shared, ticked('ingot', 'plate'), '1');
  close(status.rows[1]!.share, 0.5, 'plate share');
  assert.equal(status.rows[1]!.shortOf, 'Ingot');
  close(status.delivery[0]!.now, 2.5, 'plates now');
  close(status.deliveryShare, 0.5, 'delivery share');
});

test('the input a row is short of counts what competes for it, not only its own need', () => {
  // A covers half this row's need, but B, which storage also takes, only a tenth of the demand.
  const competing = stage([row('x', { A: 100, B: 50 }, { P: 10 })], {
    raw: { A: 50, B: 100 },
    storage: { B: 950 },
    delivery: { P: { target: 100, rate: 10 } },
  });
  const status = buildStatus(competing, ticked('x'), '1');
  close(status.rows[0]!.share, 0.1, 'share');
  assert.equal(status.rows[0]!.shortOf, 'B', 'B holds the row at 0.1, not A at 0.5');
});

test('with no single step adding delivery, the next one frees the most built machines', () => {
  // Ore -> ingot -> plate -> frame -> elevator, with only the plate line built.
  const long = stage(
    [
      row('ingot', { Ore: 30 }, { Ingot: 30 }),
      row('plate', { Ingot: 30 }, { Plate: 20 }, { equivalent: 3 }),
      row('frame', { Plate: 20 }, { Frame: 5 }),
    ],
    { delivery: { Frame: { target: 100, rate: 5 } } },
  );
  const status = buildStatus(long, ticked('plate'), '1');
  assert.equal(status.next!.id, 'ingot');
  assert.equal(status.next!.gain, 0);
  close(status.next!.unblocks, 3, 'machine-equivalents freed');
});

test('power is measured as the planner balances it, and Phase 1 is never flagged', () => {
  // Two ingot machines at 50 MW each (peakMW 100 at powerFactor 1), a 20% utility allowance
  // (requiredMW / peakMW), and a coal generator whose 60 MW the augmenter boost raises by 10%.
  const powered = stage(
    [
      row(
        'ingot',
        { Ore: 30 },
        { Ingot: 30 },
        { power: 50, equivalent: 2, machines: 2, peakMW: 100 },
      ),
      row('power-coal', {}, {}, { power: -75, peakMW: 0, generationMW: 60 }),
    ],
    { peakMW: 100, requiredMW: 120, boost: 0.1, generationMW: 60, availableMW: 60 * 1.1 + 30 },
  );
  const builtInPhase2 = (...ids: string[]) =>
    Object.fromEntries(ids.map(id => ['calc-2-' + id, true]));
  // Only the factory: 120 MW against the 30 MW spare part of availableMW.
  const alone = buildStatus(powered, builtInPhase2('ingot'), '2').power;
  close(alone.drawMW, 120, 'draw');
  close(alone.supplyMW, 30, 'supply');
  assert.equal(alone.short, true);
  // With its generator: 30 + 66 = 96 MW, still short of 120.
  const both = buildStatus(powered, builtInPhase2('ingot', 'power-coal'), '2').power;
  close(both.supplyMW, 96, 'supply with the generator');
  assert.equal(both.short, true);
  // A plan saved without availableMW falls back to the spare power passed in.
  const old = { ...powered, availableMW: undefined };
  close(
    buildStatus(old, builtInPhase2('ingot', 'power-coal'), '2', 60).power.supplyMW,
    126,
    'fallback',
  );
  assert.equal(buildStatus(old, builtInPhase2('ingot', 'power-coal'), '2', 60).power.short, false);
  // Phase 1 runs on hand-fed biomass: no power constraint, so never short.
  assert.equal(buildStatus(powered, ticked('ingot'), '1').power.short, false);
});

test('no fully built stage is flagged short of power, whatever the power settings (#188)', () => {
  for (const settings of [
    {},
    { augmenters: 4, fueledAugmenters: 2 },
    { somersloops: 20, amplifySloops: 10 },
    { powerFactor: 2 },
    { utilityPercent: 50 },
    { availablePowerGW: 5, installedPowerGW: 5 },
  ]) {
    const plan = calculate(settings);
    for (const [key, stage] of Object.entries(plan.stages) as [string, StoredStage][]) {
      if (!stage.feasible || !stage.rows?.length) continue;
      const all = Object.fromEntries(stage.rows.map(r => [`calc-${key}-${r.id}`, true]));
      const { power } = buildStatus(stage, all, key);
      assert.equal(
        power.short,
        false,
        `${JSON.stringify(settings)} phase ${key}: ${JSON.stringify(power)}`,
      );
    }
  }
});

test('real plans, current and saved: nothing built delivers nothing, fully built every part', () => {
  // A plan made now, and one saved on 2026-09-12 (older stages lack fields such as supplied).
  const saved = JSON.parse(
    fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
  ) as StoredCalculatedPlan;
  for (const plan of [calculate({}), saved])
    for (const [key, stage] of Object.entries(plan.stages) as [string, StoredStage][]) {
      if (!stage.feasible || !stage.rows?.length) continue;
      const none = buildStatus(stage, {}, key);
      assert.equal(none.deliveryShare, 0, 'phase ' + key);
      assert.ok(none.next, 'phase ' + key + ' has a next step');
      const all = Object.fromEntries(stage.rows.map(r => [`calc-${key}-${r.id}`, true]));
      const full = buildStatus(stage, all, key);
      assert.equal(full.builtCount, stage.rows.length);
      assert.ok(
        full.rows.every(r => r.share === 1),
        'phase ' + key + ': ' + JSON.stringify(full.rows.filter(r => r.share < 1)),
      );
      for (const delivery of full.delivery)
        close(delivery.now, delivery.planned, `phase ${key} ${delivery.item}`);
      assert.equal(full.next, null);
      assert.ok(full.deliveryShare === 1 || !full.delivery.length);
    }
});

// A line the phase before marked running and this phase builds again (#1069, phaseCarry in
// handover.ts) runs at the share its earlier machines make until it is ticked here.
test('a carried line runs at its earlier size, and ticking it here runs it whole', () => {
  const carried = new Map([
    ['ingot', 0.5],
    ['plate', 1],
  ]);
  const status = buildStatus(chain, {}, '1', 0, chain.rows, carried);
  assert.deepEqual(
    status.rows.map(r => [r.id, r.built, r.carried, r.shortOf]),
    [
      ['ingot', false, 0.5, undefined],
      ['plate', false, 1, 'Ingot'],
    ],
  );
  close(status.rows[0]!.share, 0.5, 'ingot share');
  // The plates get half their ingots: half the delivery.
  close(status.rows[1]!.share, 0.5, 'plate share');
  close(status.delivery[0]!.now, 10, 'plates now');
  assert.equal(status.builtCount, 0);
  assert.equal(status.carriedCount, 2);
  // Completing the ingot line is the step that adds the rest.
  assert.equal(status.next!.id, 'ingot');
  close(status.next!.gain, 0.5, 'gain');
  // Ticked here, a carried line runs whole and counts as built, not carried.
  const ticked1 = buildStatus(chain, ticked('ingot'), '1', 0, chain.rows, carried);
  assert.equal(ticked1.builtCount, 1);
  assert.equal(ticked1.carriedCount, 1);
  assert.equal(ticked1.rows[0]!.carried, undefined);
  close(ticked1.delivery[0]!.now, 20, 'plates now');
});

test('a short input reaches a carried line in proportion to what it asks', () => {
  // Two consumers of 30 Ore each (60 asked at full) from 30 Ore: one ticked, one carried at half.
  const competing = stage([row('x', { Ore: 30 }, { X: 1 }), row('y', { Ore: 30 }, { Y: 1 })]);
  const status = buildStatus(competing, ticked('x'), '1', 0, competing.rows, new Map([['y', 0.5]]));
  // 45 asked, 30 there: each gets two thirds of what it asks.
  close(status.rows[0]!.share, 2 / 3, 'ticked share');
  close(status.rows[1]!.share, 1 / 3, 'carried share');
  assert.equal(status.rows[1]!.shortOf, 'Ore');
});
