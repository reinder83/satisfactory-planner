// The long step texts as tables and lists on the build plan (#1136, the audit after the mining
// step): each converted step type draws its table (StepTable.vue) or list (StepList.vue) in place
// of its text; "Find a step…" still finds it by its body and also by words only the structure
// shows; an edited body replaces the structure and keeps the tick; the step ids are the ones they
// always were.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { setQuery } from '../../public/app/session.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { render } from '../../public/app/shell.ts';
import { $, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, ProgressState } from '../../public/types/index.ts';

const toLocale = Number.prototype.toLocaleString;
beforeAll(() => {
  Number.prototype.toLocaleString = function (
    this: number,
    _locale?: unknown,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocale.call(this, 'en-US', options);
  };
});
afterAll(() => {
  Number.prototype.toLocaleString = toLocale;
  setQuery('');
});

// A synthetic Phase 4 profile: rocket fuel power, mining per phase, two hand-fed constructors and
// three Alien Power Augmenters (one fueled) in Phase 5.
let late: CurrentCalculatedPlan;
beforeEach(() => {
  late ??= generatedWith({
    phase: '4',
    mainPower: 'rocket',
    augmenters: 3,
    fueledAugmenters: 1,
    phaseMining: true,
    wholeMachines: true,
    sloopReserved: ['shards', 'dna'],
  });
  page();
  setQuery('');
});
const plain = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
const read = (name: string) => JSON.parse(fs.readFileSync('tests/fixtures/' + name, 'utf8'));

function show(
  phase: '1' | '2' | '3' | '4' | '5' | 'post',
  plan = late,
  state: Partial<ProgressState> = {},
) {
  open({ calculated: structuredClone(plan), phase, state });
  go('plan');
  render();
}
// A step's table as text: the column names, then each row's cells.
const tableOf = (stepId: string) => {
  const table = $(`[data-task="${stepId}"]`)?.querySelector('[data-step-table]');
  if (!table) return null;
  return {
    intro: plain(table.querySelector('p')?.textContent),
    columns: [...table.querySelectorAll('thead th')].map(cell => plain(cell.textContent)),
    rows: [...table.querySelectorAll('[data-step-table-row]')].map(row =>
      [...row.children].map(cell => plain(cell.textContent)),
    ),
    total: [...(table.querySelector('[data-step-table-total]')?.children ?? [])].map(cell =>
      plain(cell.textContent),
    ),
    after: plain(table.querySelector('[data-step-table-after]')?.textContent),
  };
};
// Whether "Find a step…" with `words` shows the step.
async function found(stepId: string, words: string) {
  const body = planTasks().find(step => step.id === stepId)?.body ?? '';
  assert.ok(body, stepId + ' has a body');
  return foundBy(stepId, words);
}
// Whether the search finds the step by `words` that only its table or list shows: its body and
// title do not have them.
async function foundOnlyInStructure(stepId: string, words: string) {
  const step = planTasks().find(known => known.id === stepId)!;
  assert.ok(
    !(step.title + ' ' + step.body).toLowerCase().includes(words),
    words + ' is in the body',
  );
  return foundBy(stepId, words);
}
async function foundBy(stepId: string, words: string) {
  setQuery(words);
  render();
  await nextTick();
  const shown = !!$(`[data-task="${stepId}"]`);
  setQuery('');
  render();
  await nextTick();
  return shown;
}
// The step with an edited body: the edited words, no table or list, the tick kept.
function editedShowsWords(stepId: string, phase: '4' | '5' = '4', plan = late) {
  show(phase, plan, {
    checks: { [stepId]: true },
    taskEdits: {
      order: {},
      removed: [],
      titles: {},
      links: {},
      bodies: { [stepId]: 'My own words.' },
    },
  });
  const step = $(`[data-task="${stepId}"]`)!;
  assert.ok(step, stepId + ' is shown');
  assert.equal(step.querySelector('[data-step-table], [data-step-list]'), null);
  assert.equal(plain(step.querySelector('p')?.textContent), 'My own words.');
  assert.equal($<HTMLInputElement>(`[data-check="${stepId}"]`)!.checked, true);
}

test('a milestone step shows its cost as a table: item, amount and supply', async () => {
  show('4');
  const table = tableOf('unlock-Schematic_7-1_C')!;
  assert.ok(table, 'Tier 7: Bauxite Refinement has a cost table');
  assert.match(table.intro, /^Unlock at the HUB before using its machines or recipes\. Cost/);
  assert.deepEqual(table.columns, ['Item', 'Amount', 'Supply']);
  assert.deepEqual(table.rows[0], [
    'Computer',
    '100',
    'Production planned, not yet marked running',
  ]);
  assert.equal(table.after, 'Production checkmarks do not confirm inventory or spare capacity.');
  // "Amount" is a word only the table shows; the body's own words still find it.
  assert.ok(await foundOnlyInStructure('unlock-Schematic_7-1_C', 'amount'));
  assert.ok(await found('unlock-Schematic_7-1_C', 'heavy modular frame'));
  assert.equal(await found('unlock-Schematic_7-1_C', 'no such step anywhere'), false);
});

test('an edited milestone step shows the edited words and keeps its tick', () => {
  editedShowsWords('unlock-Schematic_7-1_C');
});

test('a plan stored before the tables shows its milestone costs as tables', () => {
  show('1', read('calculated-plan-2026-09-12.json'));
  const step = [...document.querySelectorAll<HTMLElement>('[data-task^="unlock-"]')].find(details =>
    details.querySelector('[data-step-table]'),
  );
  assert.ok(step, 'a stored plan’s milestone step draws its table');
});

test('the generator step shows its lines as a table', async () => {
  show('5');
  const table = tableOf('preferred-power-5')!;
  assert.ok(table, 'the generator step has a table');
  assert.deepEqual(table.columns, ['Generator line', 'Machines', 'This phase', 'Fuel']);
  assert.equal(table.rows[0]![0], 'Rocket Fuel power');
  assert.match(table.rows[0]![1]!, /^[\d,]+ × Fuel Generator$/);
  assert.match(table.rows[0]![2]!, /^[\d,]+ built in Phase 4, so add [\d,]+$/);
  assert.match(table.rows[0]![3]!, /Rocket Fuel\/min from the Rocket Fuel step$/);
  assert.match(table.after, /Keep the previous plant online until the replacement is stable\.$/);
  // "Generator line" is only the table's; "Blender access" is the body's.
  assert.ok(await foundOnlyInStructure('preferred-power-5', 'generator line'));
  assert.ok(await found('preferred-power-5', 'blender access'));
});

test('an edited generator step shows the edited words and keeps its tick', () => {
  editedShowsWords('preferred-power-5', '5');
});

// A synthetic Phase 4 profile with 2 GW of spare power and two Alien Power Augmenters.
let spare: CurrentCalculatedPlan;
const sparePlan = () =>
  (spare ??= generatedWith({
    phase: '4',
    availablePowerGW: 2,
    augmenters: 2,
    phaseMining: true,
    wholeMachines: true,
  }));

test('"Power available now" with spare power shows the power balance as a table', async () => {
  show('5', sparePlan());
  const table = tableOf('startup-5-power-review')!;
  assert.ok(table, 'the power step has a table');
  assert.match(table.intro, /^You have 2 GW of spare power available, and your 2 augmenters add/);
  assert.deepEqual(table.columns, ['Power', 'Supplies', 'Needs', 'Details']);
  assert.deepEqual(table.rows[0], ['Spare power', '2 GW', '', '']);
  assert.equal(table.rows[1]![0], 'Augmenters');
  assert.equal(table.rows[1]![3], '2 Alien Power Augmenters');
  const generators = table.rows.find(row => row[0] === 'New generators')!;
  assert.match(generators[3]!, /× Rocket Fuel power \(Fuel Generator\)/);
  assert.equal(table.total[0], 'Total');
  assert.match(table.total[3]!, / spare /);
  assert.match(table.after, /Water Extractors/);
  // "New generators" is only the table's; the body's words still find it.
  assert.ok(await foundOnlyInStructure('startup-5-power-review', 'new generators'));
  assert.ok(await found('startup-5-power-review', 'extra utilities power'));
});

test('an edited power step shows the edited words and keeps its tick', () => {
  editedShowsWords('startup-5-power-review', '5', sparePlan());
});

test('the augmenter step shows fueled and unfueled augmenters as a table', async () => {
  show('5');
  const table = tableOf('alien-power-augmenter')!;
  assert.ok(table, 'the augmenter step has a table');
  assert.match(table.intro, /^Research Power Augmenter in the MAM .*, then build 3 Augmenters\.$/);
  assert.deepEqual(table.rows, [
    ['Fueled', '1', '10', '5/min', '30%', '500 MW'],
    ['Unfueled', '2', '20', 'None', '10%', '1,000 MW'],
  ]);
  assert.deepEqual(table.total, ['Total', '3', '30', '5/min', '', '1.5 GW']);
  assert.ok(await foundOnlyInStructure('alien-power-augmenter', 'grid boost'));
  assert.ok(await found('alien-power-augmenter', 'not recoverable'));
});

test('an edited augmenter step shows the edited words and keeps its tick', () => {
  editedShowsWords('alien-power-augmenter', '5');
});
