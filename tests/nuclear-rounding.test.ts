// Whole machines round the nuclear plants (#370): the uranium plant count is whole, and in Phase 5
// under 'recycle' a multiple of the waste chain's period, so every waste line runs whole at 100%.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, nuclearPeriod, DATA, PURE_LIMITS } from '../planner.ts';
import type { CurrentStage } from '../public/types/index.ts';

// A Phase 5 plan whose exact solve needs about 112.7 uranium plants: fractional before #370.
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
const whole = (value: number) => Math.abs(value - Math.round(value)) < 1e-6;
const row = (stage: CurrentStage, name: string) => {
  const found = (stage.rows || []).find(x => x.name === name);
  assert.ok(found, name + ' is planned');
  return found;
};
const uranium = (stage: CurrentStage) => row(stage, 'Uranium power').equivalent;
const recipe = (name: string) => {
  const found = DATA.recipes.find(x => x.name === name && !x.alternate);
  assert.ok(found, name);
  return found;
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
  const stage = plan.stages[5];
  assert.equal(stage.feasible, true);
  assert.equal(stage.nuclearPeriod, 20);
  assert.ok(!stage.nuclearFractional);
  const count = uranium(stage);
  assert.ok(whole(count / 20), `${count} uranium plants is a multiple of 20`);
  // The exact solve needs about 112.7 plants; the next multiple of 20 is 120.
  assert.equal(Math.round(count), 120);
  for (const name of WASTE_CHAIN) {
    const chainRow = row(stage, name);
    assert.ok(whole(chainRow.equivalent), `${name}: ${chainRow.equivalent} is whole`);
    assert.equal(chainRow.machines, Math.round(chainRow.equivalent), name);
    assert.ok(chainRow.lastClock > 99.999, `${name} runs its last machine at 100%`);
  }
  // Waste still balances exactly, and the extra plants only add generation.
  for (const waste of ['Uranium Waste', 'Plutonium Waste']) {
    const balance = (stage.rows || []).reduce(
      (total, r) => total + (r.outputs[waste] || 0) - (r.inputs[waste] || 0),
      0,
    );
    assert.ok(Math.abs(balance) < 1e-5, waste);
  }
  assert.ok(stage.additionalHeadroomMW === 0 || stage.availableMW! >= stage.requiredMW! - 1);
  const warning =
    plan.warnings.find(w => w.startsWith('Uranium-fuelled Nuclear Power Plants')) || '';
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
  for (const phase of [4, 5] as const) {
    const stage = sink.stages[phase];
    assert.equal(stage.feasible, true);
    assert.ok(whole(uranium(stage)), `sink, Phase ${phase}: ${uranium(stage)}`);
    assert.equal(stage.nuclearPeriod, undefined);
  }
  const phase4 = calculate({ ...recycle, phase: '4', uraniumReactors: 1, multiplier: 20 })
    .stages[4];
  assert.equal(phase4.feasible, true);
  assert.ok(whole(uranium(phase4)), `recycle, Phase 4: ${uranium(phase4)}`);
  assert.equal(phase4.nuclearPeriod, undefined);
});

test('whole nuclear plants fall back to a fractional count when they do not fit the budgets', () => {
  // About 1,559 uranium/min fits the exact 116.9 plants; 120 plants need 1,600.
  const plan = calculate({
    ...recycle,
    mainPower: 'nuclear',
    limits: { ...PURE_LIMITS, Uranium: 1570 },
  });
  const stage = plan.stages[5];
  assert.equal(stage.feasible, true);
  assert.equal(stage.nuclearFractional, true);
  assert.equal(stage.nuclearPeriod, undefined);
  assert.ok(!whole(uranium(stage)), `${uranium(stage)} stays fractional`);
  assert.ok(stage.raw!.Uranium! <= 1570.01);
  assert.ok(
    plan.warnings.some(warning =>
      warning.startsWith(
        'Phase 5 could not fit whole Nuclear Power Plants within the resource budgets',
      ),
    ),
    plan.warnings.join('\n'),
  );
});

test('precise balancing keeps the fractional nuclear plants', () => {
  const plan = calculate({ ...recycle, wholeMachines: false });
  const stage = plan.stages[5];
  assert.equal(stage.feasible, true);
  assert.equal(stage.nuclearPeriod, undefined);
  assert.equal(stage.nuclearFractional, undefined);
  assert.ok(!whole(uranium(stage)), `${uranium(stage)}`);
  assert.ok(!whole(row(stage, 'Ficsonium').equivalent));
  assert.ok(!plan.warnings.some(w => w.startsWith('Solid-part production')));
  assert.ok(!plan.warnings.some(w => w.startsWith('Uranium-fuelled')));
});
