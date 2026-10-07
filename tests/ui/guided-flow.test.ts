// The guided start as one flow (#1072): its questions are worded for the profile's start phase,
// "I will choose them myself" picks the recipes on its own screen and goes on to the next
// question, it asks how to power the factory (the existing mainPower and availablePowerGW), its
// goal names are the Goals step's, and the five steps' Preferences show a rate only beside the
// choice it belongs to. Review is the flow's last step (tests/ui/wizard.test.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWizard, wizard, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { carryOptions } from '../../public/state.ts';
import { guidedQuestions, guidedTopupFrom, guidedTopupItems } from '../../public/preferences.ts';
import { $, $$, catalog, generated, go, open, page } from './setup.ts';
import recipes from '../../recipes.json' with { type: 'json' };
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();

function draftAt(extra: Partial<WizardDraft>, settings: Partial<WizardSettings> = {}) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 1,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'guided',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  go('wizard');
  render();
}
// The guided screen of question `id`, for a profile starting in `phase`.
function question(id: string, phase: string, settings: Partial<WizardSettings> = {}) {
  draftAt({}, { phase: phase as WizardSettings['phase'], ...settings });
  draftAt(
    { guidedStep: guidedFlow().findIndex(q => q.id === id) + 1 },
    { phase: phase as WizardSettings['phase'], ...settings },
  );
}
const change = async (selector: string, value: string | boolean) => {
  const el = $<HTMLInputElement>(selector);
  assert.ok(el, selector + ' is on screen');
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};
const submit = async () => {
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
};
const card = (id: string, value: string) =>
  text(`input[name="guided:${id}"][value="${value}"] ~ p`);

beforeEach(() => {
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('the stock question quotes the buildings from the start phase on, and no Phase 3 spill', () => {
  question('stock', '1');
  assert.match(
    card('stock', 'construction'),
    /9 more buildings in Phase 1, 16 in Phase 2, 9 in Phase 3\.$/,
  );
  assert.match(
    card('stock', 'all'),
    /11 more buildings in Phase 1, 32 in Phase 2, 57 in Phase 3\.$/,
  );
  assert.doesNotMatch(text('.guided-topup'), /Phase 3|29 Wire/, 'no default Phase 3 plan quoted');
  question('stock', '4');
  assert.match(
    card('stock', 'construction'),
    /On a default plan: 36 more buildings in Phase 4, 4 in Phase 5\.$/,
  );
  assert.match(card('stock', 'all'), /83 more buildings in Phase 4, 134 in Phase 5\.$/);
  assert.doesNotMatch(card('stock', 'all'), /Phase [1-3]/, 'never a phase before the start');
  assert.equal(card('stock', 'none').includes('Phase'), false);
});

test('a top-up chip the start phase cannot make yet says from which phase', () => {
  question('stock', '1', { storage: 'construction' });
  const from = (item: string) => text(`.guided-chip:has(input[value="${item}"]) [data-topup-from]`);
  assert.equal(from('Steel Beam'), 'from Phase 2');
  assert.equal(from('Steel Pipe'), 'from Phase 2');
  assert.equal(from('Concrete'), '');
  assert.match(
    $(`input[name=topup][value="Steel Beam"]`)!.getAttribute('aria-label')!,
    /from Phase 2$/,
  );
  question('stock', '2', { storage: 'construction' });
  assert.equal($$('[data-topup-from]').length, 0, 'Phase 2 makes them all');
});

test('the top-up phases follow the recipe data', () => {
  for (const item of guidedTopupItems) {
    const first = Math.min(
      ...recipes.recipes
        .filter(recipe => !recipe.alternate && (recipe.outputs as Record<string, number>)[item])
        .map(recipe => recipe.phase),
    );
    assert.equal(guidedTopupFrom[item] || 1, first, item);
  }
});

test('the guided goal names are the Goals step’s', () => {
  const goals = guidedQuestions.find(q => q.id === 'goal')!.options!;
  const balanced = goals.find(option => option.value === 'balanced')!;
  assert.equal(balanced.label, catalog().goals.find(goal => goal.id === 'balanced')!.name);
});

test('"I will choose them myself" picks the recipes on its own screen and goes on', async () => {
  question('recipes', '3', { recipes: 'standard' });
  assert.equal($('.alt-list'), null);
  assert.equal(
    $('input[name="guided:recipes"][value=custom]')!
      .closest('.guided-card')!
      .querySelector('.badge'),
    null,
    'no "Opens All settings"',
  );
  await change('input[name="guided:recipes"][value=custom]', true);
  assert.equal(wizard!.settings.recipes, 'custom');
  assert.ok($('#wizard-form.guided-panel .alt-list'), 'the picker under the cards');
  const box = $<HTMLInputElement>('.alt-list input[name=alt]')!;
  box.checked = true;
  const step = wizard!.guidedStep;
  await submit();
  assert.equal(wizard!.mode, 'guided', 'the questions go on');
  assert.equal(wizard!.guidedStep, step + 1);
  assert.deepEqual(wizard!.settings.alternateRecipes, [box.value], 'the pick is kept');
});

test('the power question writes the main power and the spare power', async () => {
  question('power', '3', { mainPower: 'auto', availablePowerGW: 0 });
  assert.deepEqual(
    $$<HTMLInputElement>('input[name="guided:power"]').map(input => input.value),
    ['auto', 'coal', 'fuel'],
  );
  assert.ok($<HTMLInputElement>('input[name="guided:power"][value=auto]')!.checked);
  assert.doesNotMatch(main(), /biomass/, 'Phase 3 builds generators from the start');
  await change('input[name="guided:power"][value=coal]', true);
  assert.equal(wizard!.settings.mainPower, 'coal');
  $<HTMLInputElement>('input[name=availablePowerMW]')!.value = '1500';
  await submit();
  assert.equal(wizard!.settings.availablePowerGW, 1.5);
  // A total entered before is never left below the spare part of it.
  question('power', '3', { availablePowerGW: 0, installedPowerGW: 1 });
  $<HTMLInputElement>('input[name=availablePowerMW]')!.value = '2000';
  await submit();
  assert.equal(wizard!.settings.installedPowerGW, 2);
});

test('the power question tells a Phase 1 or 2 profile when its choice starts to count', () => {
  question('power', '1');
  assert.match(main(), /Phase 1 runs on biomass burners you feed by hand/);
  question('power', '2');
  assert.match(main(), /Phase 2 runs on Coal Generators\. From Phase 3/);
  // A main power only All settings offers keeps its value and picks no card.
  question('power', '4', { mainPower: 'rocket' });
  assert.equal($$('input[name="guided:power"]:checked').length, 0);
});

test('Preferences shows a rate only beside the choice it belongs to', async () => {
  draftAt({ mode: 'advanced', step: 2 }, { droneFuel: 'none', nuclear: 'none' });
  assert.equal($('input[name=droneFuelRate]'), null, 'no drone fuel: no supply rate');
  assert.equal($('input[name=droneBridgeRate]'), null);
  assert.equal($('input[name=uraniumReactors]'), null, 'no nuclear: no reactor count');
  const stored = wizard!.settings.uraniumReactors;
  await change('select[name=droneFuel]', 'Battery');
  assert.ok($('input[name=droneFuelRate]'), 'a drone fuel brings its supply rate');
  assert.equal($('input[name=droneBridgeRate]'), null, 'the bridge is for ionized fuel only');
  await change('select[name=droneFuel]', 'Packaged Ionized Fuel');
  assert.ok($('input[name=droneBridgeRate]'));
  await change('select[name=nuclear]', 'sink');
  assert.equal($<HTMLInputElement>('input[name=uraniumReactors]')!.value, String(stored));
});

test('Review says which budgets a fitting phase stays within', () => {
  const plan = generated();
  const preview = (limits: Record<string, number>) => ({
    ...plan,
    settings: { ...plan.settings, phaseMining: undefined, limits },
    stages: Object.fromEntries(
      Object.entries(plan.stages).map(([phase, stage]) => [
        phase,
        { ...stage, mining: undefined, feasible: true },
      ]),
    ),
  });
  const budget = () => text('table tbody tr:first-child td:nth-child(2)');
  draftAt({ mode: 'advanced', step: 5, preview: preview({ ...workspace.catalog.limits }) });
  assert.equal(budget(), 'Within the default budgets', 'none entered');
  const own = { ...workspace.catalog.limits, 'Iron Ore': 1000 };
  draftAt({ mode: 'advanced', step: 5, preview: preview(own) });
  assert.equal(budget(), 'Within your budgets');
});

const main = () => text('#main');
