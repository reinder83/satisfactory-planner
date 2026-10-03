// Each milestone is listed once, under its own phase (#758, progression.ts milestonesListedIn).
// Its check key stays `unlock-<id>`, so a milestone ticked while a later phase listed it shows
// ticked in its own phase, and the phase a profile opens on (#570, phaseToOpen) follows the new
// lists without any saved change.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { phaseStepIds, phaseToOpen } from '../../public/app/opening-phase.ts';
import { progressionData, setHideDone, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, StageKey } from '../../public/types/index.ts';

// A calculated profile that starts in Phase 1, made once for the file.
let startsInOne: CurrentCalculatedPlan | undefined;
const phaseOnePlan = () => structuredClone((startsInOne ??= generatedWith({ phase: '1' })));

// MAM: Caterium. This plan's Phase 4 rows need it, and its costs are there from Phase 1 on, so
// before #758 only Phase 4 listed it; now Phase 1 does.
const caterium = () =>
  'unlock-' + progressionData.entries.find(entry => entry.mam && entry.name === 'Caterium')!.id;

beforeEach(() => page());

// Every step of `phases` ticked, less `open`.
function ticked(phases: StageKey[], open: string[] = []): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  for (const phase of phases) for (const id of phaseStepIds(phase)) checks[id] = true;
  for (const id of open) delete checks[id];
  return checks;
}

test('a milestone a later phase needs holds its own phase open', () => {
  open({ calculated: phaseOnePlan(), phase: '3' });
  const id = caterium();
  assert.ok(phaseStepIds('1').includes(id), 'Phase 1 lists MAM: Caterium');
  for (const phase of ['2', '3', '4', '5'] as StageKey[])
    assert.ok(!phaseStepIds(phase).includes(id), 'Phase ' + phase + ' does not');
  open({ calculated: phaseOnePlan(), phase: '3', state: { checks: ticked(['1', '2'], [id]) } });
  assert.equal(phaseToOpen(), '1', 'its open check holds Phase 1 open');
  open({ calculated: phaseOnePlan(), phase: '3', state: { checks: ticked(['1', '2']) } });
  assert.equal(phaseToOpen(), '3');
});

test('a milestone ticked while a later phase listed it shows ticked in its own phase', async () => {
  const id = caterium();
  open({ calculated: phaseOnePlan(), phase: '1', state: { checks: { [id]: true } } });
  setQuery('');
  setHideDone(false);
  go('plan');
  render();
  await nextTick();
  const box = $(`#main input[data-check="${id}"]`) as HTMLInputElement | null;
  assert.ok(box, 'the Phase 1 build plan shows the step');
  assert.equal(box.checked, true);
});
