// The "Unlock and commission the planned fuel power" step (generationTasks in
// public/progression.ts, #880): it names only the fuels the phase's Fuel Generator lines burn and
// their unlocks, as whole sentences. It used to name turbofuel's research in every phase and
// rocket fuel's from Phase 4 whatever the generators burned, and read "research;  Confirm" and
// "Blender access.  Confirm".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { phaseSteps } from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, Progression, StageKey } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);

// A partial Fuel Generator row (generators() in planner/recipes.ts): the step reads only these.
const fuelPower = (fuel: string, machines = 4) =>
  ({
    id: 'power-' + fuel.toLowerCase().replace(/ /g, '-'),
    name: fuel + ' power',
    machine: 'Fuel Generator',
    machines,
    inputs: { [fuel]: machines * 10 },
    outputs: {},
    generationMW: machines * 250,
  }) as CalcRow;

// A Phase 3 profile whose phases' rows are the given generator lines.
function fuelPlan(rows: Partial<Record<StageKey, CalcRow[]>>) {
  const plan = calculate({ phase: '3', mainPower: 'auto' });
  for (const phase of ['3', '4', '5'] as const)
    plan.stages[phase] = { ...plan.stages[phase], rows: rows[phase] ?? [] };
  return plan;
}

const fuelStep = (plan: ReturnType<typeof fuelPlan>, phase: string) =>
  phaseSteps(plan, { checks: {} }, data, phase).find(step => step.id.startsWith('startup-fuel-'));

const tail =
  ' Confirm any fuel alternates in the hard-drive checklist. Start with an unlocked fuel recipe and upgrade only after the full new chain is ready.';

test('plain Fuel power names neither turbofuel nor rocket fuel, in Phase 3 and 4', () => {
  const plan = fuelPlan({ '3': [fuelPower('Fuel')], '4': [fuelPower('Fuel', 6)] });
  for (const phase of ['3', '4']) {
    const step = fuelStep(plan, phase)!;
    assert.equal(step.id, 'startup-fuel-' + phase, 'the check key is unchanged');
    assert.equal(step.title, 'Unlock and commission the planned fuel power');
    assert.equal(
      step.body,
      "This phase's Fuel Generators burn Fuel. Complete Oil Processing and Petroleum Power first." +
        tail,
    );
  }
});

test('Turbofuel power names its research as a whole sentence', () => {
  const step = fuelStep(fuelPlan({ '3': [fuelPower('Turbofuel')] }), '3')!;
  assert.equal(
    step.body,
    "This phase's Fuel Generators burn Turbofuel. Complete Oil Processing and Petroleum Power first. For turbofuel, complete its Sulfur MAM research." +
      tail,
  );
});

test('Rocket Fuel power names only its own requirements', () => {
  const step = fuelStep(fuelPlan({ '4': [fuelPower('Rocket Fuel')] }), '4')!;
  assert.equal(
    step.body,
    "This phase's Fuel Generators burn Rocket Fuel. Complete Oil Processing and Petroleum Power first. Rocket fuel also needs its own MAM node, nitrogen supply and Blender access." +
      tail,
  );
});

test('several fuels name each one once', () => {
  const plan = fuelPlan({
    '5': [fuelPower('Fuel'), fuelPower('Turbofuel'), fuelPower('Rocket Fuel')],
  });
  const step = fuelStep(plan, '5')!;
  assert.match(step.body, /^This phase's Fuel Generators burn Fuel, Turbofuel and Rocket Fuel\./);
  assert.match(step.body, /research\. Rocket fuel also needs/);
  assert.doesNotMatch(step.body, / {2}|;/, 'no double spaces or semicolon splices');
});

test('a phase without Fuel Generators lists no fuel power step', () => {
  assert.equal(fuelStep(fuelPlan({}), '4'), undefined);
});
