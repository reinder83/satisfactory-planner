// A storage-only line's production line dialog (#1173). The owner opened "Alternate: Pure Copper
// Ingot for storage (optional)", Phase 3, 7.85/min, and its machine card said "1 × Refinery @ 100%
// + 1 adjustable" for one Refinery at 20.93%, while its destinations were the whole phase's Copper
// Ingot consumers at their plan-wide demand, with "0.08 at 100%" of its machine split over each.
// The card now says how the machines run ("at 20.9%", "1 at 100% + 1 at 94.7%"), and a
// storage-only line lists only its own destinations at its own rates (stockShares in
// stock-flow.ts): the other storage-only lines it feeds on their way to storage, protected
// storage, the generators burning more fuel for their power and the sink. On a synthetic Phase 3
// profile (every container, filled from surplus first), the planner's own plan, made in Node.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel, flowOutputs, rowEquivalent } from '../../public/app/flow.ts';
import type { CalcFlowContext } from '../../public/app/flow.ts';
import { num } from '../../public/app/format.ts';
import { render } from '../../public/app/shell.ts';
import { calcStage } from '../../public/app/session.ts';
import { stockShares } from '../../public/app/stock-flow.ts';
import { clockText } from '../../public/app/views/factories.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CalcRow, StageKey, StoredStage } from '../../public/types/index.ts';

const PROFILE = {
  phase: '3',
  wholeMachines: true,
  limitsConfirmed: true,
  storage: 'all',
  collectables: true,
  storageFromSurplus: true,
};
const plan = generatedWith(PROFILE);
const stage3 = plan.stages['3'];
const rows = stage3.rows || [];
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const mainItem = (row: CalcRow) => Object.keys(row.outputs)[0]!;
const lastClock = (row: CalcRow) => {
  const equivalent = rowEquivalent(row);
  return (equivalent - Math.floor(equivalent + 1e-7)) * 100;
};
// A storage-only line of one item that other lines of the plan make and use too, as the owner's
// Copper Ingot line: the case where the plan-wide demand misled.
const sharedStockLine = (machines: (count: number) => boolean) =>
  rows.find(
    row =>
      row.stock &&
      Object.keys(row.outputs).length === 1 &&
      machines(row.machines) &&
      lastClock(row) > 1e-5 &&
      rows.some(other => !other.stock && other.outputs[mainItem(row)]) &&
      rows.some(other => !other.stock && other.inputs[mainItem(row)]),
  );
const single = sharedStockLine(count => count === 1)!;
const several = sharedStockLine(count => count > 1)!;

function showDialog(id: string) {
  open({ calculated: structuredClone(plan), phase: '3' });
  go('factories');
  render();
  openCalculatedFactory(id);
}
const machineCard = () => $('#detail .rail-machine-main')?.textContent?.replace(/\s+/g, ' ') ?? '';

beforeEach(() => page());

test('the profile has storage-only lines running one machine, and several, below 100%', () => {
  assert.ok(stage3.feasible);
  assert.ok(single, 'a storage-only line on one machine below 100%');
  assert.ok(several, 'a storage-only line on several machines, the last below 100%');
});

test('the machine card of a line whose only machine runs slower gives its clock (#1173)', () => {
  showDialog(single.id);
  const card = machineCard();
  assert.match(card, new RegExp(`^1 × ${single.machine}`));
  assert.ok(card.includes(` · at ${clockText(lastClock(single))}% · `), card);
  assert.ok(card.includes(' out per machine at 100%'), card);
  assert.doesNotMatch(card, /adjustable|@ 100%/);
});

test('the machine card of a line with whole machines beside the slower one gives both', () => {
  showDialog(several.id);
  const card = machineCard();
  assert.ok(
    card.includes(
      ` · ${num(several.machines - 1)} at 100% + 1 at ${clockText(lastClock(several))}% · `,
    ),
    card,
  );
  assert.doesNotMatch(card, /adjustable|@ 100%/);
});

test('a storage-only line lists only its own destinations, at its own rates (#1173)', () => {
  showDialog(single.id);
  const model = calcFlowModel(calcStage()!.rows!.find(row => row.id === single.id)!);
  const item = mainItem(single);
  // Never the plan's own consumers of the item, only storage-only lines and storage.
  for (const output of model.outputs)
    if (output.kind === 'consumer')
      assert.ok(
        rows.find(row => row.id === output.link?.calcFactory)?.stock,
        `${output.label} is a storage-only line`,
      );
    else assert.ok(['store', 'sink'].includes(output.kind), output.label);
  const total = model.outputs.reduce((sum, output) => sum + (output.rate || 0), 0);
  assert.ok(near(total, single.outputs[item]!), `${total} of ${single.outputs[item]}`);
  // The split adds up to its one machine, so no destination reads "<1" of it beside others.
  const split = model.outputs.filter(output => output.machines !== undefined);
  assert.equal(
    split.reduce((sum, output) => sum + output.machines!, 0),
    1,
  );
  // The dialog says whose rates these are and who feeds the plan's own consumers.
  const note = $('#detail [data-storage-only-note]')?.textContent?.replace(/\s+/g, ' ') ?? '';
  assert.match(note, /This storage-only line’s own rates/);
  assert.match(note, /The plan’s other lines making it feed every other consumer of it\./);
  assert.equal($$('#detail .rail-row').length, model.outputs.length);
});

// Every storage-only line of every phase: what it delivers adds up to what it makes of each item
// (as far as those items have a destination), and the plan's own consumers of an item get none of
// it unless they are generators burning more fuel for the storage-only lines' power.
test('every storage-only line delivers exactly what it makes, to storage-only destinations', () => {
  for (const [key, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
    const context: CalcFlowContext = { storedStage: stage, stageKey: key, settings: plan.settings };
    for (const row of (stage.rows || []).filter(candidate => candidate.stock)) {
      const outputs = flowOutputs(row, context);
      for (const [item, made] of Object.entries(row.outputs)) {
        const prefix = Object.keys(row.outputs).length > 1 ? item : '';
        const own = outputs.filter(output => (output.pre ?? '') === prefix);
        const total = own.reduce((sum, output) => sum + (output.rate || 0), 0);
        assert.ok(
          near(total, made) || total < made,
          `Phase ${key}: ${row.id} delivers ${total} of the ${made} ${item} it makes`,
        );
        for (const output of own.filter(candidate => candidate.kind === 'consumer')) {
          const consumer = stage.rows!.find(other => other.id === output.link?.calcFactory)!;
          assert.ok(
            consumer.stock || consumer.power < 0,
            `Phase ${key}: ${row.id} feeds ${consumer.id}`,
          );
        }
      }
    }
  }
});

// stockShares on hand-made books.
const line = (
  id: string,
  inputs: CalcRow['inputs'],
  outputs: CalcRow['outputs'],
  extra: Partial<CalcRow> = {},
): CalcRow => ({
  id,
  name: id,
  phase: 3,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 0.5,
  machines: 1,
  lastClock: 50,
  peakMW: 4,
  generationMW: 0,
  ...extra,
});
const stockLine = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']) =>
  line(id + ':stock', inputs, outputs, { stock: { recipe: id } });
const rates = (deliveries: { consumer: CalcRow; rate: number }[]) =>
  deliveries.map(({ consumer, rate }) => [consumer.id, Math.round(rate * 1000) / 1000]);

test('storage takes the plan’s surplus first; the line feeds the storage-only lines (#1173)', () => {
  // The plan's lines make 100 Copper Ingot and use 73: 27 left, of which storage takes 1. The
  // Copper Sheet storage-only line uses 33.85, so this line makes the 7.85 the surplus leaves.
  const ingots = line('ingot', {}, { 'Copper Ingot': 100 });
  const wire = line('wire', { 'Copper Ingot': 73 }, { Wire: 146 });
  const ingotStock = stockLine('pure', {}, { 'Copper Ingot': 7.85 });
  const sheetStock = stockLine('sheet', { 'Copper Ingot': 33.85 }, { 'Copper Sheet': 33.85 });
  const stage: StoredStage = {
    feasible: true,
    rows: [ingots, wire, ingotStock, sheetStock],
    storage: { 'Copper Ingot': 1, 'Copper Sheet': 33.85 },
    surplus: {},
  };
  const shares = stockShares(ingotStock, 'Copper Ingot', stage);
  assert.deepEqual(rates(shares.lines), [['sheet:stock', 7.85]]);
  assert.deepEqual([shares.plan, shares.storage, shares.sink], [[], 0, 0]);
  // With no surplus at all, storage is the line's too: it makes 34.85, 1 for storage.
  const moreStock = { ...ingotStock, outputs: { 'Copper Ingot': 34.85 } };
  const both = stockShares(moreStock, 'Copper Ingot', {
    ...stage,
    rows: [line('ingot', {}, { 'Copper Ingot': 73 }), wire, moreStock, sheetStock],
  });
  assert.deepEqual(rates(both.lines), [['sheet:stock', 33.85]]);
  assert.ok(near(both.storage, 1));
});

test('several storage-only lines making an item share each destination by what they make', () => {
  const plastic = stockLine('plastic', {}, { Plastic: 9, 'Heavy Oil Residue': 4.5 });
  const residual = stockLine('residual', { 'Heavy Oil Residue': 4.5 }, { Plastic: 3 });
  const pipe = stockLine('board', { Plastic: 11 }, { 'Circuit Board': 2 });
  const stage: StoredStage = {
    feasible: true,
    rows: [plastic, residual, pipe],
    storage: { Plastic: 1, 'Circuit Board': 2 },
    surplus: {},
  };
  const first = stockShares(plastic, 'Plastic', stage),
    second = stockShares(residual, 'Plastic', stage);
  assert.deepEqual(rates(first.lines), [['board:stock', 8.25]]);
  assert.deepEqual(rates(second.lines), [['board:stock', 2.75]]);
  assert.ok(near(first.storage, 0.75) && near(second.storage, 0.25));
  // Its Heavy Oil Residue goes to the Residual Plastic line.
  assert.deepEqual(rates(stockShares(plastic, 'Heavy Oil Residue', stage).lines), [
    ['residual:stock', 4.5],
  ]);
});

test('fuel for the generators that power the storage-only lines, and a byproduct to the sink', () => {
  // The plan's Fuel Generators burn 13.22 more Fuel than its own lines make for the storage-only
  // lines' power; this Fuel line makes that, the Turbofuel line's 1.48 and Polymer Resin it sinks.
  const fuel = line('fuel', {}, { Fuel: 40 });
  const generator = line('power-fuel', { Fuel: 53.22 }, {}, { power: -250, generationMW: 1000 });
  const fuelStock = stockLine('liquid', {}, { Fuel: 14.7, 'Polymer Resin': 9.8 });
  const turbo = stockLine('turbo', { Fuel: 1.48 }, { Turbofuel: 1.24 });
  const stage: StoredStage = {
    feasible: true,
    rows: [fuel, generator, fuelStock, turbo],
    storage: { Turbofuel: 1.24 },
    surplus: { 'Polymer Resin': 9.8 },
  };
  const shares = stockShares(fuelStock, 'Fuel', stage);
  assert.deepEqual(rates(shares.lines), [['turbo:stock', 1.48]]);
  assert.deepEqual(rates(shares.plan), [['power-fuel', 13.22]]);
  assert.ok(near(shares.sink, 0));
  const resin = stockShares(fuelStock, 'Polymer Resin', stage);
  assert.ok(near(resin.sink, 9.8));
  assert.deepEqual([resin.lines, resin.plan, resin.storage], [[], [], 0]);
});
