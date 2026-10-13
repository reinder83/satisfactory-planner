// The hand-fed constructors' step waits for the MAM research Production Amplifier (#1150): a
// Phase 1 profile's build plan lists "Park somersloops in the hand-fed constructors" in Phase 3,
// after the research step, and says from when machines take somersloops, as an amplified line's
// step does (#1056). A tick on it, made while an older release listed it in Phase 1, shows in
// Phase 3.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

const STEP = 'sloop-hand-fed';
const RESEARCH = 'unlock-Research_Alien_ProductionBooster_C';
let plan: CurrentCalculatedPlan | undefined;
const phaseOne = () =>
  structuredClone(
    (plan ??= generatedWith({
      phase: '1',
      goal: 'minimal',
      somersloops: 2,
      sloopReserved: ['shards'],
    })),
  );
const words = (element: Element | null | undefined) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();
const box = (id: string) => $<HTMLInputElement>(`#main [data-check="${id}"]`);
const step = (id: string) => box(id)?.closest<HTMLElement>('.task');

beforeEach(() => page());

async function show(phase: Phase, checks: Record<string, boolean> = {}) {
  page();
  open({ calculated: phaseOne(), phase, state: { checks } });
  setQuery('');
  setHideDone(false);
  go('plan');
  render();
  await nextTick();
}

test('Phase 1’s build plan has no hand-fed step; Phase 3’s has it after the research', async () => {
  for (const phase of ['1', '2'] as const) {
    await show(phase);
    assert.equal(step(STEP), undefined, `Phase ${phase} does not list the step`);
    assert.equal(step(RESEARCH), undefined, `Phase ${phase} does not list the research`);
  }
  await show('3');
  const research = step(RESEARCH),
    handFed = step(STEP);
  assert.ok(research, 'Phase 3 lists the research');
  assert.match(words(research), /MAM: Production Amplifier/);
  assert.ok(handFed, 'Phase 3 lists the hand-fed step');
  assert.match(words(handFed), /Park somersloops in the hand-fed constructors/);
  assert.match(
    words(handFed),
    /Machines take somersloops once the MAM research Production Amplifier is done, from Phase 3 on\. Insert the Somersloop in the Constructor/,
  );
  assert.ok(
    research.compareDocumentPosition(handFed) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the research comes first',
  );
});

test('a tick on the hand-fed step shows in Phase 3', async () => {
  await show('3', { [STEP]: true });
  assert.equal(box(STEP)?.checked, true);
  await show('1', { [STEP]: true });
  assert.equal(step(STEP), undefined);
});
