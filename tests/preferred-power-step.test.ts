// The "power before the next production block" step (preferredPowerTasks in public/progression.ts,
// #871): it names the generator lines the phase's plan builds, not the fuel the preferred main
// power setting names. Under "Rocket fuel + nuclear" a phase may build only nuclear plants while
// it makes rocket fuel for other uses, and that step used to say "Expand rocket fuel power".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guideContext, phaseSteps, powerTasks } from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, Progression, StageKey } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);

// A partial row: the power step reads only these fields.
const line = (
  id: string,
  name: string,
  machine: string,
  machines: number,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  generationMW = 0,
) => ({ id, name, machine, machines, inputs, outputs, generationMW }) as CalcRow;

const uranium = (machines: number) =>
  line(
    'power-uranium',
    'Uranium power',
    'Nuclear Power Plant',
    machines,
    { 'Uranium Fuel Rod': machines * 0.2, Water: machines * 240 },
    { 'Uranium Waste': machines * 10 },
    machines * 2500,
  );
const fuelRods = line(
  'Recipe_Alternate_NuclearFuelRod_1_C',
  'Alternate: Uranium Fuel Unit',
  'Manufacturer',
  2,
  {},
  { 'Uranium Fuel Rod': 1.6 },
);
const nitroRocketFuel = line(
  'Recipe_Alternate_RocketFuel_Nitro_C',
  'Alternate: Nitro Rocket Fuel',
  'Blender',
  4,
  { Fuel: 400, 'Nitrogen Gas': 300, Sulfur: 400, Coal: 200 },
  { 'Rocket Fuel': 600, 'Compacted Coal': 100 },
);
const packagedRocketFuel = line(
  'Recipe_PackagedRocketFuel_C',
  'Packaged Rocket Fuel',
  'Packager',
  5,
  { 'Rocket Fuel': 600, 'Empty Fluid Tank': 300 },
  { 'Packaged Rocket Fuel': 300 },
);
const rocketPower = line(
  'power-rocket-fuel',
  'Rocket Fuel power',
  'Fuel Generator',
  10,
  { 'Rocket Fuel': 40 },
  {},
  2500,
);

// A Phase 3 profile preferring "Rocket fuel + nuclear", with hand-made rows: Phase 3 builds no
// generators (spare power covers it), Phase 4 only nuclear plants while it makes rocket fuel for
// storage, and Phase 5 adds plants and a first rocket fuel generator line.
function rocketNuclearPlan(start = '3') {
  const plan = calculate({ phase: start, mainPower: 'rocket-nuclear', nuclear: 'recycle' });
  const rows: Record<string, CalcRow[]> = {
    '3': [],
    '4': [uranium(5), fuelRods, nitroRocketFuel, packagedRocketFuel],
    '5': [uranium(8), fuelRods, rocketPower, nitroRocketFuel],
  };
  for (const [phase, stageRows] of Object.entries(rows))
    plan.stages[phase as StageKey] = { ...plan.stages[phase as StageKey], rows: stageRows };
  return plan;
}

const powerStep = (plan: ReturnType<typeof rocketNuclearPlan>, phase: string) =>
  phaseSteps(plan, { checks: {} }, data, phase).find(step =>
    step.id.startsWith('preferred-power-'),
  );

test('a phase that burns no rocket fuel does not ask to expand rocket fuel power (#871)', () => {
  const step = powerStep(rocketNuclearPlan(), '4')!;
  assert.equal(step.id, 'preferred-power-4', 'the check key is unchanged');
  assert.equal(step.title, 'Build nuclear power before the next production block');
  assert.doesNotMatch(step.title + step.body, /expand rocket fuel|turbofuel bridge/i);
  assert.match(
    step.body,
    /5 × Uranium power \(Nuclear Power Plant\), new in this phase, burning 1 Uranium Fuel Rod\/min from the Alternate: Uranium Fuel Unit step/,
    'names the generator line as its build step is titled, with its count and fuel line',
  );
  assert.match(
    step.body,
    /preferred main power would burn Rocket Fuel in this phase, but the planner chose no generator that does: the Rocket Fuel from this phase's Alternate: Nitro Rocket Fuel step is for other uses/,
    "says the plan's rocket fuel line is not power",
  );
  assert.match(step.body, /Complete Nuclear Power/);
  assert.doesNotMatch(step.body, /Rocket fuel power needs/);
});

test('a phase without generators says it runs on spare power', () => {
  const step = powerStep(rocketNuclearPlan(), '3')!;
  assert.equal(step.id, 'preferred-power-3');
  assert.equal(step.title, 'Keep spare power ahead of the next production block');
  assert.match(step.body, /^Phase 3 builds no generators/);
  assert.doesNotMatch(step.body, /Build the generator quantities|Turbofuel power needs/);
});

test('a later phase expands what the previous phase built and builds what is new', () => {
  const step = powerStep(rocketNuclearPlan(), '5')!;
  assert.equal(step.id, 'preferred-power-5');
  assert.equal(step.title, 'Expand nuclear and rocket fuel power before the next production block');
  assert.match(
    step.body,
    /8 × Uranium power \(Nuclear Power Plant\), 5 built in Phase 4, so add 3/,
  );
  assert.match(
    step.body,
    /10 × Rocket Fuel power \(Fuel Generator\), new in this phase, burning 40 Rocket Fuel\/min from the Alternate: Nitro Rocket Fuel step/,
  );
  assert.match(step.body, /Rocket fuel power needs Blender access/);
  assert.doesNotMatch(step.body, /preferred main power would burn/, 'rocket fuel is burned here');
  assert.equal(powerStep(rocketNuclearPlan(), 'post')!.id, 'preferred-power-5');
});

test('the start phase builds its generators: nothing before it was built', () => {
  const plan = rocketNuclearPlan('4');
  plan.stages['3'] = { ...plan.stages['3'], rows: [uranium(5)] };
  const step = powerStep(plan, '4')!;
  assert.equal(step.title, 'Build nuclear power before the next production block');
  assert.match(step.body, /5 × Uranium power \(Nuclear Power Plant\), new in this phase/);
});

test('a line that needs no more machines is kept, not expanded', () => {
  const plan = rocketNuclearPlan();
  plan.stages['5'] = { ...plan.stages['5'], rows: [uranium(5), fuelRods] };
  const step = powerStep(plan, '5')!;
  assert.equal(step.title, 'Keep nuclear power ahead of the next production block');
  assert.match(step.body, /5 × Uranium power \(Nuclear Power Plant\), already built in Phase 4/);
});

test('the step is only for a chosen main power', () => {
  const plan = rocketNuclearPlan();
  const auto = { ...plan, settings: { ...plan.settings, mainPower: 'auto' as const } };
  const ids = powerTasks(guideContext(auto, { checks: {} }, data, '4')).map(task => task.id);
  assert.ok(!ids.some(id => id.startsWith('preferred-power-')));
});

// The closing advice matches the step's case (#881): a Keep step commissions nothing and replaces
// nothing, and the start phase has no previous plant to keep online.
test('a kept line is not told to commission more capacity or keep a previous plant', () => {
  const plan = rocketNuclearPlan();
  plan.stages['5'] = { ...plan.stages['5'], rows: [uranium(5), fuelRods] };
  const step = powerStep(plan, '5')!;
  assert.equal(step.id, 'preferred-power-5', 'the check key is unchanged');
  assert.match(step.title, /^Keep nuclear power/);
  assert.doesNotMatch(step.body, /commission more capacity|previous plant/);
  assert.match(
    step.body,
    /No line needs more machines in this phase\. Before connecting the next factory, check the actual maximum consumption, with the utility allowance, against these lines' output\.$/,
  );
});

test('the spare-power step is not told to commission more capacity either', () => {
  const step = powerStep(rocketNuclearPlan(), '3')!;
  assert.doesNotMatch(step.body, /commission more capacity|previous plant/);
});

test('a Build step in the start phase names no previous plant', () => {
  const plan = rocketNuclearPlan('4');
  const step = powerStep(plan, '4')!;
  assert.equal(step.id, 'preferred-power-4', 'the check key is unchanged');
  assert.match(step.title, /^Build nuclear power/);
  assert.match(step.body, /commission more capacity before connecting the next factory\.$/);
  assert.doesNotMatch(step.body, /previous plant/);
});

test('Build and Expand steps after the start phase keep the previous plant online', () => {
  for (const [start, phase] of [
    ['3', '4'],
    ['3', '5'],
  ] as const) {
    const step = powerStep(rocketNuclearPlan(start), phase)!;
    assert.match(step.title, /^(Build|Expand) /);
    assert.match(
      step.body,
      /commission more capacity before connecting the next factory\. Keep the previous plant online until the replacement is stable\.$/,
    );
  }
});
