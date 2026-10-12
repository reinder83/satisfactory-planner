// The long step texts as tables and lists (#1136, the audit after the mining step): each step type
// that lists several items gets structured data next to its plain `body`, worked out from the plan
// like the body. The body keeps its words (tests/ui/step-texts.test.ts holds every body to its
// recording), so here each structure is checked against the body it stands beside: the intro and
// the line after it are the body's own words, and every row or item names what the body names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { phaseSteps, retiredLines, type PhaseStep } from '../public/progression.ts';
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

test('"Power available now" with spare power gives the power balance as a table', () => {
  const plan = calculate({
    phase: '4',
    availablePowerGW: 2,
    augmenters: 2,
    phaseMining: true,
    wholeMachines: true,
  }) as StoredCalculatedPlan;
  const step = steps(plan, '5').find(found => found.id === 'startup-5-power-review')!;
  const table = step.table!;
  assert.deepEqual(table.columns, ['Power', 'Supplies', 'Needs', 'Details']);
  assert.deepEqual(
    table.rows.map(row => row[0]),
    [
      'Spare power',
      'Augmenters',
      'Production lines',
      'Miners and extractors',
      'Trains, drones and pumps',
      'New generators',
    ],
  );
  const cell = (name: string, column: number) => table.rows.find(row => row[0] === name)![column]!;
  // Each figure is the body's.
  assert.ok(step.body.startsWith(`You have ${cell('Spare power', 1)} of spare power available`));
  assert.ok(step.body.includes(`your 2 augmenters add ${cell('Augmenters', 1)}`));
  assert.ok(step.body.includes(`${cell('Production lines', 2)} for production lines`));
  assert.ok(step.body.includes(`${cell('Miners and extractors', 2)} for miners and extractors`));
  assert.ok(step.body.includes(`${cell('Trains, drones and pumps', 2)} at 20% for trains`));
  assert.ok(step.body.includes(`which provides ${cell('New generators', 1)}`));
  assert.ok(step.body.includes(cell('New generators', 3)), 'the generator lines are the body’s');
  assert.equal(table.total![0], 'Total');
  assert.ok(step.body.includes(`(${table.total![2]} in all`));
  assert.ok(step.body.includes(`, ${table.total![3]}.`), 'what is left, and why');
  assert.ok(step.body.endsWith(table.after!));
  assert.match(table.after!, /^Unlock Petroleum Power first\./);
  assert.match(table.after!, /Water Extractors/);
  assert.match(table.intro, /This phase needs [\d.,]+ GW more: build its .* power\.$/);
  // Without spare power or augmenters the step stays text: it advises unlocks, not a balance.
  const plain = steps(latePlan(), '4').find(found => found.id === 'startup-4-power-review')!;
  assert.equal(plain.table, undefined);
});

test('spare power that covers the phase: the balance says nothing needs building', () => {
  const plan = calculate({ phase: '3', availablePowerGW: 30 }) as StoredCalculatedPlan;
  const step = steps(plan, '3').find(found => found.id === 'startup-3-power-review')!;
  const table = step.table!;
  assert.match(table.intro, /, which covers this phase's [\d.,]+ [MG]W: nothing needs building/);
  assert.match(table.total![3]!, /^[\d.,]+ GW spare/);
  assert.ok(step.body.startsWith('You have 30 GW of spare power available, which covers'));
});

test('the augmenter step gives fueled and unfueled augmenters as a table with a total', () => {
  const step = steps(latePlan(), '5').find(found => found.id === 'alien-power-augmenter')!;
  const table = step.table!;
  assert.deepEqual(table.columns, [
    'Augmenters',
    'Count',
    'Somersloops',
    'Alien Power Matrix',
    'Grid boost',
    'Generates',
  ]);
  assert.deepEqual(table.rows[0]!.slice(0, 5), ['Fueled', '1', '10', '5/min', '30%']);
  assert.deepEqual(table.rows[1]!.slice(0, 5), ['Unfueled', '2', '20', 'None', '10%']);
  assert.deepEqual(table.total!.slice(0, 4), ['Total', '3', '30', '5/min']);
  // The body's figures: 10 Somersloops each, 30 in total, 5 Alien Power Matrix/min for the one fed.
  assert.match(step.body, /at 10 Somersloops each — 30 in total/);
  assert.match(step.body, /Feed 1 of them 5 Alien Power Matrix\/min in total/);
  assert.ok(step.body.startsWith(table.intro.slice(0, -1)));
  assert.match(table.after!, /^The Somersloops are not recoverable\. Each one generates 500 MW/);
  assert.match(table.after!, /An augmenter that runs dry falls back to 10%\.$/);
  // None fueled: one row, and the advice on feeding one.
  const unfed = calculate({ phase: '5', augmenters: 2 }) as StoredCalculatedPlan;
  const plain = steps(unfed, '5').find(found => found.id === 'alien-power-augmenter')!;
  assert.deepEqual(
    plain.table!.rows.map(row => row[0]),
    ['Unfueled'],
  );
  assert.equal(plain.table!.total![3], 'None');
  assert.ok(plain.body.endsWith(plain.table!.after!.replace(/^.*island\. /, '')));
});

test('the retire step gives every retired line as a table: line, machine and how many', () => {
  const plan = calculate({
    phase: '1',
    recipes: 'all',
    goal: 'timed',
    hours: 10,
    multiplier: 5,
  }) as StoredCalculatedPlan;
  let longer = 0;
  for (const phase of ['2', '3', '4', '5']) {
    const step = steps(plan, phase).find(found => found.id === 'retire-' + phase);
    const lines = retiredLines(plan, Number(phase));
    if (!lines.length) {
      assert.equal(step, undefined);
      continue;
    }
    const table = step!.table!;
    assert.deepEqual(table.columns, ['Line', 'Machine', 'Machines']);
    assert.equal(table.rows.length, lines.length, 'every line, also past the body’s ten');
    table.rows.forEach(([name, machine, machines], i) => {
      assert.equal(name, lines[i]!.name);
      if (i < 10) assert.ok(step!.body.includes(`${machines} × ${name} (${machine})`));
    });
    if (lines.length > 10) {
      longer++;
      assert.match(step!.body, / and \d+ more lines?, all last needed/);
    }
    assert.equal(
      table.intro,
      `Phase ${phase} does not run ${lines.length === 1 ? 'this line' : `these ${lines.length} lines`}, all last needed in Phase ${Number(phase) - 1}. Its resource and power budgets do not include them.`,
    );
    assert.ok(step!.body.endsWith(table.after!));
  }
  assert.ok(longer, 'a phase retires more than ten lines');
});

test('two or more hand-fed constructors are a list, one line each; one stays a sentence', () => {
  const step = steps(latePlan(), '4').find(found => found.id === 'sloop-hand-fed')!;
  const list = step.list!;
  assert.equal(list.intro, 'Reserve 2 Somersloops, one for each:');
  assert.equal(list.items.length, 2);
  for (const item of list.items) {
    assert.match(item, /^A Constructor .*\.$/);
    assert.ok(step.body.includes(item.charAt(0).toLowerCase() + item.slice(1, -1)), item);
  }
  assert.ok(step.body.startsWith('Reserve 2 Somersloops for a Constructor'));
  assert.ok(step.body.endsWith(list.after!));
  assert.match(listText(list), /one for each/);
  const one = calculate({ phase: '3', sloopReserved: ['biofuel'] }) as StoredCalculatedPlan;
  const single = steps(one, '3').find(found => found.id === 'sloop-hand-fed')!;
  assert.equal(single.list, undefined, 'one constructor stays a sentence');
  assert.match(single.body, /^Reserve 1 Somersloop for a Constructor making Solid Biofuel/);
});
