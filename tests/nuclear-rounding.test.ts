// Whole machines round the nuclear plants (#370): the uranium plant count is whole, and in Phase 5
// under 'recycle' a multiple of the waste chain's period, so every waste line runs whole at 100%.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, nuclearPeriod, DATA, PURE_LIMITS } from '../planner.ts';
import type { CurrentStage } from '../public/types/index.ts';

// A Phase 5 plan whose exact solve needs about 135.3 uranium plants: fractional before #370.
const recycle = {
  phase: '5',
  recipes: 'all',
  nuclear: 'recycle',
  goal: 'balanced',
  wholeMachines: true,
  uraniumReactors: 50,
  multiplier: 23,
  limits: { ...PURE_LIMITS },
};
const WASTE_CHAIN = [
  'Non-Fissile Uranium',
  'Plutonium Pellet',
  'Encased Plutonium Cell',
  'Plutonium Fuel Rod',
  'Plutonium power',
  'Ficsonium',
  'Ficsonium Fuel Rod',
  'Ficsonium power',
];
const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
const row = (st: CurrentStage, name: string) => {
  const r = (st.rows || []).find(x => x.name === name);
  assert.ok(r, name + ' is planned');
  return r;
};
const uranium = (st: CurrentStage) => row(st, 'Uranium power').equivalent;
const recipe = (name: string) => {
  const r = DATA.recipes.find(x => x.name === name && !x.alternate);
  assert.ok(r, name);
  return r;
};
// The default recycle chain, with the three kinds of plant as run() models them.
type Chain = Parameters<typeof nuclearPeriod>[0];
const plants: Chain = [
  {
    id: 'power-uranium',
    inputs: { 'Uranium Fuel Rod': 0.2, Water: 240 },
    outputs: { 'Uranium Waste': 10 },
  },
  {
    id: 'power-plutonium',
    inputs: { 'Plutonium Fuel Rod': 0.1, Water: 240 },
    outputs: { 'Plutonium Waste': 1 },
  },
  { id: 'power-ficsonium', inputs: { 'Ficsonium Fuel Rod': 1, Water: 240 }, outputs: {} },
];
const sinkChain = [
  'Uranium Fuel Rod',
  'Encased Uranium Cell',
  'Non-Fissile Uranium',
  'Plutonium Pellet',
  'Encased Plutonium Cell',
  'Plutonium Fuel Rod',
].map(recipe);
const fullChain = [...sinkChain, recipe('Ficsonium'), recipe('Ficsonium Fuel Rod'), ...plants];

test('the default recycle chain has a period of 20 uranium plants', () => {
  assert.equal(nuclearPeriod(fullChain), 20);
});

test('a chain with no unique whole period gets whole uranium plants only', () => {
  // No uranium plant at all.
  assert.equal(nuclearPeriod(fullChain.filter(r => r.id !== 'power-uranium')), 1);
  // The sink strategy: the chain ends in Plutonium Fuel Rods that no line uses.
  assert.equal(nuclearPeriod([...sinkChain, plants[0]!]), 1);
  // Plutonium drone fuel draws on the chain, which makes it affine rather than linear.
  assert.equal(nuclearPeriod(fullChain, { 'Plutonium Fuel Rod': 1 }), 1);
  // Two recipes competing for Encased Plutonium Cells.
  const instant = DATA.recipes.find(x => x.name === 'Alternate: Instant Plutonium Cell');
  assert.ok(instant);
  assert.equal(nuclearPeriod([...fullChain, instant]), 1);
});

test('Phase 5 recycling rounds the uranium plants to the chain period and the waste chain to whole machines', () => {
  const plan = calculate(recycle);
  const st = plan.stages[5];
  assert.equal(st.feasible, true);
  assert.equal(st.nuclearPeriod, 20);
  assert.ok(!st.nuclearFractional);
  const count = uranium(st);
  assert.ok(whole(count / 20), `${count} uranium plants is a multiple of 20`);
  // The exact solve needs about 135.3 plants; the next multiple of 20 is 140.
  assert.equal(Math.round(count), 140);
  for (const name of WASTE_CHAIN) {
    const r = row(st, name);
    assert.ok(whole(r.equivalent), `${name}: ${r.equivalent} is whole`);
    assert.equal(r.machines, Math.round(r.equivalent), name);
    assert.ok(r.lastClock > 99.999, `${name} runs its last machine at 100%`);
  }
  // Waste still balances exactly, and the extra plants only add generation.
  for (const waste of ['Uranium Waste', 'Plutonium Waste']) {
    const balance = (st.rows || []).reduce(
      (a, r) => a + (r.outputs[waste] || 0) - (r.inputs[waste] || 0),
      0,
    );
    assert.ok(Math.abs(balance) < 1e-5, waste);
  }
  assert.ok(st.additionalHeadroomMW === 0 || st.availableMW! >= st.requiredMW! - 1);
  const warning = plan.warnings.find(w => w.startsWith('Solid-part production')) || '';
  assert.ok(warning.includes('multiples of 20'), warning);
  assert.ok(!warning.includes('Fluid, power and nuclear balancing'), warning);
});

test('the sink strategy and Phase 4 recycling give a whole uranium plant count', () => {
  const sink = calculate({
    ...recycle,
    phase: '4',
    nuclear: 'sink',
    uraniumReactors: 3,
    multiplier: 5,
  });
  for (const p of [4, 5] as const) {
    const st = sink.stages[p];
    assert.equal(st.feasible, true);
    assert.ok(whole(uranium(st)), `sink, Phase ${p}: ${uranium(st)}`);
    assert.equal(st.nuclearPeriod, undefined);
  }
  const phase4 = calculate({ ...recycle, phase: '4', uraniumReactors: 1, multiplier: 20 })
    .stages[4];
  assert.equal(phase4.feasible, true);
  assert.ok(whole(uranium(phase4)), `recycle, Phase 4: ${uranium(phase4)}`);
  assert.equal(phase4.nuclearPeriod, undefined);
});

test('whole nuclear plants fall back to a fractional count when they do not fit the budgets', () => {
  // About 1,804 uranium/min fits the exact 135.3 plants; 140 plants need about 1,867.
  const plan = calculate({
    ...recycle,
    mainPower: 'nuclear',
    limits: { ...PURE_LIMITS, Uranium: 1810 },
  });
  const st = plan.stages[5];
  assert.equal(st.feasible, true);
  assert.equal(st.nuclearFractional, true);
  assert.equal(st.nuclearPeriod, undefined);
  assert.ok(!whole(uranium(st)), `${uranium(st)} stays fractional`);
  assert.ok(st.raw!.Uranium! <= 1810.01);
  assert.ok(
    plan.warnings.some(w =>
      w.startsWith('Phase 5 could not fit whole Nuclear Power Plants within the resource budgets'),
    ),
    plan.warnings.join('\n'),
  );
});

test('precise balancing keeps the fractional nuclear plants', () => {
  const plan = calculate({ ...recycle, wholeMachines: false });
  const st = plan.stages[5];
  assert.equal(st.feasible, true);
  assert.equal(st.nuclearPeriod, undefined);
  assert.equal(st.nuclearFractional, undefined);
  assert.ok(!whole(uranium(st)), `${uranium(st)}`);
  assert.ok(!whole(row(st, 'Ficsonium').equivalent));
  assert.ok(!plan.warnings.some(w => w.startsWith('Solid-part production')));
});
