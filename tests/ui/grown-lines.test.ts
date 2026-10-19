// A production line a recalculation grew (#1174): 5 Refineries ticked as built, a plan that now
// needs 6. Its build-plan step is unticked but says "5 of 6 built" under its title and opens
// with a table of what stands, what the plan needs and what to add, with the extra input the
// added machine takes; "Built so far" counts its built part, and its card on the Factories page
// says the same. Without a built count the step reads as before, and ticking the step is the
// user's own write. Nothing is ticked, stored or recalculated by the page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, ProgressState } from '../../public/types/index.ts';

// The plan with a storage rate of 5/min, whose Phase 4 Residual Fuel line needs 6 Refineries.
let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({ storageRate: 5 })));
const ROW = 'Recipe_ResidualFuel_C';
const KEY = 'calc-4-' + ROW;
const GROWN: Partial<ProgressState> = {
  version: 18,
  checks: { [KEY]: false },
  builtMachines: { [KEY]: 5 },
};

const step = (id: string) => $(`[data-check="${id}"]`)!.closest<HTMLElement>('.task')!;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function show(progress: Partial<ProgressState>, route = 'plan') {
  open({ calculated: plan(), phase: '4', state: progress });
  go(route);
  render();
  await nextTick();
}

beforeEach(() => page());

test('the plan needs 6 Refineries for Residual Fuel in Phase 4', () => {
  const row = plan().stages['4'].rows!.find(candidate => candidate.id === ROW)!;
  assert.equal(row.machines, 6);
  assert.equal(row.machine, 'Refinery');
});

test('a grown line says how many stand and how many to add, and stays unticked', async () => {
  const before = structuredClone(GROWN);
  await show(GROWN);
  const task = step(KEY);
  assert.equal(text(task.querySelector('[data-step-built]')), '5 of 6 built');
  const box = task.querySelector<HTMLInputElement>('input[data-check]')!;
  assert.equal(box.checked, false);
  assert.ok(
    box
      .getAttribute('aria-describedby')!
      .split(' ')
      .includes('step-built-' + KEY),
  );
  const table = task.querySelector('[data-step-table]')!;
  assert.match(
    text(table.querySelector('p')),
    /^5 Refineries built, so add 1, which takes [\d.,]+ m³\/min more Heavy Oil Residue\. Tick this step once all 6 stand\.$/,
  );
  const rows = [...table.querySelectorAll('[data-step-table-row]')].map(row =>
    [...row.children].map(cell => text(cell)),
  );
  assert.deepEqual(rows[0], ['Refineries', '5', '6', '1']);
  assert.equal(rows[1]![0], 'Heavy Oil Residue');
  // The line's own text follows under the table: its machines, inputs and outputs.
  assert.match(text(table.querySelector('[data-step-table-after]')), /6 Refinery total/);
  // "Built so far" counts the built part.
  assert.match(
    text($('[data-build-grown]')),
    /^1 more is partly built, counted at its built machines\.$/,
  );
  // The page changed nothing.
  assert.deepEqual(state.checks, before.checks);
  assert.deepEqual(state.builtMachines, before.builtMachines);
});

test('without a built count the step reads as before', async () => {
  await show({ checks: { [KEY]: false } });
  const task = step(KEY);
  assert.equal(task.querySelector('[data-step-built]'), null);
  assert.equal(task.querySelector('[data-step-table]'), null);
  assert.equal($('[data-build-grown]'), null);
  assert.ok(!$$('.task').some(other => /built, so add/.test(other.textContent!)));
});

test('ticked, all its machines stand: no built note, and the step reads as before', async () => {
  await show({ ...GROWN, checks: { [KEY]: true } });
  const task = step(KEY);
  assert.equal(task.querySelector<HTMLInputElement>('input[data-check]')!.checked, true);
  assert.equal(task.querySelector('[data-step-built]'), null);
  assert.equal(task.querySelector('[data-step-table]'), null);
});

test("the line's card says how many machines stand", async () => {
  await show(GROWN, 'factories');
  const card = $(`[data-check="${KEY}"]`)!.closest<HTMLElement>('.factory-card')!;
  assert.equal(text(card.querySelector('[data-grown]')), '5 of 6 machines built: add 1');
  assert.equal(
    card.querySelector('[data-running-status]')!.getAttribute('data-running-status'),
    'partly',
  );
});

test('the production line dialog opens with what stands and what to add', async () => {
  await show(GROWN, 'factories');
  openCalculatedFactory(ROW);
  assert.match(
    text($('#detail [data-expansion-carried]')),
    /^5 Refineries built, so add 1, which takes [\d.,]+ m³\/min more Heavy Oil Residue\./,
  );
});
