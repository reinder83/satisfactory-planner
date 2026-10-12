// The long step texts as tables and lists (#1136, the audit after the mining step): each step type
// that lists several items gets structured data next to its plain `body`, worked out from the plan
// like the body. The body keeps its words (tests/ui/step-texts.test.ts holds every body to its
// recording), so here each structure is checked against the body it stands beside: the intro and
// the line after it are the body's own words, and every row or item names what the body names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { phaseSteps, type PhaseStep } from '../public/progression.ts';
import { listText, tableText } from '../public/step-table.ts';
import type { Progression, StoredCalculatedPlan } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const steps = (
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>,
  phase: string,
  checks: Record<string, boolean> = {},
): PhaseStep[] => phaseSteps(plan, { checks }, data, phase);

// A Phase 4 plan (synthetic settings) whose Phase 5 has augmenters and whose power is chosen.
let late: StoredCalculatedPlan | undefined;
const latePlan = () =>
  (late ??= calculate({
    phase: '4',
    mainPower: 'rocket',
    augmenters: 3,
    fueledAugmenters: 1,
    phaseMining: true,
    wholeMachines: true,
    sloopReserved: ['shards', 'dna'],
  }) as StoredCalculatedPlan);

test('milestone and MAM steps give their cost as a table: item, amount and supply', () => {
  const unlocks = steps(latePlan(), '4').filter(step => step.id.startsWith('unlock-'));
  assert.ok(unlocks.length >= 5);
  for (const step of unlocks) {
    const entry = data.entries.find(known => 'unlock-' + known.id === step.id)!;
    const items = Object.keys(entry.cost);
    if (!items.length) {
      assert.equal(step.table, undefined, step.id + ': no cost, no table');
      continue;
    }
    const table = step.table!;
    assert.deepEqual(table.columns, ['Item', 'Amount', 'Supply']);
    assert.deepEqual(
      table.rows.map(row => row[0]),
      items,
    );
    for (const [item, amount, supply] of table.rows) {
      // The body names each cost as "<amount> <item>: <supply>".
      assert.ok(
        step.body.includes(`${amount} ${item}: ${supply!.charAt(0).toLowerCase()}`),
        step.id + ': ' + item,
      );
    }
    assert.ok(step.body.startsWith(table.intro), step.id + ': the intro is the body’s start');
    assert.ok(step.body.endsWith(table.after!), step.id + ': the line after is the body’s end');
    assert.match(
      table.intro,
      /Cost \(base game; adjust if your milestone-cost settings differ\):$/,
    );
    assert.equal(table.caption, 'Cost of ' + step.title.replace(' (optional)', ''));
  }
  // The supply follows the ticks: a line marked running makes its item "already producing".
  const motor = latePlan().stages['4'].rows!.find(row => row.outputs['Motor'])!;
  const ticked = steps(latePlan(), '4', { ['calc-4-' + motor.id]: true }).find(
    step => step.id === 'unlock-Schematic_7-1_C',
  )!;
  assert.deepEqual(
    ticked.table!.rows.find(row => row[0] === 'Motor'),
    ['Motor', '250', 'Already producing (marked running; reserve a batch)'],
  );
  assert.match(tableText(ticked.table), /Item Amount Supply/);
});

test('an optional research step says so above its cost table too', () => {
  const optional = steps(calculate({}) as StoredCalculatedPlan, '3').filter(
    step => step.optional && step.table,
  );
  assert.ok(optional.length);
  for (const step of optional) {
    assert.match(step.table!.intro, /^Optional in this phase: none of its lines needs it/);
    assert.ok(step.body.startsWith(step.table!.intro));
  }
});

test('a plan stored before the tables gets them, worked out from its stored stages', () => {
  for (const plan of [
    fixture('calculated-plan-2026-09-12.json'),
    fixture('plan-before-1065.json').plan,
  ] as StoredCalculatedPlan[]) {
    const unlock = steps(plan, '1').find(step => step.id.startsWith('unlock-') && step.table);
    assert.ok(unlock, 'a stored plan’s milestone step has its table');
  }
  assert.equal(listText(undefined), '');
});

test('the generator step gives its lines as a table: machines, what this phase adds, fuel', () => {
  for (const phase of ['4', '5']) {
    const plan = latePlan(),
      step = steps(plan, phase).find(found => found.id === 'preferred-power-' + phase)!;
    const generators = plan.stages[phase as '4' | '5'].rows!.filter(row => row.generationMW > 0);
    const table = step.table!;
    assert.deepEqual(table.columns, ['Generator line', 'Machines', 'This phase', 'Fuel']);
    assert.deepEqual(
      table.rows.map(row => row[0]),
      generators.map(row => row.name),
    );
    for (const [name, machines, added, fuel] of table.rows) {
      const [count, machine] = machines!.split(' × ');
      assert.ok(
        step.body.includes(
          `${count} × ${name} (${machine}), ${added!.charAt(0).toLowerCase() + added!.slice(1)}`,
        ),
      );
      assert.ok(step.body.includes(`burning ${fuel}`), fuel);
    }
    assert.match(
      table.intro,
      new RegExp(`^Phase ${phase}'s plan generates power with these lines`),
    );
    assert.ok(step.body.endsWith(table.after!));
    assert.ok(step.body.includes(table.intro.replace(/^.*these lines\. /, '')));
  }
  // Phase 5 adds to the Phase 4 line.
  const five = steps(latePlan(), '5').find(found => found.id === 'preferred-power-5')!;
  assert.match(five.table!.rows[0]![2]!, /^\d+ built in Phase 4, so add \d+/);
  assert.match(tableText(five.table), /Generator line Machines This phase Fuel/);
});
