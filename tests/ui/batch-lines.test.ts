// Batch tasks in the build plan and the production line dialog (#1211): a line that only makes a
// Space Elevator part says how many to make, how long that takes at the plan's rate and the power
// switching it off then frees. A line that feeds another line has none, and neither has Post
// Phase 5, which keeps every Phase 5 line running. Nothing is ticked, stored or recalculated.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { $, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

// A whole-machine plan from Phase 1, made once.
let wholePlan: CurrentCalculatedPlan | undefined;
const whole = () =>
  structuredClone((wholePlan ??= generatedWith({ wholeMachines: true, phase: '1' })));

const SMART_PLATING = 'Recipe_SpaceElevatorPart_1_C';
const ADAPTIVE_CONTROL_UNIT = 'Recipe_SpaceElevatorPart_5_C';
const NUCLEAR_PASTA = 'Recipe_SpaceElevatorPart_9_C';

const step = (id: string) => $(`[data-check="${id}"]`)!.closest<HTMLElement>('.task')!;
const batch = (id: string) => step(id).querySelector('[data-step-batch]')?.textContent?.trim();

async function show(plan: CurrentCalculatedPlan, phase: Phase) {
  open({ calculated: plan, phase, state: {} });
  go('plan');
  render();
  await nextTick();
}

beforeEach(() => page());

test('a line that only makes an elevator part says to make its batch, then switch it off', async () => {
  await show(whole(), '1');
  assert.equal(
    batch('calc-1-' + SMART_PLATING),
    'Batch: Make 50 × Smart Plating (about 25 minutes at this rate), then switch the line off until Phase 2 needs it again: frees 15 MW.',
  );
  // The step's own text and its tick stay as they were.
  assert.doesNotMatch(
    step('calc-1-' + SMART_PLATING).querySelector('details > p:not([data-step-batch])')!
      .textContent!,
    /Batch|switch the line off/,
  );
  assert.equal(
    step('calc-1-' + SMART_PLATING).querySelector<HTMLInputElement>('[data-check]')!.checked,
    false,
  );
  await show(whole(), '3');
  assert.equal(
    batch('calc-3-' + ADAPTIVE_CONTROL_UNIT),
    'Batch: Make 100 × Adaptive Control Unit (about 1 h 40 min at this rate), then switch the line off until Phase 4 needs it again: frees 55 MW.',
  );
  // The lines feeding the parts' lines keep running.
  const plan = whole();
  const rows = plan.stages['3'].rows!;
  const acu = rows.find(row => row.id === ADAPTIVE_CONTROL_UNIT)!;
  const feeder = rows.find(row =>
    Object.keys(row.outputs).some(item => (acu.inputs[item] ?? 0) > 0),
  )!;
  assert.ok(feeder, 'a line feeds the Adaptive Control Units');
  assert.equal(batch('calc-3-' + feeder.id), undefined);
});

test('the production line dialog says the same', async () => {
  await show(whole(), '3');
  openCalculatedFactory(ADAPTIVE_CONTROL_UNIT);
  assert.equal(
    $('#detail [data-batch-note]')?.textContent?.trim(),
    'Batch: Make 100 × Adaptive Control Unit (about 1 h 40 min at this rate), then switch the line off until Phase 4 needs it again: frees 55 MW.',
  );
});

test('a part line that feeds another line, and Post Phase 5, have no batch task', async () => {
  // Phase 5's Nuclear Pasta also goes into another line.
  await show(whole(), '5');
  assert.equal(batch('calc-5-' + NUCLEAR_PASTA), undefined);
  openCalculatedFactory(NUCLEAR_PASTA);
  assert.equal($('#detail [data-batch-note]'), null);
  assert.match(batch('calc-5-Recipe_SpaceElevatorPart_11_C') ?? '', /^Batch: Make 200 × Ballistic/);
  await show(whole(), 'post');
  assert.equal(batch('calc-5-Recipe_SpaceElevatorPart_11_C'), undefined);
});
