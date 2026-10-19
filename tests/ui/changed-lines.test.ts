// Built lines a recalculation changed (#1175), on the default plan's Phase 4: Residual Fuel
// ticked with 6 Refineries where the plan needs 5 (shrunk), a Steel Screws line of 20
// Constructors the plan no longer has, whose Screws its Screws line now makes (switched), and a
// Fine Concrete line of 3 Assemblers that nothing in the phase replaces (no longer needed). The
// shrunk step stays ticked and says how many are spare, the Screws step says what to switch and
// add, the plan lists the line no longer needed, and the cards and the dialog say the same.
// Nothing is ticked, stored or recalculated by the page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { changedText, recalculatedText } from '../../public/app/recalculate.ts';
import { state, type View } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, catalog, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, ProgressState } from '../../public/types/index.ts';

let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({})));
const REFINERY = 'calc-4-Recipe_ResidualFuel_C';
const SCREWS = 'calc-4-Recipe_Screw_C';
const STEEL = 'calc-4-Recipe_Alternate_Screw_2_C';
const FINE = 'calc-4-Recipe_Alternate_Concrete_C';
const CHANGED: Partial<ProgressState> = {
  version: 19,
  checks: { [REFINERY]: true, [FINE]: true },
  notes: { [STEEL]: 'Twenty by the steel mill', [FINE]: 'Three on the hill' },
  builtMachines: { [REFINERY]: 6, [STEEL]: 20, [FINE]: 3 },
};

const step = (id: string) => $(`[data-check="${id}"]`)!.closest<HTMLElement>('.task')!;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tableRows = (table: Element) =>
  [...table.querySelectorAll('[data-step-table-row]')].map(row =>
    [...row.children].map(cell => text(cell)),
  );

async function show(progress: Partial<ProgressState>, route: View = 'plan') {
  open({ calculated: plan(), phase: '4', state: progress, workspace: { catalog: catalog() } });
  go(route);
  render();
  await nextTick();
}

beforeEach(() => page());

test('the plan needs 5 Refineries for Residual Fuel and 35 Constructors for Screws', () => {
  const rows = plan().stages['4'].rows!;
  assert.equal(rows.find(row => row.id === 'Recipe_ResidualFuel_C')!.machines, 5);
  assert.equal(rows.find(row => row.id === 'Recipe_Screw_C')!.machines, 35);
  assert.ok(!rows.some(row => row.id === 'Recipe_Alternate_Screw_2_C'));
  assert.ok(!rows.some(row => row.id === 'Recipe_Alternate_Concrete_C'));
});

test('a shrunk line stays ticked and says how many machines are spare', async () => {
  const before = structuredClone(CHANGED);
  await show(CHANGED);
  const task = step(REFINERY);
  assert.equal(task.querySelector<HTMLInputElement>('input[data-check]')!.checked, true);
  assert.equal(text(task.querySelector('[data-step-spare]')), '6 built, 1 spare');
  const table = task.querySelector('[data-step-table]')!;
  assert.equal(
    text(table.querySelector('p')),
    '6 Refineries built, 5 needed: 1 is spare. Switch it off or dismantle it, or underclock all ' +
      '6 to share the work.',
  );
  assert.deepEqual(tableRows(table), [['Refineries', '6', '5', '1']]);
  assert.match(text(table.querySelector('[data-step-table-after]')), /5 Refinery total/);
  assert.deepEqual(state.checks, before.checks);
  assert.deepEqual(state.builtMachines, before.builtMachines);
});

test('a line switched from another recipe says what to switch and what to add', async () => {
  await show(CHANGED);
  const task = step(SCREWS);
  assert.equal(task.querySelector<HTMLInputElement>('input[data-check]')!.checked, false);
  assert.equal(
    text(task.querySelector('[data-step-built]')),
    '20 to switch from Steel Screws, 15 to add',
  );
  const table = task.querySelector('[data-step-table]')!;
  assert.equal(
    text(table.querySelector('p')),
    'Switch 20 Constructors from Steel Screws to Screws, and add 15. Tick this step once all 35 ' +
      'run Screws.',
  );
  assert.deepEqual(tableRows(table), [
    ['Steel Screws', 'Constructors', '20', '0', 'switch 20 to Screws'],
    ['Screws', 'Constructors', '0', '35', 'add 15'],
  ]);
});

test('a line no longer needed is listed over the plan as one to dismantle or keep', async () => {
  await show(CHANGED);
  const note = $('[data-former-lines]')!;
  assert.match(
    text(note),
    /^No longer needed\. This production line you built under an earlier plan is not in the plan for Phase 4 any more\. It can be dismantled or kept/,
  );
  assert.deepEqual(tableRows(note), [['Fine Concrete', 'Assemblers', '3', '0']]);
  // The notes of both lines stay.
  assert.equal(state.notes[FINE], 'Three on the hill');
  assert.equal(state.notes[STEEL], 'Twenty by the steel mill');
});

test('without built machines the steps read as before and there is no note', async () => {
  await show({ checks: { [REFINERY]: true } });
  assert.equal(step(REFINERY).querySelector('[data-step-spare]'), null);
  assert.equal(step(SCREWS).querySelector('[data-step-table]'), null);
  assert.equal($('[data-former-lines]'), null);
});

test('once the switched-to line is ticked, the switch is done', async () => {
  await show({ ...CHANGED, checks: { ...CHANGED.checks, [SCREWS]: true } });
  assert.equal(step(SCREWS).querySelector('[data-step-built]'), null);
  assert.equal(step(SCREWS).querySelector('[data-step-table]'), null);
  assert.deepEqual(tableRows($('[data-former-lines]')!), [
    ['Fine Concrete', 'Assemblers', '3', '0'],
  ]);
});

test("the lines' cards say what changed", async () => {
  await show(CHANGED, 'factories');
  const card = (key: string) => $(`[data-check="${key}"]`)!.closest<HTMLElement>('.factory-card')!;
  const chip = (key: string) =>
    card(key).querySelector('[data-running-status]')!.getAttribute('data-running-status');
  assert.equal(
    text(card(SCREWS).querySelector('[data-grown]')),
    '20 to switch from Steel Screws, 15 to add',
  );
  assert.equal(chip(SCREWS), 'switch');
  assert.equal(
    text(card(REFINERY).querySelector('[data-grown]')),
    '6 machines built, 5 needed: 1 spare',
  );
  // Ticked, it is marked running (held back here, as nothing that feeds it is ticked).
  assert.equal(chip(REFINERY), 'held');
});

test('the production line dialog opens with what to switch', async () => {
  await show(CHANGED, 'factories');
  openCalculatedFactory('Recipe_Screw_C');
  assert.match(
    text($('#detail [data-expansion-carried]')),
    /^Switch 20 Constructors from Steel Screws to Screws, and add 15\./,
  );
});

test('the toasts count the built lines that changed', () => {
  assert.equal(
    changedText(3),
    '3 built production lines changed: their steps and the note above the plan say what to ' +
      'switch, spare or dismantle',
  );
  assert.equal(
    recalculatedText(0, 'Old (before edit)', 0, 1),
    'Recalculated in place. 1 built production line changed: its step or the note above the ' +
      'plan says what to switch, spare or dismantle. The previous version is kept as “Old ' +
      '(before edit)” under Profiles.',
  );
  assert.equal(
    recalculatedText(0, 'Old (before edit)'),
    'Recalculated in place. The previous version is kept as “Old (before edit)” under Profiles.',
  );
});
