// "Generators you already have" (#1068, ui/wizard/OwnedGenerators.vue, settings.ownedGenerators):
// a count per kind of generator the start phase has unlocked, under All settings step 4's budgets
// and on the guided start's "What you already have". The counts are read into the settings, an
// empty or zero field is left out, and none leaves the setting out. On the pages, a plan with them
// names them in the generator line's build-plan step, the Resources page's bar and ADA.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { readWizard } from '../../public/app/wizard/wizard.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, evil, generated, generatedWith, go, open, page } from './setup.ts';
import type { Catalog, CurrentCalculatedPlan } from '../../public/types/index.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';

// The numbers read as in en-US, whatever the machine's locale.
const toLocale = Number.prototype.toLocaleString;
beforeAll(() => {
  Number.prototype.toLocaleString = function (
    this: number,
    _locale?: unknown,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocale.call(this, 'en-US', options);
  };
});
afterAll(() => {
  Number.prototype.toLocaleString = toLocale;
});

let items: Catalog;
beforeEach(() => {
  items ??= catalog();
  page();
  HTMLFormElement.prototype.reportValidity = () => true;
});
const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
// The kinds on screen, as their fields name them.
const kinds = () =>
  $$<HTMLInputElement>('[data-owned-generators] input').map(input => input.dataset.ownedGenerator);
const field = (machine: string) => $<HTMLInputElement>(`input[name="ownedGenerator:${machine}"]`)!;

function draftAt(
  step: number,
  settings: Partial<WizardSettings> = {},
  extra: Partial<WizardDraft> = {},
) {
  setWizard({
    step,
    saveId: null,
    saveName: evil,
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: null,
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
  return wizard!;
}

test('step 4 asks for the generators the start phase has unlocked, and reads the counts', () => {
  open({ workspace: { catalog: items } });
  draftAt(4, { phase: '2' });
  assert.ok($('[data-owned-generators]'), 'on the budgets step');
  assert.equal(plain($('[data-owned-generators] h3')?.textContent), 'Generators you already have');
  assert.match(
    plain($('[data-owned-generators] p')?.textContent),
    /^Each phase counts these among the generators it runs where it plans that kind, so you build only the rest\. They still burn fuel from your resource budgets\./,
  );
  assert.deepEqual(kinds(), ['Biomass Burner', 'Coal Generator']);
  assert.deepEqual(
    $$('[data-owned-generators] label').map(label => plain(label.textContent)),
    ['Biomass Burners 30 MW each', 'Coal Generators 75 MW each'],
  );
  assert.equal(field('Coal Generator').value, '', 'empty by default');
  assert.equal($('x-evil'), null);
  // Read with the form: a count becomes the setting, an empty or zero field is left out.
  field('Coal Generator').value = '8';
  field('Biomass Burner').value = '0';
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.deepEqual(wizard!.settings.ownedGenerators, { 'Coal Generator': 8 });
  field('Coal Generator').value = '';
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal('ownedGenerators' in wizard!.settings, false, 'none leaves the field out');
  // A fraction is not a count.
  field('Coal Generator').value = '2.5';
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal('ownedGenerators' in wizard!.settings, false);
  // Other steps leave the counts alone.
  page();
  open({ workspace: { catalog: items } });
  draftAt(3, { phase: '2', ownedGenerators: { 'Coal Generator': 8 } });
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.deepEqual(wizard!.settings.ownedGenerators, { 'Coal Generator': 8 });
});

test('every kind from Phase 4, and a count the start phase has not unlocked stays listed', () => {
  open({ workspace: { catalog: items } });
  draftAt(4, { phase: '4' });
  assert.deepEqual(kinds(), [
    'Biomass Burner',
    'Coal Generator',
    'Fuel Generator',
    'Nuclear Power Plant',
  ]);
  page();
  open({ workspace: { catalog: items } });
  draftAt(4, { phase: '1', ownedGenerators: { 'Fuel Generator': 3 } });
  assert.deepEqual(kinds(), ['Biomass Burner', 'Fuel Generator']);
  assert.equal(field('Fuel Generator').value, '3', 'a draft from a profile shows its counts');
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.deepEqual(wizard!.settings.ownedGenerators, { 'Fuel Generator': 3 });
  // Per-phase mining off: the counts are asked all the same, since their fuel is in the budgets.
  page();
  open({ workspace: { catalog: items } });
  draftAt(4, { phase: '3', phaseMining: false });
  assert.deepEqual(kinds(), ['Biomass Burner', 'Coal Generator', 'Fuel Generator']);
});

test('the guided start asks for them on "What do you already have?", and skipping keeps none', async () => {
  open({ workspace: { catalog: items } });
  const guided = (settings: Partial<WizardSettings>) => {
    page();
    open({ workspace: { catalog: items } });
    draftAt(1, { phaseMining: true, ...settings }, { mode: 'guided', guidedStep: 1 });
    const step = guidedFlow().findIndex(question => question.id === 'have') + 1;
    assert.ok(step > 0, 'the screen is asked');
    page();
    open({ workspace: { catalog: items } });
    draftAt(1, { phaseMining: true, ...settings }, { mode: 'guided', guidedStep: step });
  };
  const submit = async () => {
    $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
  };
  guided({ phase: '3' });
  assert.ok($('[data-guided-have] [data-owned-generators]'), 'on the screen');
  assert.deepEqual(kinds(), ['Biomass Burner', 'Coal Generator', 'Fuel Generator']);
  const before = structuredClone(wizard!.settings);
  await submit();
  assert.equal(guidedFlow()[wizard!.guidedStep - 1]!.id, 'supply');
  assert.deepEqual(wizard!.settings, before, 'left empty, nothing changes');
  assert.equal('ownedGenerators' in wizard!.settings, false);
  // Counts entered reach the settings, as on step 4.
  guided({ phase: '3' });
  field('Coal Generator').value = '8';
  field('Fuel Generator').value = '2';
  await submit();
  assert.deepEqual(wizard!.settings.ownedGenerators, {
    'Coal Generator': 8,
    'Fuel Generator': 2,
  });
});

// The default Phase 2 plan builds 6 Coal Generators.
const withCoal = (count: number): CurrentCalculatedPlan =>
  generatedWith({ phase: '2', ownedGenerators: { 'Coal Generator': count } });

test('the coal line’s build-plan step says how many you already have and how many to build', () => {
  const step = () => plain($('[data-task="calc-2-power-coal"] p')?.textContent);
  open({ calculated: withCoal(4), phase: '2' });
  go('plan');
  render();
  assert.match(step(), /^You already have 4 of these 6 Coal Generators: build 2 more\. /);
  page();
  open({ calculated: withCoal(8), phase: '2' });
  go('plan');
  render();
  assert.match(
    step(),
    /^You already have 8 Coal Generators, enough for this line's 6: build none\. 6 Coal Generator total/,
  );
  // "Power available now" counts them too.
  assert.match(
    plain($('[data-task="startup-2-power-review"] p')?.textContent),
    /You already have 8 Coal Generators, enough for the 6 this phase's lines need, so build none\./,
  );
  page();
  open({ calculated: generatedWith({ phase: '2' }), phase: '2' });
  go('plan');
  render();
  assert.doesNotMatch(step(), /already have/, 'a plan without them, as before');
  // Phase 4 runs its 30 Fuel Generators on two lines (Fuel, Rocket Fuel): counted together.
  page();
  open({
    calculated: generatedWith({ phase: '4', ownedGenerators: { 'Fuel Generator': 10 } }),
    phase: '4',
  });
  go('plan');
  render();
  for (const id of ['calc-4-power-fuel', 'calc-4-power-rocket-fuel'])
    assert.match(
      plain($(`[data-task="${id}"] p`)?.textContent),
      /^You already have 10 of the 30 Fuel Generators this phase's 2 Fuel Generator lines run: build 20 more between them\. /,
      id,
    );
});

test('the Resources page’s bar and ADA name the generators you already have', () => {
  const plan = withCoal(8);
  open({ calculated: plan, phase: '2' });
  go('resources');
  render();
  assert.equal(
    plain($('[data-power-part="generation"] small')?.textContent),
    '8 Coal Generators, whole, at 100% · 8 Coal Generators you already have',
  );
  const adaLine = () => {
    adaClearFault();
    for (let i = 0; i < 60; i++) {
      setAdaIndex(i);
      const line = adaCurrent();
      if (line?.id === 'owned-generators') return line.text;
    }
    return undefined;
  };
  assert.match(adaLine() ?? '', /^This phase counts the 8 Coal Generators you already have/);
  // Phase 3 burns no coal: ADA says it does not count them.
  page();
  open({ calculated: plan, phase: '3' });
  go('resources');
  render();
  assert.match(
    adaLine() ?? '',
    /^This phase plans none of your 8 Coal Generators, so it does not count them\./,
  );
  page();
  open({ calculated: generatedWith({ phase: '2' }), phase: '2' });
  go('resources');
  render();
  assert.equal(adaLine(), undefined, 'none without them');
});
