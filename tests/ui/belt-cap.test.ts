// The belt cap (#1232) in the interface: All settings step 3 has "Best belt the plan may use" in
// the caps fieldset (ui/wizard/PhaseCaps.vue), "No cap" by default; the draft keeps the mark chosen
// as a number and leaves the field out for "No cap", as settings() stores it. A plan calculated
// with a cap names it in the sidebar footer, its belt advice (bestLane) never counts a better belt
// and says the cap is why, and ADA does not mistake the lower belt for one the player owns.
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { beforeAll, beforeEach, test } from 'vitest';
import { bestLane, lanePlan, laneUnlockNote } from '../../public/app/flow.ts';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import LaneAdvice from '../../public/app/ui/detail/LaneAdvice.vue';
import { setView, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type { FlowModel } from '../../public/app/flow.ts';
import type { CurrentCalculatedPlan, StoredCalculatedPlan } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const select = () => $<HTMLSelectElement>('select[name="beltCap"]')!;
const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();

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

// A plan with mining per phase from Phase 2, and the same with a Mk.4 belt cap.
let mined: StoredCalculatedPlan, capped: StoredCalculatedPlan;
beforeAll(() => {
  mined = generatedWith({ phase: '2', phaseMining: true });
  capped = generatedWith({ phase: '2', phaseMining: true, beltCap: 4 });
});
beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts).
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('step 3 has the belt cap in the caps fieldset, and the draft keeps the mark chosen', async () => {
  goalStep(generated().settings);
  const field = select();
  assert.ok(field.closest('[data-phase-caps]'), 'in the caps fieldset');
  assert.ok(field.hasAttribute('data-belt-cap'));
  assert.match(plain(field.closest('label')!.textContent), /^Best belt the plan may use/);
  assert.deepEqual(
    [...field.options].map(option => [option.value, plain(option.textContent)]),
    [
      ['', 'No cap'],
      ['2', 'Mk.2 belts (120/min)'],
      ['3', 'Mk.3 belts (270/min)'],
      ['4', 'Mk.4 belts (480/min)'],
      ['5', 'Mk.5 belts (780/min)'],
    ],
  );
  assert.equal(field.value, '', 'no cap by default');
  field.value = '4';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal(wizard!.settings.beltCap, 4);
});

test('a draft shows its belt cap, and "No cap" leaves the field out again', async () => {
  goalStep({ ...generated().settings, beltCap: 3 });
  assert.equal(select().value, '3');
  select().value = '';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal('beltCap' in wizard!.settings, false);
});

test('the sidebar names the belt cap a plan was calculated with, beside the caps per phase', () => {
  const footer = () => plain($('.sidebar-foot .profile-switcher')!.textContent);
  for (const [extra, shown] of [
    [{}, null],
    [{ beltCap: 4 }, 'Caps: belts up to Mk.4 (480/min)'],
    [
      { beltCap: 3, phaseCaps: { buildings: 120 } },
      'Caps: at most 120 buildings per phase; belts up to Mk.3 (270/min)',
    ],
  ] as const) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    Object.assign(plan.settings, structuredClone(extra));
    open({ calculated: plan });
    render();
    if (shown) assert.ok(footer().includes(shown), footer());
    else assert.doesNotMatch(footer(), /Caps:/);
  }
});

test('the belt advice never counts a belt above the cap, and says the cap is why', () => {
  const withSettings = (extra: object) => {
    const plan = structuredClone(capped);
    Object.assign(plan.settings, extra);
    return plan;
  };
  open({ calculated: withSettings({}), phase: '4' });
  const belts = bestLane(false, '4');
  assert.equal(belts.mark, 'Mk.4');
  assert.equal(belts.capped, true);
  assert.equal(belts.next, null, 'no upgrade offered past the cap');
  // The capped belt still needs its own milestone ticked, as a phase's own belt does.
  assert.equal(
    laneUnlockNote(belts),
    'Mk.4 belts need Tier 5 · Logistics Mk.4, which is not ticked yet: until then, plan with Mk.3 belts (270/min).',
  );
  assert.equal(bestLane(true, '4').mark, 'Mk.2', 'pipes as before');
  assert.equal('capped' in bestLane(true, '4'), false);
  // A phase the cap does not lower: as before, with no upgrade past the cap.
  const early = bestLane(false, '2');
  assert.equal(early.mark, 'Mk.3');
  assert.equal('capped' in early, false);
  assert.equal(early.next?.mark, 'Mk.4');
  assert.equal(bestLane(false, '3').next, null, 'Mk.4 is the cap');
  // An owned belt above the cap is held to it too.
  open({ calculated: withSettings({ ownedBelt: 6 }), phase: '2' });
  assert.equal(bestLane(false, '2').mark, 'Mk.4');
  assert.equal(bestLane(false, '2').owned, true);
  // The factory dialog's "Belts & pipes" says the cap is why.
  open({ calculated: withSettings({}), phase: '4' });
  const model: FlowModel = {
    stage: '4',
    equivalent: 4,
    machineCount: 4,
    inputs: [{ name: 'Iron Ore', rate: 900, link: null, plan: lanePlan(900, false, '4') }],
    outputs: [],
    machineName: '',
    recipe: null,
    bar: null,
    sameItemConsumers: () => [],
  };
  const dialog = document.createElement('div');
  createApp({ render: () => h(LaneAdvice, { model }) }).mount(dialog);
  assert.match(
    plain(dialog.querySelector('p')?.textContent),
    /^Phase 4 plans with Mk\.4 belts \(480\/min\), the best your belt cap allows, and Mk\.2 pipes \(600 m³\/min\)\./,
  );
  assert.match(plain(dialog.querySelector('.logi-row')?.textContent), /2 × Mk\.4 belts/);
  // Milestones ticked out of order (#1020): Mk.5's ticked in Phase 2 while the cap's Mk.4 is
  // neither ticked nor due. The best belt is Mk.3, below the cap, so the cap is not why, and
  // Mk.4 is still the next belt up.
  open({
    calculated: withSettings({}),
    phase: '2',
    state: { checks: { 'unlock-Schematic_7-2_C': true } },
  });
  const early2 = bestLane(false, '2');
  assert.equal(early2.mark, 'Mk.3');
  assert.equal('capped' in early2, false);
  assert.equal(early2.next?.mark, 'Mk.4');
  // Without a cap the plan advises as before.
  open({ calculated: structuredClone(mined), phase: '4' });
  assert.equal(bestLane(false, '4').mark, 'Mk.5');
  assert.equal('capped' in bestLane(false, '4'), false);
});

test('ADA does not mistake a capped belt for one the player already has', () => {
  const adaLine = (plan: StoredCalculatedPlan) => {
    page();
    open({ calculated: plan, phase: '4' });
    go('resources');
    adaClearFault();
    for (let i = 0; i < 60; i++) {
      setAdaIndex(i);
      const line = adaCurrent();
      if (line?.id === 'owned-belt') return line.text;
    }
    return undefined;
  };
  assert.equal(capped.stages['4'].mining!.belt.mark, 'Mk.4');
  assert.equal(adaLine(structuredClone(capped)), undefined);
});
