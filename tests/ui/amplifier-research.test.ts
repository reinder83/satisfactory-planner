// Production amplification waits for the MAM research Production Amplifier (#1056), from Phase 3.
// The build plan lists the research's step in Phase 3 and an amplified line's step says when its
// machines take somersloops; the ledger on All settings step 2 says from which phase amplification
// is planned. A plan stored before keeps its Phase 1-2 amplified lines and its numbers, and its
// plan, factories and resources pages say so, with Edit settings to recalculate it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { setHideDone, setQuery, setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type { WizardDraft } from '../../public/app/wizard/wizard.ts';
import type { CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

const STEP = 'unlock-Research_Alien_ProductionBooster_C';
// A plan stored by the release before #1056: Phase 1 start, 40 somersloops for amplification,
// 2 amplified lines in Phase 1 and 5 in Phase 2 (tests/amplifier-research.test.ts).
const stored = (): CurrentCalculatedPlan =>
  JSON.parse(fs.readFileSync('tests/fixtures/amplified-early-2026-10-12.json', 'utf8'));
let fresh: CurrentCalculatedPlan | undefined;
// The same settings calculated now.
const calculatedNow = () =>
  structuredClone(
    (fresh ??= generatedWith({
      phase: '1',
      wholeMachines: false,
      recipes: 'standard',
      somersloops: 106,
      amplifySloops: 40,
    })),
  );
const words = (element: Element | null | undefined) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();
const step = (id: string) => $(`#main [data-check="${id}"]`)?.closest<HTMLElement>('.task');

beforeEach(() => page());

async function show(plan: CurrentCalculatedPlan, phase: Phase, view = 'plan' as const) {
  page();
  open({ calculated: plan, phase, workspace: { catalog: catalog() } });
  setQuery('');
  setHideDone(false);
  go(view);
  render();
  await nextTick();
}

test('Phase 3’s build plan lists the research, and an amplified line says when it can start', async () => {
  const plan = calculatedNow();
  await show(plan, '3');
  const research = step(STEP);
  assert.ok(research, 'the research step is listed');
  assert.match(words(research), /MAM: Production Amplifier/);
  const amplified = (plan.stages['3']!.rows || []).find(row => row.amplified)!;
  assert.match(
    words(step(`calc-3-${amplified.id}`)),
    /Machines take somersloops once the MAM research Production Amplifier is done, from Phase 3 on\./,
  );
  // Phase 2 has no amplified lines and no research step.
  await show(plan, '2');
  assert.equal(step(STEP), undefined);
  assert.equal((plan.stages['2']!.rows || []).filter(row => row.amplified).length, 0);
  assert.equal($('[data-amp-early]'), null, 'a plan calculated now has no warning');
});

test('a stored plan amplified before the research keeps its numbers, with a warning', async () => {
  for (const view of ['plan', 'factories', 'resources'] as const) {
    const plan = stored();
    const before = structuredClone(plan);
    page();
    open({ calculated: plan, phase: '2' });
    go(view);
    render();
    await nextTick();
    const notice = $('[data-amp-early]');
    assert.ok(notice, `${view}: the warning is shown`);
    assert.ok(notice.classList.contains('warn'));
    assert.equal(
      words(notice),
      'Amplified before the research. Phases 1 and 2 of this plan have 7 amplified lines, but machines take somersloops only after the MAM research Production Amplifier, whose SAM Fluctuators and Circuit Boards first come in Phase 3. The plan was calculated before amplification waited for that research, so it keeps its numbers. Recalculate it in place to plan those phases without amplification. Recalculate in Edit settings →',
    );
    assert.deepEqual(plan, before, `${view}: the plan is not changed`);
  }
  // Its Phase 2 lines are still there, each with its own step.
  const plan = stored();
  await show(plan, '2');
  const twin = (plan.stages['2']!.rows || []).find(row => row.amplified)!;
  assert.ok(step(`calc-2-${twin.id}`), 'the amplified Phase 2 line keeps its step');
});

test('the ledger says from which phase amplification is planned', async () => {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 2,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), somersloops: 106, amplifySloops: 20 },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  } as WizardDraft);
  go('wizard');
  render();
  await nextTick();
  assert.equal(
    words($('[data-amp-from]')),
    'Amplification starts in Phase 3: machines take somersloops only after the MAM research Production Amplifier, which needs SAM Fluctuators and Circuit Boards, so earlier phases are planned without it.',
  );
});
