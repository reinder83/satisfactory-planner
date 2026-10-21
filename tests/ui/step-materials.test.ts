// What a build-plan step takes to build (#1073), on the default plan's Phase 3: a new line's step
// ends with its machines, the Water Extractors for the Water it extracts and the belt and pipe
// marks of the phase, then the parts those buildings cost. A line the phase before marked running
// and a grown line count only the machines still to add; a line with machines to spare, and a step
// that builds no line, show none. Nothing is ticked, stored or recalculated by the page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase, ProgressState } from '../../public/types/index.ts';

let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generated()));
const PLASTIC = 'calc-3-Recipe_ResidualPlastic_C';
const PLATE = 'calc-3-Recipe_IronPlate_C';

const step = (id: string) => $(`[data-check="${id}"]`)!.closest<HTMLElement>('.task')!;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const materials = (id: string) => text(step(id).querySelector('[data-step-materials]'));

async function show(progress: Partial<ProgressState> = {}, phase: Phase = '3') {
  open({ calculated: plan(), phase, state: progress });
  go('plan');
  render();
  await nextTick();
}

beforeEach(() => page());

test('the default plan builds 2 Refineries for Residual Plastic and 6 Constructors for Iron Plate in Phase 3, 13 in Phase 4', () => {
  const rows = plan().stages['3'].rows!;
  const row = (id: string) => rows.find(candidate => candidate.id === id)!;
  assert.equal(row('Recipe_ResidualPlastic_C').machines, 2);
  assert.ok(row('Recipe_ResidualPlastic_C').inputs.Water! > 0);
  assert.equal(row('Recipe_IronPlate_C').machines, 6);
  assert.equal(plan().stages['4'].rows!.find(r => r.id === 'Recipe_IronPlate_C')!.machines, 13);
});

test('a new line’s step says what it takes to build, Water Extractors and lanes included', async () => {
  await show();
  assert.equal(
    materials(PLASTIC),
    'To build: 2 Refineries + 1 Water Extractor + Mk.4 belts and Mk.2 pipes ' +
      'Materials: 60 × Copper Sheet, 60 × Steel Pipe, 20 × Encased Industrial Beam, 20 × Motor, 10 × Reinforced Iron Plate, 10 × Rotor',
  );
  assert.equal(
    materials(PLATE),
    'To build: 6 Constructors + Mk.4 belts Materials: 48 × Cable, 12 × Reinforced Iron Plate',
  );
  // A step that builds no line has none.
  const others = $$('[data-check]').filter(box => !box.dataset.check!.startsWith('calc-3-'));
  assert.ok(others.length > 0);
  for (const box of others)
    assert.equal(box.closest('.task')!.querySelector('[data-step-materials]'), null);
});

test('a line the phase before marked running counts only the machines this phase adds', async () => {
  // Phase 3 builds 6 Constructors for Iron Plate and Phase 4 builds 13 (the plan starts in Phase 3).
  const progress = { checks: { [PLATE]: true } };
  await show(progress, '4');
  assert.equal(
    materials('calc-4-Recipe_IronPlate_C'),
    'To build: 7 Constructors + Mk.5 belts Materials: 56 × Cable, 14 × Reinforced Iron Plate',
  );
  assert.deepEqual(state.checks, progress.checks);
});

test('a grown line counts the machines to add, without the extractors of the whole line', async () => {
  const progress: Partial<ProgressState> = {
    version: 19,
    checks: { [PLASTIC]: false },
    builtMachines: { [PLASTIC]: 1 },
  };
  await show(progress);
  assert.match(
    materials(PLASTIC),
    /^To build: 1 Refinery \+ Mk\.4 belts and Mk\.2 pipes Materials: /,
  );
  assert.deepEqual(state.builtMachines, progress.builtMachines);
});

test('a line with machines to spare has nothing to build', async () => {
  await show({ version: 19, checks: { [PLATE]: true }, builtMachines: { [PLATE]: 8 } });
  assert.equal(step(PLATE).querySelector('[data-step-materials]'), null);
});
