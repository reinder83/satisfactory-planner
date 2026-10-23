// The caps per phase (#1221) in the interface: All settings step 3 (ui/wizard/PhaseCaps.vue in
// GoalStep.vue) has two boxes under what the plan keeps lowest, blank for no cap; the draft keeps
// what is typed as numbers (and leaves the field out when both are blank, as settings() stores
// it), and the sidebar footer names the caps a plan was calculated with, so a plan never changes
// them by itself.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setView, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const box = (name: string) => $<HTMLInputElement>(`input[name="phaseCap:${name}"]`)!;

// Step 3 of the five steps, as "All settings" leaves it, from `settings`.
function goalStep(settings: CurrentCalculatedPlan['settings']) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 3,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(settings),
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

async function pressContinue() {
  $<HTMLFormElement>('#wizard-form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await settle();
}

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts).
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('step 3 has two blank cap boxes under the objective, and the draft keeps what is typed', async () => {
  goalStep(generated().settings);
  const fieldset = $('[data-phase-caps]')!;
  assert.match(fieldset.querySelector('legend')!.textContent!, /^Caps per phase/);
  assert.ok(
    $('[data-objective]')!.compareDocumentPosition(fieldset) & Node.DOCUMENT_POSITION_FOLLOWING,
    'under what the plan keeps lowest',
  );
  assert.deepEqual(
    ['buildings', 'mw'].map(name => [
      box(name).closest('label')!.textContent!.trim(),
      box(name).value,
      box(name).placeholder,
      box(name).min,
      box(name).max,
      box(name).step,
    ]),
    [
      ['At most this many buildings per phase', '', 'No cap', '1', '100000', '1'],
      ['At most this many MW per phase', '', 'No cap', '1', '10000000', '1'],
    ],
  );
  box('mw').value = '250';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.deepEqual(wizard!.settings.phaseCaps, { mw: 250 });
});

test('a draft shows its caps, and blank boxes leave the field out again', async () => {
  goalStep({ ...generated().settings, phaseCaps: { buildings: 120, mw: 250 } });
  assert.deepEqual([box('buildings').value, box('mw').value], ['120', '250']);
  box('buildings').value = '';
  box('mw').value = '';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal('phaseCaps' in wizard!.settings, false);
});

test('the sidebar names the caps a plan was calculated with, only when it has one', () => {
  const footer = () => $('.sidebar-foot .profile-switcher')!.textContent!;
  for (const [caps, shown] of [
    [undefined, null],
    [{ mw: 2500 }, 'Caps: at most 2,500 MW per phase'],
    [{ buildings: 120, mw: 250 }, 'Caps: at most 120 buildings and 250 MW per phase'],
  ] as const) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    if (caps !== undefined) plan.settings.phaseCaps = { ...caps };
    open({ calculated: plan });
    render();
    if (shown) assert.ok(footer().includes(shown), footer());
    else assert.doesNotMatch(footer(), /Caps:/);
  }
});

test('a draft a cap blocks is headed as a cap, not a budget', async () => {
  const { draftHeading } = await import('../../public/app/views/calculated.ts');
  const capped = {
    feasible: false,
    minHours: 10.5,
    capShortfalls: [{ name: 'mw' as const, needed: 856, cap: 700 }],
  };
  assert.equal(draftHeading(capped), 'Planning draft — cap exceeded.');
  assert.equal(draftHeading(capped, '3'), 'Phase 3 — cap exceeded:');
  const both = { ...capped, shortfalls: [{ name: 'Coal', needed: 900, budget: 600 }] };
  assert.equal(draftHeading(both), 'Planning draft — budget exceeded.');
  assert.equal(
    draftHeading({ feasible: false, minHours: 10.5 }),
    'Planning draft — budget exceeded.',
  );
});
