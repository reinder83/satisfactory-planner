// The guided start's "What you already have" (#1068, ui/guided/GuidedHave.vue): right after the
// phase of a new save that starts after Phase 1, one optional screen with Review's "Everything
// before Phase N is done", All settings step 4's miner and belt you already have and step 2's
// alternates you already own. Its answers land in the same draft and settings fields as those
// screens', so Review shows them as for All settings, and left as it is it changes nothing.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { progressionData, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { alternateHunts, stepsBeforeStart } from '../../public/progression.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, evil, generated, generatedWith, go, open, page, stubFetch } from './setup.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';

// A hard-drive alternate available from Phase 2 that a Phase 3 plan uses when it may.
const SCREW = 'Recipe_Alternate_Screw_2_C';
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const options = (selector: string) =>
  $$<HTMLOptionElement>(selector + ' option').map(option => option.value);

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  HTMLFormElement.prototype.reportValidity = () => true;
});

// A new save's guided start at question `id` (or step `guidedStep`), as freshSettings starts one:
// mining per phase on.
function guidedAt(
  where: string | number,
  settings: Partial<WizardSettings> = {},
  extra: Partial<WizardDraft> = {},
) {
  const draft = (guidedStep: number): WizardDraft => ({
    step: 1,
    saveId: null,
    saveName: evil,
    name: '',
    settings: { ...structuredClone(generated().settings), phaseMining: true, ...settings },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'guided',
    guidedStep,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  page();
  setWizard(draft(1));
  const step = typeof where === 'number' ? where : guidedFlow().findIndex(q => q.id === where) + 1;
  assert.ok(step > 0, `${where} is asked`);
  page();
  setWizard(draft(step));
  go('wizard');
  render();
}
const submit = async () => {
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
};
const choose = async (selector: string, value: string | boolean) => {
  const el = $<HTMLInputElement>(selector);
  assert.ok(el, selector + ' is on screen');
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};

test('a Phase 3 start is asked what it already has right after its phase; Phase 1 is not', async () => {
  guidedAt(1, { phase: '3' });
  assert.deepEqual(
    guidedFlow().map(q => q.id),
    ['phase', 'have', 'supply', 'goal', 'recipes', 'stock', 'exact', 'power'],
  );
  await submit();
  assert.equal(wizard!.guidedStep, 2);
  assert.ok($('[data-guided-have]'), 'the screen follows the phase');
  assert.match(text('#main h2'), /^Step 2 of 9: What do you already have\?$/);
  assert.match(text('#main'), /Phase 3 does not send you to unlock it again/);
  assert.equal(text('.guided-progress .current .guided-step-label'), 'What you have');
  assert.equal($('[data-guided-advanced]')!.dataset.guidedAdvanced, '2');
  assert.equal($('x-evil'), null);
  // Everything starts off, with None chosen.
  assert.equal($<HTMLInputElement>('input[name=earlierDone]')!.checked, false);
  assert.match(text('[data-guided-have] .check-row'), /^Everything before Phase 3 is done/);
  assert.match(text('[data-guided-have] .check-row'), /Phases 1 and 2 list start ticked/);
  assert.equal($<HTMLSelectElement>('select[name=ownedMiner]')!.value, '');
  assert.equal($<HTMLSelectElement>('select[name=ownedBelt]')!.value, '');
  assert.equal($$('input[name=ownedAlt]:checked').length, 0);
  assert.equal($<HTMLDetailsElement>('[data-owned-alt-picker]')!.open, false, 'folded');
  // Only the marks better than Phase 3's own (Miner Mk.2, Mk.4 belts) are offered.
  assert.deepEqual(options('select[name=ownedMiner]'), ['', '3']);
  assert.deepEqual(options('select[name=ownedBelt]'), ['', '5', '6']);
  assert.match(text('select[name=ownedMiner] option'), /^None beyond what each phase unlocks$/);

  // A Phase 1 start goes from its phase to the HUB tutorial, as before.
  guidedAt(1, { phase: '1' });
  assert.deepEqual(
    guidedFlow().map(q => q.id),
    ['phase', 'tutorial', 'goal', 'recipes', 'stock', 'exact', 'power'],
  );
  await submit();
  assert.equal(guidedFlow()[wizard!.guidedStep - 1]!.id, 'tutorial');
  assert.equal($('[data-guided-have]'), null);
  // Choosing Phase 1 on the phase screen drops the question again.
  guidedAt(1, { phase: '3' });
  await choose('input[name="guided:phase"][value="1"]', true);
  assert.equal(
    guidedFlow().some(q => q.id === 'have'),
    false,
  );
  // A save that already has profiles keeps the source profile's settings and asks what changed.
  guidedAt(1, { phase: '3' }, { saveId: 's1', guidedAsk: ['phase'] });
  assert.deepEqual(
    guidedFlow().map(q => q.id),
    ['phase'],
  );
});

test('the choices offered follow the start phase', () => {
  guidedAt('have', { phase: '2' });
  assert.deepEqual(options('select[name=ownedMiner]'), ['', '3']);
  assert.deepEqual(options('select[name=ownedBelt]'), ['', '4', '5', '6']);
  assert.match(text('[data-guided-have] .check-row'), /Phase 1 list start ticked/);
  guidedAt('have', { phase: '4' });
  assert.equal($('select[name=ownedMiner]'), null, 'Phase 4 already mines with Mk.3');
  assert.deepEqual(options('select[name=ownedBelt]'), ['', '6']);
  guidedAt('have', { phase: '5' });
  assert.equal($('select[name=ownedMiner]'), null);
  assert.equal($('select[name=ownedBelt]'), null);
  assert.match(text('[data-guided-have]'), /Phase 5 already plans with Miner Mk\.3 and Mk\.6 belts/);
  // A mark already chosen stays listed (a draft from All settings step 4).
  guidedAt('have', { phase: '4', ownedMiner: 2 });
  assert.deepEqual(options('select[name=ownedMiner]'), ['', '2']);
  assert.equal($<HTMLSelectElement>('select[name=ownedMiner]')!.value, '2');
});

test('the answers reach the settings and Review’s ticks, as All settings’ do', async () => {
  guidedAt('have', { phase: '3' });
  await choose('input[name=earlierDone]', true);
  await choose('select[name=ownedMiner]', '3');
  await choose('select[name=ownedBelt]', '5');
  await choose(`input[name=ownedAlt][value="${SCREW}"]`, true);
  await submit();
  assert.equal(guidedFlow()[wizard!.guidedStep - 1]!.id, 'supply', 'on to the next question');
  const settings = wizard!.settings;
  assert.equal(settings.ownedMiner, 3);
  assert.equal(settings.ownedBelt, 5);
  assert.deepEqual(settings.ownedAlternates, [SCREW]);
  assert.equal(wizard!.earlierDone, true);
  // Back shows them as chosen.
  $<HTMLButtonElement>('[data-guided-back]')!.click();
  await settle();
  assert.equal($<HTMLInputElement>('input[name=earlierDone]')!.checked, true);
  assert.equal($<HTMLSelectElement>('select[name=ownedMiner]')!.value, '3');
  assert.equal($<HTMLSelectElement>('select[name=ownedBelt]')!.value, '5');
  assert.equal($<HTMLInputElement>(`input[name=ownedAlt][value="${SCREW}"]`)!.checked, true);
  assert.equal($<HTMLDetailsElement>('[data-owned-alt-picker]')!.open, true, 'open when owned');
  // All settings keeps them where it shows them: step 2's picker, step 4's selects.
  $<HTMLButtonElement>('[data-guided-advanced]')!.click();
  await settle();
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 2);
  assert.equal($<HTMLInputElement>(`input[name=ownedAlt][value="${SCREW}"]`)!.checked, true);
  $<HTMLButtonElement>('[data-wizard-step="4"]')!.click();
  await settle();
  assert.equal($<HTMLSelectElement>('select[name=ownedMiner]')!.value, '3');
  assert.equal($<HTMLSelectElement>('select[name=ownedBelt]')!.value, '5');

  // The guided Review, with the plan calculated from those settings.
  const plan: StoredCalculatedPlan = generatedWith({
    phase: '3',
    phaseMining: true,
    ownedMiner: 3,
    ownedBelt: 5,
    ownedAlternates: [SCREW],
  });
  guidedAt(
    'power',
    { phase: '3', ownedMiner: 3, ownedBelt: 5, ownedAlternates: [SCREW] },
    { earlierDone: true },
  );
  const calls = stubFetch<{ settings: WizardSettings; built: string[] }>({
    '/api/preview': plan,
  });
  await submit();
  assert.equal(calls[0]![0], '/api/preview');
  assert.equal(calls[0]![1].settings.ownedMiner, 3);
  assert.equal(calls[0]![1].settings.ownedBelt, 5);
  assert.deepEqual(calls[0]![1].settings.ownedAlternates, [SCREW]);
  assert.ok($('[data-already-have]'), 'Review shows what you already have');
  assert.equal($<HTMLInputElement>('input[data-earlier-done]')!.checked, true);
  const screw = $<HTMLInputElement>(`input[data-owned-alternate][value="recipe-unlock-${SCREW}"]`);
  assert.ok(screw, 'the owned recipe is among the plan’s hunts');
  assert.equal(screw.checked, true);
  assert.equal(screw.disabled, true, 'owned, set as on step 2');
  assert.match(text('[data-already-have]'), /owned, set on step 2/);
  // Create sends the same settings and the steps they tick.
  const created = stubFetch<{ settings: WizardSettings; built: string[] }>({
    '/api/profiles': { workspace: {}, saveId: 's', profileId: 'p', carriedChecks: 0 },
    '/api/context': { error: 'not needed' },
  });
  await submit();
  const body = created.find(([path]) => path === '/api/profiles')![1];
  assert.equal(body.settings.ownedMiner, 3);
  assert.equal(body.settings.ownedBelt, 5);
  assert.deepEqual(body.settings.ownedAlternates, [SCREW]);
  const before = stepsBeforeStart(plan, { checks: {} }, progressionData);
  assert.ok(before.length >= 16);
  for (const key of [...before, `recipe-unlock-${SCREW}`])
    assert.ok(body.built.includes(key), key);
  const hunt = alternateHunts(plan, progressionData).find(entry =>
    entry.recipes.some(recipe => recipe.key === `recipe-unlock-${SCREW}`),
  )!;
  assert.equal(
    body.built.includes(hunt.hunt),
    hunt.recipes.length === 1,
    'a hunt only once all of it is owned',
  );
});

test('left as it is, the screen changes nothing: every field stays absent', async () => {
  guidedAt('have', { phase: '3' });
  const before = structuredClone(wizard!.settings);
  assert.equal('ownedMiner' in before || 'ownedBelt' in before || 'ownedAlternates' in before, false);
  await submit();
  assert.equal(guidedFlow()[wizard!.guidedStep - 1]!.id, 'supply');
  assert.deepEqual(wizard!.settings, before, 'the same settings as before the screen');
  assert.ok(!wizard!.earlierDone);
  // Choosing and then going back to None removes the fields again.
  $<HTMLButtonElement>('[data-guided-back]')!.click();
  await settle();
  await choose('select[name=ownedMiner]', '3');
  await choose(`input[name=ownedAlt][value="${SCREW}"]`, true);
  await submit();
  assert.equal(wizard!.settings.ownedMiner, 3);
  $<HTMLButtonElement>('[data-guided-back]')!.click();
  await settle();
  await choose('select[name=ownedMiner]', '');
  await choose(`input[name=ownedAlt][value="${SCREW}"]`, false);
  await submit();
  assert.deepEqual(wizard!.settings, before);
  // And Create sends no finished work.
  guidedAt('power', { phase: '3' });
  const plan = generated();
  stubFetch({ '/api/preview': plan });
  await submit();
  assert.equal($<HTMLInputElement>('input[data-earlier-done]')!.checked, false);
  const created = stubFetch<{ settings: WizardSettings; built: string[] }>({
    '/api/profiles': { workspace: {}, saveId: 's', profileId: 'p', carriedChecks: 0 },
    '/api/context': { error: 'not needed' },
  });
  await submit();
  const body = created.find(([path]) => path === '/api/profiles')![1];
  assert.deepEqual(body.built, []);
  for (const field of ['ownedMiner', 'ownedBelt', 'ownedAlternates'])
    assert.equal(field in body.settings, false, field);
});

test('without per-phase mining it offers no miner or belt and keeps none, as step 4 does', async () => {
  guidedAt('have', { phase: '3', phaseMining: false });
  assert.equal($('select[name=ownedMiner]'), null);
  assert.equal($('select[name=ownedBelt]'), null);
  assert.match(text('[data-guided-have-mining]'), /All settings, step 4/);
  assert.ok($('[data-owned-alt-picker]'), 'the alternates are still offered');
  await choose(`input[name=ownedAlt][value="${SCREW}"]`, true);
  await submit();
  assert.deepEqual(wizard!.settings.ownedAlternates, [SCREW]);
  assert.equal('ownedMiner' in wizard!.settings, false);
  assert.equal(wizard!.settings.phaseMining, false, 'never turned on behind your back');
});
