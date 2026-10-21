// The Biomass Burner bank step's fuel totals (#1204, part of #1078): what the standalone burners
// take of each fuel they burn by hand (Leaves, Wood, Mycelia, Biomass, Solid Biofuel), per minute,
// for the phase's planned run time and in stacks. Display only: worked out from the plan's burner
// count and its stage's hours each time, from the energy and stack sizes recipes.json holds, and
// never saved. The numbers read as in en-US.
import './helpers/en-us-numbers.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { phaseSteps } from '../public/progression.ts';
import { BURNER_FUELS, BURNER_MW, OWNED_GENERATORS } from '../public/preferences.ts';
import { calculate } from '../planner.ts';
import type { CurrentCalculatedPlan, Progression } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const recipes = JSON.parse(
  fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'),
) as { items: Record<string, { energy: number; stack: number }> };

let made: CurrentCalculatedPlan | undefined;
// A Phase 1 plan with its power need and run time fixed, so the totals are known whatever the
// planner solves: `needMW` of planned load gives (needMW + 12) / 30 burners, and `hours` is the
// phase's run time (null: a phase that never finishes).
function planWith(needMW: number, hours: number | null, ticked: Record<string, boolean> = {}) {
  const plan = structuredClone((made ??= calculate({ phase: '1' })));
  plan.stages['1'].grid!.needMW = needMW;
  plan.stages['1'].grid!.spareMW = 0;
  (plan.stages['1'] as { hours: number | null }).hours = hours;
  return phaseSteps(plan, { checks: ticked }, data, '1').find(
    step => step.id === 'startup-burner-bank-1',
  )!;
}

test('the fuels carry the energy and stack sizes of the game data, and the burner its 30 MW', () => {
  assert.deepEqual(
    BURNER_FUELS.map(fuel => fuel.name),
    ['Leaves', 'Wood', 'Mycelia', 'Biomass', 'Solid Biofuel'],
  );
  for (const { name, mj, stack } of BURNER_FUELS) {
    assert.equal(mj, recipes.items[name]!.energy, name + ' energy');
    assert.equal(stack, recipes.items[name]!.stack, name + ' stack size');
  }
  assert.equal(BURNER_MW, OWNED_GENERATORS.find(own => own.machine === 'Biomass Burner')!.mw);
});

test('a Phase 1 bank of 10 burners over 10 hours: each fuel per minute, for the run and in stacks', () => {
  const step = planWith(288, 10);
  assert.match(step.body, /allow about 10 standalone burners/);
  const table = step.table!;
  assert.deepEqual(table.columns, ['Fuel', 'Per minute', 'For the run', 'Stacks', 'Details']);
  assert.deepEqual(
    table.rows.map(row => row.slice(0, 4)),
    [
      ['Leaves', '1,200/min', '720,000', '1,440 stacks of 500'],
      ['Wood', '180/min', '108,000', '540 stacks of 200'],
      ['Mycelia', '900/min', '540,000', '2,700 stacks of 200'],
      ['Biomass', '100/min', '60,000', '300 stacks of 200'],
      ['Solid Biofuel', '40/min', '24,000', '120 stacks of 200'],
    ],
  );
  assert.match(table.intro, /allow about 10 standalone burners/);
  assert.match(
    table.intro,
    /at full load, for the phase's planned run time of about 10 h, by fuel \(burn one kind, not all of them\):$/,
  );
  // The body says the same, for search and copying.
  assert.match(
    step.body,
    /at full load, for the phase's planned run time of about 10 h, by fuel \(burn one kind, not all of them\): 720,000 Leaves \(1,440 stacks of 500\) at 1,200\/min; 108,000 Wood .*; 24,000 Solid Biofuel \(120 stacks of 200\) at 40\/min\./,
  );
  // The sizing words and the closing estimate are as they were.
  assert.match(step.body, /this bank needs up to 40\/min\./);
  assert.match(table.after!, /^This is a startup estimate/);
});
// A fuel's row of the step's table: its name, rate, total for the run and stacks.
const fuelRow = (step: ReturnType<typeof planWith>, fuel: string) =>
  step.table!.rows.find(row => row[0] === fuel)!.slice(0, 4);

test('the totals follow the burner count', () => {
  // 20 burners (588 MW of load): twice the fuel of 10 over the same run time.
  const step = planWith(588, 10);
  assert.match(step.body, /allow about 20 standalone burners/);
  assert.deepEqual(fuelRow(step, 'Leaves'), [
    'Leaves',
    '2,400/min',
    '1,440,000',
    '2,880 stacks of 500',
  ]);
  assert.deepEqual(fuelRow(step, 'Solid Biofuel'), [
    'Solid Biofuel',
    '80/min',
    '48,000',
    '240 stacks of 200',
  ]);
});

test('the totals follow the run time, each rounded up to whole items and stacks', () => {
  // 10 burners over 2.5 hours: Solid Biofuel is 40/min for 150 minutes, 6,000 items.
  const step = planWith(288, 2.5);
  assert.deepEqual(fuelRow(step, 'Solid Biofuel'), [
    'Solid Biofuel',
    '40/min',
    '6,000',
    '30 stacks of 200',
  ]);
  assert.deepEqual(fuelRow(step, 'Wood'), ['Wood', '180/min', '27,000', '135 stacks of 200']);
  // 20 minutes: 800 Solid Biofuel, exactly 4 stacks. 6 minutes: 240, two stacks. 36 seconds: 24
  // items, one stack.
  const solid = (hours: number) => fuelRow(planWith(288, hours), 'Solid Biofuel');
  assert.deepEqual(solid(1 / 3), ['Solid Biofuel', '40/min', '800', '4 stacks of 200']);
  assert.deepEqual(solid(0.1), ['Solid Biofuel', '40/min', '240', '2 stacks of 200']);
  assert.deepEqual(solid(0.01), ['Solid Biofuel', '40/min', '24', '1 stack of 200']);
});

test('a phase with no run time shows the rates alone', () => {
  for (const hours of [null, Infinity, 0]) {
    const { table, body } = planWith(288, hours);
    assert.deepEqual(table!.columns, ['Fuel', 'Per minute', 'Details']);
    assert.deepEqual(
      table!.rows.map(row => row.slice(0, 2)),
      [
        ['Leaves', '1,200/min'],
        ['Wood', '180/min'],
        ['Mycelia', '900/min'],
        ['Biomass', '100/min'],
        ['Solid Biofuel', '40/min'],
      ],
    );
    assert.doesNotMatch(table!.intro, /run time/);
    assert.match(
      body,
      /at full load, by fuel \(burn one kind, not all of them\): 1,200 Leaves\/min; 180 Wood\/min/,
    );
  }
});

test('Solid Biofuel says what it needs until Obstacle Clearing is ticked', () => {
  const obstacle = data.entries.find(entry => entry.name === 'Obstacle Clearing')!;
  const details = (step: ReturnType<typeof planWith>) =>
    step.table!.rows.find(row => row[0] === 'Solid Biofuel')!.at(-1)!;
  assert.match(details(planWith(288, 10)), /once Obstacle Clearing is unlocked/);
  assert.doesNotMatch(
    details(planWith(288, 10, { ['unlock-' + obstacle.id]: true })),
    /Obstacle Clearing/,
  );
});
