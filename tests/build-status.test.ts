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
const close = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} is not ${b}`);

// Ore (raw) -> ingot -> plate, and the plates go to the elevator.
const chain = stage(
  [row('ingot', { Ore: 30 }, { Ingot: 30 }), row('plate', { Ingot: 30 }, { Plate: 20 })],
  { delivery: { Plate: { target: 1000, rate: 20 } } },
);

test('nothing built delivers nothing, and the next step is the first that helps', () => {
  const s = buildStatus(chain, {}, '1');
  assert.deepEqual(
    s.rows.map(r => [r.id, r.built, r.share]),
    [
      ['ingot', false, 0],
      ['plate', false, 0],
    ],
  );
  assert.equal(s.deliveryShare, 0);
  assert.equal(s.delivery[0]!.now, 0);
  assert.equal(s.builtCount, 0);
  assert.equal(s.rowCount, 2);
  // Neither row alone delivers, and nothing is built to unblock: build order decides.
  assert.deepEqual(s.next, { id: 'ingot', gain: 0, unblocks: 0 });
});

test('a built row without its supplier is starved and says what it is short of', () => {
  const s = buildStatus(chain, ticked('plate'), '1');
  assert.deepEqual(s.rows[1], { id: 'plate', built: true, share: 0, shortOf: 'Ingot' });
  assert.equal(s.deliveryShare, 0);
  // Building the ingot line lets the plates flow: the whole delivery.
  assert.equal(s.next!.id, 'ingot');
  close(s.next!.gain, 1, 'gain');
});

test('everything built delivers the plan in full, with nothing left to build', () => {
  const s = buildStatus(chain, ticked('ingot', 'plate'), '1');
  assert.ok(s.rows.every(r => r.built && r.share === 1 && !r.shortOf));
  close(s.delivery[0]!.now, 20, 'plates now');
  assert.equal(s.deliveryShare, 1);
  assert.equal(s.next, null);
  close(s.produced.Plate!, 20, 'plates made');
});

test('a short item is shared in proportion to what the plan gives each use', () => {
  // The ingot line makes half what the plate line and the storage refill together need.
  const shared = stage(
    [row('ingot', { Ore: 30 }, { Ingot: 10 }), row('plate', { Ingot: 10 }, { Plate: 5 })],
    { storage: { Ingot: 10 }, delivery: { Plate: { target: 100, rate: 5 } } },
  );
  const s = buildStatus(shared, ticked('ingot', 'plate'), '1');
  close(s.rows[1]!.share, 0.5, 'plate share');
  assert.equal(s.rows[1]!.shortOf, 'Ingot');
  close(s.delivery[0]!.now, 2.5, 'plates now');
  close(s.deliveryShare, 0.5, 'delivery share');
});

test('the input a row is short of counts what competes for it, not only its own need', () => {
  // A covers half this row's need, but B, which storage also takes, only a tenth of the demand.
  const competing = stage([row('x', { A: 100, B: 50 }, { P: 10 })], {
    raw: { A: 50, B: 100 },
    storage: { B: 950 },
    delivery: { P: { target: 100, rate: 10 } },
  });
  const s = buildStatus(competing, ticked('x'), '1');
  close(s.rows[0]!.share, 0.1, 'share');
  assert.equal(s.rows[0]!.shortOf, 'B', 'B holds the row at 0.1, not A at 0.5');
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
  const s = buildStatus(long, ticked('plate'), '1');
  assert.equal(s.next!.id, 'ingot');
  assert.equal(s.next!.gain, 0);
  close(s.next!.unblocks, 3, 'machine-equivalents freed');
});

test('power compares built factories with built generators and the listed spare power', () => {
  const powered = stage(
    [
      row('ingot', { Ore: 30 }, { Ingot: 30 }, { power: 50, equivalent: 2 }),
      row('power-coal', { Ore: 0 }, {}, { power: -75, generationMW: 60 }),
    ],
    { raw: { Ore: 30 } },
  );
  assert.deepEqual(buildStatus(powered, ticked('ingot'), '1', 30).power, {
    drawMW: 100,
    supplyMW: 30,
    short: true,
  });
  const both = buildStatus(powered, ticked('ingot', 'power-coal'), '1', 50).power;
  assert.deepEqual(both, { drawMW: 100, supplyMW: 110, short: false });
});

test('real plans, current and saved: nothing built delivers nothing, fully built every part', () => {
  // A plan made now, and one saved on 2026-09-12 (older stages lack fields such as supplied).
  const saved = JSON.parse(
    fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
  ) as StoredCalculatedPlan;
  for (const plan of [calculate({}), saved])
    for (const [key, st] of Object.entries(plan.stages) as [string, StoredStage][]) {
      if (!st.feasible || !st.rows?.length) continue;
      const none = buildStatus(st, {}, key);
      assert.equal(none.deliveryShare, 0, 'phase ' + key);
      assert.ok(none.next, 'phase ' + key + ' has a next step');
      const all = Object.fromEntries(st.rows.map(r => [`calc-${key}-${r.id}`, true]));
      const full = buildStatus(st, all, key);
      assert.equal(full.builtCount, st.rows.length);
      assert.ok(
        full.rows.every(r => r.share === 1),
        'phase ' + key + ': ' + JSON.stringify(full.rows.filter(r => r.share < 1)),
      );
      for (const d of full.delivery) close(d.now, d.planned, `phase ${key} ${d.item}`);
      assert.equal(full.next, null);
      assert.ok(full.deliveryShare === 1 || !full.delivery.length);
    }
});
