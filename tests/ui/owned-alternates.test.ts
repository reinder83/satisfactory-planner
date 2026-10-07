// "Alternates you already own" (#1068) in the wizard: All settings step 2 lists every hard-drive
// alternate the game has (ui/wizard/OwnedAlternates.vue), read back as settings.ownedAlternates;
// Review's "What you already have" then shows the ones the plan uses ticked and fixed, and the new
// profile starts with their unlock steps (and an emptied hunt) ticked.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { setWizard, workspace, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { readWizard, type WizardDraft } from '../../public/app/wizard/wizard.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page, stubFetch } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const SCREW = 'Recipe_Alternate_Screw_2_C';
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  HTMLFormElement.prototype.reportValidity = () => true;
});

function wizardAt(step: number, plan: CurrentCalculatedPlan, extra: Partial<WizardDraft> = {}) {
  page();
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(plan.settings),
    preview: step === 5 ? plan : null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  go('wizard');
  render();
}

test('step 2 lists the hard-drive alternates up to the start phase, and reads the ticks', async () => {
  wizardAt(2, generated());
  await settle();
  const picker = $('[data-owned-alt-picker]')!;
  assert.ok(picker, 'offered under Standard recipes');
  assert.equal(picker.hasAttribute('open'), false, 'folded while none is owned');
  assert.match(text(picker), /Alternates you already own · 0 ticked/);
  const hardDrive = workspace.catalog.alternates.filter(alt => !alt.mam && !alt.milestone);
  const boxes = $$<HTMLInputElement>('input[data-owned-alt]');
  assert.equal(boxes.length, hardDrive.length, 'one box per hard-drive alternate');
  const row = (id: string) => boxes.find(box => box.value === id)!.closest('.owned-alt-row')!;
  const later = hardDrive.find(alt => alt.phase > 3)!;
  assert.equal(row(later.id).hasAttribute('hidden'), true, 'a later phase is folded away');
  assert.equal(row(SCREW).hasAttribute('hidden'), false);
  $<HTMLInputElement>('input[data-owned-alt-later]')!.click();
  await settle();
  assert.equal(row(later.id).hasAttribute('hidden'), false, 'shown on request');
  const box = boxes.find(candidate => candidate.value === SCREW)!;
  box.click();
  await settle();
  assert.match(text(picker), /· 1 ticked/);
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.deepEqual(wizard!.settings.ownedAlternates, [SCREW]);
  box.click();
  await settle();
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal('ownedAlternates' in wizard!.settings, false, 'none owned leaves the field out');
});

test('under Standard recipes the owned list leaves the picked alternates alone', async () => {
  // A Standard profile can still carry picks from when it was custom: the owned list is not the
  // custom picker, so reading step 2 neither clears nor replaces them.
  const plan = generated();
  const RIP = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
  const settings = { ...structuredClone(plan.settings), alternateRecipes: [RIP] };
  settings.preferredRecipes = [RIP];
  wizardAt(2, plan, { settings });
  await settle();
  assert.equal($('.alt-picker'), null, 'Standard shows no custom picker');
  assert.equal($('.alt-list'), null);
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.deepEqual(wizard!.settings.alternateRecipes, [RIP]);
  assert.deepEqual(wizard!.settings.preferredRecipes, [RIP]);
});

test('step 2 opens on the owned alternates of a draft that has them', async () => {
  const plan = generated();
  wizardAt(2, plan, { settings: { ...structuredClone(plan.settings), ownedAlternates: [SCREW] } });
  await settle();
  assert.equal($('[data-owned-alt-picker]')!.hasAttribute('open'), true);
  const ticked = $$<HTMLInputElement>('input[data-owned-alt]').filter(box => box.checked);
  assert.deepEqual(
    ticked.map(box => box.value),
    [SCREW],
  );
});

test('Review shows a step-2 alternate the plan uses as owned, and its steps start ticked', async () => {
  const plan = generatedWith({ phase: '3', ownedAlternates: [SCREW] });
  wizardAt(5, plan);
  await settle();
  const boxes = $$<HTMLInputElement>('input[data-owned-alternate]');
  const box = boxes.find(candidate => candidate.value === 'recipe-unlock-' + SCREW)!;
  assert.ok(box, 'the plan hunts for it');
  assert.equal(box.checked, true);
  assert.equal(box.disabled, true, 'changed on step 2, not here');
  assert.match(text(box.closest('label')), /owned, set on step 2/);
  const calls = stubFetch<{ built: string[] }>({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p3', carriedChecks: 2 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Third' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan,
    },
  });
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const body = calls.find(([path]) => path === '/api/profiles')![1];
  // The only alternate the plan uses is owned, so its phase's hunt is over too.
  assert.ok(body.built.includes('recipe-unlock-' + SCREW));
  assert.ok(body.built.some(key => /^hard-drives-[1-5]$/.test(key)));
});
