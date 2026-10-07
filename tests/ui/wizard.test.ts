// The profile wizard's five steps (ui/pages/WizardPage.vue, ui/wizard/) and the guided start
// (ui/pages/GuidedPage.vue, ui/guided/), mounted through render() the way the app mounts them.
// The readers and moves behind them (wizard/*.js) are tested in tests/guided.test.ts and
// tests/interface.test.ts; the node survey in tests/ui/survey.test.ts.
import assert from 'node:assert/strict';
import { RESOLVE_WARNING } from '../../public/handbook-migration.ts';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import {
  boot,
  editingTask,
  factoryEditing,
  factoryFilter,
  floor,
  layoutEditing,
  planEditing,
  query,
  setEditingTask,
  setFactoryEditing,
  setFactoryFilter,
  setFloor,
  setLayoutEditing,
  setPlanEditing,
  setQuery,
  setWizard,
  view,
  wizard,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { vuePage } from '../../public/app/ui/pages.ts';
import GuidedPage from '../../public/app/ui/pages/GuidedPage.vue';
import SurveyPage from '../../public/app/ui/pages/SurveyPage.vue';
import WizardPage from '../../public/app/ui/pages/WizardPage.vue';
import {
  cancelEstimate,
  estimate,
  ESTIMATE_DELAY,
  setEstimatePaused,
} from '../../public/app/wizard/estimate.ts';
import { extractionOf } from '../../public/app/wizard/extraction.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { num } from '../../public/app/format.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { presetSurvey } from '../../public/preferences.ts';
import {
  answerConfirms,
  $,
  $$,
  catalog,
  evil,
  generated,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import { openAltRecipe } from '../../public/app/wizard/recipes.ts';
import { NAME_HINT, noteWizardEdit, startWizard } from '../../public/app/wizard/wizard.ts';
import { nameDate } from '../../public/app/profile-edit.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';

const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ');
const main = () => text('#main');
const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not, so every
  // move forward would stop at the form's own validation.
  HTMLFormElement.prototype.reportValidity = () => true;
});

// A draft in the five steps at `step`; `extra` overrides fields, `settings` the settings. Each
// is drawn on a fresh page: an update to a page already mounted lands on the next tick.
function wizardAt(
  step: number,
  extra: Partial<WizardDraft> = {},
  settings: Partial<WizardSettings> = {},
) {
  page();
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: step === 5 ? generated() : null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  go('wizard');
  render();
}
const guidedAt = (
  guidedStep: number,
  extra: Partial<WizardDraft> = {},
  settings: Partial<WizardSettings> = {},
) => wizardAt(1, { mode: 'guided', guidedStep, ...extra }, settings);

const redraw = async () => {
  render();
  await nextTick();
};
const click = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await settle();
};
// A checkbox or radio takes a boolean, any other box (a <select> too) a string.
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

test('#wizard shows the survey, the guided questions or the five steps, by the draft', () => {
  assert.equal(vuePage('wizard', null), WizardPage, 'no draft: offer to create a save');
  assert.equal(vuePage('wizard', { mode: 'extraction' } as WizardDraft), SurveyPage);
  assert.equal(
    vuePage('wizard', {} as WizardDraft),
    WizardPage,
    'a draft from before the guided start',
  );
  assert.equal(vuePage('wizard', { mode: 'advanced' } as WizardDraft), WizardPage);
  guidedAt(1);
  assert.equal(vuePage('wizard', wizard), GuidedPage);
  wizard!.guidedStep = guidedFlow().length + 1;
  assert.equal(vuePage('wizard', wizard), GuidedPage, 'answered: its own Review (#1072)');
});

test('without a draft the wizard offers to create a save', () => {
  setWizard(null);
  go('wizard');
  render();
  assert.equal($('#main h1')!.textContent, 'Choose a save first');
  assert.ok($('#main [data-new-save]'));
  assert.equal($('#main a.btn')!.getAttribute('href'), '#profiles');
});

test('the five steps keep every setting, and escape the save name once', async () => {
  wizardAt(1, { saveName: evil });
  noMarkup();
  assert.equal($('#main h1')!.textContent, 'Create your factory plan');
  // SP-36: the eyebrow names what is being made, not a four-part path the five tabs don't match.
  assert.equal($('#main .heading-row .eyebrow')?.textContent, 'NEW PROFILE');
  assert.equal($<HTMLInputElement>('input[name=saveName]')!.value, evil);
  assert.equal($<HTMLInputElement>('input[name=saveName]')!.readOnly, false);
  for (let step = 1; step <= 5; step++) {
    wizardAt(step, { saveId: 's', saveName: evil, name: evil });
    noMarkup();
    assert.ok($('#wizard-form'), 'step ' + step);
    assert.equal($('#main h1')!.textContent, 'Add a profile to ' + evil);
    assert.equal($$('[data-wizard-step]').length, 5, 'step ' + step + ' has every tab');
    assert.equal($('[data-wizard-step][aria-current=step]')!.dataset.wizardStep, String(step));
    assert.equal($('.guided-card'), null, 'step ' + step + ' shows no guided cards');
    assert.equal(
      !!$('[data-guided-start]'),
      step < 5,
      'the way back to the guided start, before Review',
    );
  }
  wizardAt(1, { saveId: 's' });
  assert.equal(
    $<HTMLInputElement>('input[name=saveName]')!.readOnly,
    true,
    'a profile for a save keeps its name',
  );
  assert.ok($('[data-cancel-wizard]') && !$('[data-wizard-back]'), 'step 1 cancels');
  wizardAt(2);
  for (const name of [
    'recipes',
    'utilityPercent',
    'cellsPerMinute',
    'storageRate',
    'buildRate',
    'somersloops',
    'augmenters',
    'fueledAugmenters',
    'amplifySloops',
  ])
    assert.ok($(`[name=${name}]`), 'step 2 has ' + name);
  wizardAt(4);
  assert.ok($('input[name=limitsConfirmed]'));
  assert.equal($$('input[name^="limit:"]').length, catalog().raw.length);
  assert.ok($('[data-open-extraction]'));
  assert.equal($('#wizard-form button[type=submit]')!.textContent.trim(), 'Calculate plan');
  wizardAt(5);
  assert.equal($('#wizard-form button[type=submit]')!.textContent.trim(), 'Create profile');
});

test('power typed in MW is kept in GW, as the settings store it', async () => {
  wizardAt(1, {}, { availablePowerGW: 0, installedPowerGW: 0 });
  await change('input[name=availablePowerMW]', '2500');
  await change('input[name=installedPowerMW]', '4000');
  // Read when the step is left.
  await submit();
  assert.equal(wizard!.settings.availablePowerGW, 2.5);
  assert.equal(wizard!.settings.installedPowerGW, 4);
  assert.equal(wizard!.step, 2);
});

test('a help tip opens without a mouse and has no native tooltip', () => {
  wizardAt(1);
  const tip = $('.setting-help');
  assert.ok(tip, 'the settings carry help');
  assert.equal(tip.getAttribute('tabindex'), '0');
  assert.ok(tip.getAttribute('aria-label'));
  assert.equal(tip.querySelector('[role=tooltip]')!.textContent, tip.getAttribute('aria-label'));
  assert.equal(tip.getAttribute('title'), null);
  wizardAt(3, {}, { goal: 'timed' });
  const phaseTime = $('select[name=phaseTime]')!.closest('label')!.querySelector('[role=tooltip]')!;
  assert.match(phaseTime.textContent, /final phase/, 'the target-time choice is explained');
});

test('a new purity on step 1 refills a survey whose world is known, as the survey does', async () => {
  // A survey already applied for the default world, with a miner mark, an oil well and a
  // rate already used of its own.
  const applied = {
    ...presetSurvey('vanilla'),
    mark: 3,
    wells: { 'Crude Oil': { impure: 0, normal: 0, pure: 3 } },
    used: { Coal: 100 },
  };
  wizardAt(
    1,
    {},
    { purity: 'vanilla', distribution: 'original', extraction: structuredClone(applied) },
  );
  $<HTMLSelectElement>('select[name=purity]')!.value = 'pure';
  await click('[data-wizard-step="2"]');
  const counts = extractionOf(wizard!);
  assert.deepEqual(counts.nodes, presetSurvey('pure').nodes, 'the counts of the pure world');
  assert.equal(counts.mark, 3, 'the miner mark is kept');
  // The draft is a copy: editing it leaves the applied survey alone until it is applied.
  counts.wells!['Crude Oil']!.pure = 99;
  counts.used = {};
  assert.deepEqual(wizard!.settings.extraction!.wells, applied.wells);
  assert.deepEqual(wizard!.settings.extraction!.used, applied.used);
  // Counts typed by hand are not the old preset's, so they stay, both ways round.
  const typed = presetSurvey('vanilla');
  typed.nodes['Iron Ore'] = { impure: 1, normal: 1, pure: 1 };
  wizardAt(1, {}, { purity: 'vanilla', distribution: 'original', extraction: typed });
  $<HTMLSelectElement>('select[name=purity]')!.value = 'pure';
  await click('[data-wizard-step="2"]');
  await click('[data-wizard-step="1"]');
  $<HTMLSelectElement>('select[name=purity]')!.value = 'vanilla';
  await click('[data-wizard-step="2"]');
  assert.deepEqual(extractionOf(wizard!).nodes, typed.nodes);
  // A world whose counts are not known keeps what was typed.
  wizardAt(
    1,
    {},
    { purity: 'vanilla', distribution: 'original', extraction: presetSurvey('vanilla') },
  );
  $<HTMLSelectElement>('select[name=distribution]')!.value = 'basic';
  await click('[data-wizard-step="2"]');
  assert.deepEqual(extractionOf(wizard!).nodes, presetSurvey('vanilla').nodes);
});

test('moving between steps reads the step being left, and Review calculates', async () => {
  wizardAt(1);
  $<HTMLInputElement>('input[name=saveName]')!.value = 'Edited world';
  $<HTMLSelectElement>('select[name=purity]')!.value = 'pure';
  await click('[data-wizard-step="2"]');
  assert.equal(wizard!.step, 2);
  assert.equal(wizard!.saveName, 'Edited world');
  assert.equal(wizard!.settings.limits!['Iron Ore'], 152400, 'a new purity brings its budgets');
  assert.equal(wizard!.preview, null);
  $<HTMLInputElement>('input[name=utilityPercent]')!.value = '35';
  $<HTMLInputElement>('input[name=somersloops]')!.value = '104';
  $<HTMLInputElement>('input[name=sloop][value=shards]')!.checked = true;
  const calls = stubFetch<{ settings: WizardSettings }>({ '/api/preview': generated() });
  await click('[data-wizard-step="5"]');
  assert.equal(calls.length, 1, 'jumping to Review calculates');
  assert.equal(calls[0]![1].settings.utilityPercent, 35, 'with the step it left');
  assert.equal(calls[0]![1].settings.somersloops, 104);
  assert.deepEqual(calls[0]![1].settings.sloopReserved, ['shards']);
  assert.equal(wizard!.step, 5);
  // Named after the goal, what differs from a new save's defaults and the day (#1071).
  assert.equal(
    $('#main h2')!.textContent,
    'Step 5 of 5: Review Balanced progression · exact ratios · from Phase 3 · ' + nameDate(),
    'named after the goal, what changed and the date',
  );
  assert.equal($$('#main tbody tr').length, 3, 'the phases from the start phase on');
  // Back steps without validating; Continue moves on.
  await click('[data-wizard-back]');
  assert.equal(wizard!.step, 4);
  await click('[data-wizard-step="3"]');
  await submit();
  assert.equal(wizard!.step, 4, 'Enter or Continue moves on');
});

test('a failed calculation says why in the form and gives the button back', async () => {
  wizardAt(4);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Calculation timed out. Try fewer alternates.' }), {
      status: 500,
    });
  await submit();
  assert.equal(wizard!.step, 4, 'the draft stays where it was');
  assert.match(text('#wizard-error'), /timed out/);
  assert.match(text('#wizard-error'), /Planner’s choice/, 'with ways to get a plan');
  assert.match(text('#wizard-error'), /whole-machine production/);
  // SP-34: the error is a notice above the buttons, and takes focus, so it is on screen and read
  // out after a failed Continue on a long step.
  const error = $('#wizard-error')!;
  assert.ok(error.classList.contains('notice') && error.classList.contains('error'));
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(error.nextElementSibling, $('#wizard-form .wizard-actions'), 'above the buttons');
  assert.equal(document.activeElement, error, 'the error takes focus');
  const button = $<HTMLButtonElement>('#wizard-form button[type=submit]')!;
  assert.equal(button.textContent, 'Calculate plan');
  assert.equal(button.disabled, false);
  // Another step clears the error line.
  await click('[data-wizard-step="3"]');
  assert.equal(text('#wizard-error'), '');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: evil }), { status: 500 });
  await click('[data-wizard-step="5"]');
  noMarkup();
  assert.equal($('#wizard-error')!.textContent, evil, 'other errors are plain text');
});

test('recipe access, preferred power and ingots redraw the step', async () => {
  wizardAt(2);
  assert.equal($('.alt-picker'), null, 'standard recipes need no picker');
  await change('select[name=recipes]', 'custom');
  assert.equal(wizard!.settings.recipes, 'custom');
  assert.ok($('.alt-picker'), 'picking specific alternates shows the picker');
  await change('select[name=recipes]', 'standard');
  assert.equal($('.alt-picker'), null);
});

test('the alternate picker ticks, forces, filters and shows each recipe', async () => {
  const RIP = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
  const box = (id: string) => $<HTMLInputElement>(`input[name=alt][value="${id}"]`);
  const star = (id: string) => $<HTMLInputElement>(`input[name=altpref][value="${id}"]`);
  wizardAt(2, {}, { recipes: 'custom', alternateRecipes: [RIP] });
  assert.ok(box(RIP)!.checked, 'picked alternates are pre-checked');
  assert.match(main(), /Stitched Iron Plate/);
  assert.match(main(), /MAM research/, 'MAM-researched recipes are labelled');
  assert.ok(box('Recipe_Alternate_Turbofuel_C'), 'MAM recipes are picks with neutral power');
  assert.ok(box('Recipe_Alternate_PureIronIngot_C'), 'pure recipes are picks by default');
  assert.doesNotMatch(main(), /Charcoal/, 'recipes beyond Phase 5 are not offered');
  assert.match(text('.alt-picker-head b'), /1 selected/);
  assert.equal(star(RIP)!.disabled, false, 'a picked row can be forced');
  assert.equal(star('Recipe_Alternate_Screw_C')!.disabled, true, 'an unpicked one cannot');
  // Ticks and stars are the picker's own until the step is read.
  await change(`input[name=alt][value="Recipe_Alternate_Screw_C"]`, true);
  assert.match(text('.alt-picker-head b'), /2 selected/);
  assert.equal(star('Recipe_Alternate_Screw_C')!.disabled, false);
  await change(`input[name=altpref][value="${RIP}"]`, true);
  await change(`input[name=alt][value="${RIP}"]`, false);
  assert.equal(star(RIP)!.checked, false, 'unticking a recipe drops its star');
  assert.equal(star(RIP)!.disabled, true);
  // The filter hides rows in place; Select all and Clear all apply to what it shows.
  const filter = $<HTMLInputElement>('#alt-filter')!;
  filter.value = 'iron plate';
  filter.dispatchEvent(new Event('input'));
  await nextTick();
  const shown = $$('.alt-row:not([hidden])');
  assert.ok(shown.length > 0 && shown.length < $$('.alt-row').length);
  await click('[data-alt-all]');
  for (const row of shown) {
    const checkbox = row.querySelector<HTMLInputElement>('input[name=alt]');
    if (checkbox) assert.ok(checkbox.checked, row.dataset.altText);
  }
  assert.equal(box('Recipe_Alternate_Screw_C')!.checked, true, 'a hidden row keeps its tick');
  assert.equal(box('Recipe_Alternate_Turbofuel_C')!.checked, false, 'and a hidden row gets none');
  await click('[data-alt-none]');
  for (const row of shown)
    assert.equal(row.querySelector<HTMLInputElement>('input[name=alt]')?.checked ?? false, false);
  // Reading the step takes exactly what the screen shows.
  await click('[data-wizard-step="1"]');
  assert.deepEqual(wizard!.settings.alternateRecipes, ['Recipe_Alternate_Screw_C']);
  // "recipe ↗" compares the alternate with the standard recipe.
  wizardAt(2, {}, { recipes: 'custom' });
  await click(`[data-alt-info="${RIP}"]`);
  assert.ok($<HTMLDialogElement>('#detail')!.open);
  assert.equal($('#detail h2')!.textContent, 'Stitched Iron Plate');
  assert.ok($('#detail .rail-recipe'), 'the pop-out shows the recipe card');
  assert.match(text('#detail'), /Standard recipe for Reinforced Iron Plate/);
});

test('an alternate-recipe dialog put in place of another takes focus, and closing returns it (#319)', async () => {
  const RIP = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
  wizardAt(2, {}, { recipes: 'custom' });
  const dialog = $<HTMLDialogElement>('#detail')!;
  const opener = $<HTMLButtonElement>(`[data-alt-info="${RIP}"]`)!;
  opener.focus();
  await click(`[data-alt-info="${RIP}"]`);
  assert.ok(dialog.open);
  // Nothing inside an alternate's dialog opens another, so the replacement is made the way a
  // link inside a dialog makes it: showDetail() while the dialog is open.
  const close = $<HTMLButtonElement>('#detail [data-close]')!;
  close.focus();
  openAltRecipe('Recipe_Alternate_Screw_C');
  assert.equal($('#detail h2')!.textContent, 'Cast Screws');
  assert.equal(close.isConnected, false);
  assert.equal(
    document.activeElement?.matches('#detail .dialog-head [data-close]'),
    true,
    'focus is on its first control, the ×',
  );
  dialog.close();
  assert.equal(document.activeElement === opener, true, 'closing returns focus to recipe ↗');
});

test('a preference that requires recipes locks them on', async () => {
  wizardAt(2, {}, { recipes: 'custom', mainPower: 'turbofuel' });
  assert.match(main(), /required by your power preference/);
  assert.equal($('input[name=alt][value="Recipe_Alternate_Turbofuel_C"]'), null, 'not a pick');
  wizardAt(2, {}, { recipes: 'custom', pureIngots: true });
  assert.match(main(), /required by your ingot preference/);
  assert.equal($('input[name=alt][value="Recipe_Alternate_PureIronIngot_C"]'), null);
  // Changing the preference on screen redraws the picker.
  await change('select[name=pureIngots]', 'false');
  assert.ok($('input[name=alt][value="Recipe_Alternate_PureIronIngot_C"]'));
});

test('the picker marks the alternates no hard drive unlocks by their unlock (#1044)', async () => {
  const POLYESTER = 'Recipe_Alternate_PolyesterFabric_C',
    DISTILLED = 'Recipe_Alternate_Silica_Distilled_C';
  const note = (id: string) =>
    ($(`[data-alt-info="${id}"]`)!.closest('.alt-row')!.querySelector('small')!.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  // A turbofuel route locks its own two MAM recipes; Polyester Fabric stays a pick.
  wizardAt(2, {}, { recipes: 'custom', mainPower: 'turbofuel' });
  assert.equal(note(POLYESTER), '· Fabric · MAM research');
  assert.ok($(`input[name=alt][value="${POLYESTER}"]`), 'a pick, not locked');
  assert.equal(note(DISTILLED), '· Silica, Water · Tier 7 milestone');
  assert.ok($(`input[name=alt][value="${DISTILLED}"]`));
  assert.equal(
    note('Recipe_Alternate_Turbofuel_C'),
    '· Turbofuel · MAM research · required by your power preference',
  );
  assert.match(
    main(),
    /Polyester Fabric are researched in the MAM instead, and Distilled Silica comes with the Tier 7 milestone Control System Development\./,
  );
  await click(`[data-alt-info="${DISTILLED}"]`);
  assert.match(
    text('#detail'),
    /Tier 7 milestone · unlocked at the HUB, not from hard drives · Blender/,
  );
});

test('Planner’s choice ticks the alternates the planner uses', async () => {
  wizardAt(2, {}, { recipes: 'custom', alternateRecipes: [] });
  const calls = stubFetch<{ settings: WizardSettings }>({ '/api/preview': generated() });
  await click('[data-alt-best]');
  assert.equal(calls[0]![1].settings.recipes, 'all', 'calculated with every alternate allowed');
  assert.deepEqual(wizard!.settings.alternateRecipes, [
    'Recipe_Alternate_EnrichedCoal_C',
    'Recipe_Alternate_Turbofuel_C',
  ]);
  assert.ok(
    $<HTMLInputElement>('input[name=alt][value="Recipe_Alternate_Turbofuel_C"]')!.checked,
    'and shown',
  );
  assert.match($('#toast')!.textContent, /Selected 2 alternate recipes/);
  assert.equal($('[data-alt-best]')!.textContent.trim(), 'Planner’s choice');
  assert.equal($<HTMLButtonElement>('[data-alt-best]')!.disabled, false);
});

test('the somersloop ledger totals what the plan commits', () => {
  wizardAt(
    2,
    {},
    { somersloops: 104, augmenters: 1, fueledAugmenters: 1, sloopReserved: ['shards'] },
  );
  assert.equal($$('input[name=sloop]').length, 3);
  assert.ok($<HTMLInputElement>('input[name=sloop][value=shards]')!.checked);
  assert.match(main(), /Committed: 11 of 104 available\./);
  assert.match(main(), /adds 5 Alien Power Matrix\/min/, 'the fuel rate is derived');
  wizardAt(2, {}, { somersloops: 5, augmenters: 1 });
  assert.match(main(), /More than you have\./);
});

test('storage rates: two group rates, per-item overrides and live placeholders', async () => {
  wizardAt(
    2,
    {},
    { storage: 'all', storageRate: 1, buildRate: 30, storageOverrides: { Concrete: 60 } },
  );
  const rate = (item: string) => $<HTMLInputElement>(`input[name="rate:${item}"]`);
  assert.equal($<HTMLInputElement>('input[name=buildRate]')!.value, '30');
  assert.equal($<HTMLInputElement>('input[name=storageRate]')!.value, '1');
  assert.ok($<HTMLDetailsElement>('details.rate-picker')!.open, 'open while any override is set');
  assert.match(text('.rate-picker summary'), /1 set/);
  assert.equal(rate('Concrete')!.value, '60');
  assert.equal(rate('Screws')!.value, '');
  assert.equal(rate('Iron Plate')!.placeholder, '30', 'construction follows the build rate');
  assert.equal(rate('Screws')!.placeholder, '1', 'the rest the general rate');
  assert.equal(rate('Nuclear Pasta')!.placeholder, '0', 'delivered parts start at zero');
  assert.equal(rate('Concrete')!.closest<HTMLElement>('.rate-row')!.dataset.rateGroup, 'build');
  assert.equal(
    rate('Nuclear Pasta')!.closest<HTMLElement>('.rate-row')!.dataset.rateGroup,
    'delivered',
  );
  assert.equal(rate('Screws')!.closest<HTMLElement>('.rate-row')!.dataset.rateGroup, 'other');
  // Typing a group rate refreshes the placeholders it applies to.
  const type = async (name: string, value: string) => {
    const el = $<HTMLInputElement>(`input[name=${name}]`)!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  };
  // A per-item rate typed but not read yet survives the placeholders and the filter redrawing
  // the list.
  rate('Screws')!.value = '7';
  await type('buildRate', '45');
  assert.equal(rate('Screws')!.value, '7', 'typing is not reset by a redraw');
  assert.equal(rate('Iron Plate')!.placeholder, '45');
  assert.equal(rate('Screws')!.placeholder, '1', 'the general boxes are untouched');
  assert.equal(rate('Nuclear Pasta')!.placeholder, '0');
  await type('storageRate', '4');
  assert.equal(rate('Screws')!.placeholder, '4');
  assert.equal(rate('Iron Plate')!.placeholder, '45');
  await type('buildRate', '');
  assert.equal(rate('Iron Plate')!.placeholder, '4', 'an empty build rate falls back');
  await type('storageRate', '');
  assert.equal(rate('Screws')!.placeholder, '4', 'a half-typed rate keeps the last one');
  // The filter hides rows in place.
  const filter = $<HTMLInputElement>('#rate-filter')!;
  filter.value = 'screw';
  filter.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(rate('Concrete')!.closest<HTMLElement>('.rate-row')!.hidden, true);
  assert.equal(rate('Screws')!.closest<HTMLElement>('.rate-row')!.hidden, false);
  assert.equal(rate('Screws')!.value, '7');
  assert.equal(rate('Concrete')!.value, '60');
  // The list follows the selected storage supply.
  wizardAt(2, {}, { storage: 'construction' });
  assert.ok(rate('Concrete'));
  assert.equal(rate('Ballistic Warp Drive'), null, 'items outside the contract are not listed');
  wizardAt(2, {}, { storage: 'none' });
  assert.equal($('.rate-list'), null, 'no dedicated storage, no rates');
});

test('the goals step and what Review says about each phase', () => {
  wizardAt(3, {}, { goal: 'timed', hours: 10 });
  assert.equal(
    $<HTMLSelectElement>('select[name=phaseTime]')!.value,
    'every',
    'every phase is the default',
  );
  assert.ok($<HTMLInputElement>('input[name=goal][value=timed]')!.checked);
  // Blank until a name is typed: the profile is then named after what it is (#1071).
  assert.equal($<HTMLInputElement>('input[name=profileName]')!.value, '');
  assert.equal($<HTMLInputElement>('input[name=profileName]')!.placeholder, NAME_HINT);
  wizardAt(3, {}, { goal: 'timed', phaseTime: 'final', multiplier: 10 });
  assert.equal($<HTMLSelectElement>('select[name=phaseTime]')!.value, 'final');
  assert.match(text('.goal-card:has(input[value=timed])'), /Suggested/);
  const plan = generated();
  wizardAt(5, {
    preview: {
      ...plan,
      settings: { ...plan.settings, phase: '1' },
      stages: { ...plan.stages, 1: { ...plan.stages[1], hours: 5.21, aheadOf: 9.92 } },
    },
  });
  // Both in hours and minutes, as the plan header and the elevator counter write them (#643).
  assert.match(
    main(),
    /about 5 h 13 min was about 9 h 55 min/,
    'a pulled-forward phase shows what it used to take',
  );
  const firstRow = $$('table tbody tr:first-child td').map(td => (td.textContent || '').trim());
  // Each number keeps its unit on its line in the narrow column (#741).
  assert.match(firstRow[2] ?? '', /^about 5\xa0h 13\xa0min was about 9\xa0h 55\xa0min$/);
  // The verdict comes right after the phase, so a phone shows it without scrolling (#661).
  assert.deepEqual(
    $$('table thead th').map(th => (th.textContent || '').trim()),
    ['Phase', 'Budget', 'Delivery time', 'Buildings', 'New generation', 'Power needed'],
  );
  assert.equal(firstRow[0], '1');
  assert.match(
    firstRow[1] ?? '',
    /^(Within the default budgets|Within your budgets|Needs adjustment|Planning draft)$/,
  );
  // The power each phase needs of what it has, as every page gives it (#1064): Phase 1 runs on
  // biomass; from Phase 2 on the phase's whole generators cover its need. Each need says what it
  // holds for trains, drones and pumps (#1090).
  const allowance = / incl\. [\d.,]+ (MW|GW) for trains, drones and pumps \(20%\)$/.source;
  assert.match(firstRow[5] ?? '', new RegExp(/^[\d.,]+ (MW|GW) from biomass/.source + allowance));
  const powerCells = $$('[data-review-power]').map(td => (td.textContent || '').trim());
  assert.equal(powerCells.length, 5);
  for (const cell of powerCells.slice(1))
    assert.match(cell, new RegExp(/^[\d.,]+ (MW|GW) of [\d.,]+ (MW|GW)/.source + allowance));
  assert.equal($$('[data-review-power].warn').length, 0, 'no phase is short');
  wizardAt(5);
  assert.doesNotMatch(main(), /was /);
  // Review flags only the phases the profile plans.
  wizardAt(5, {
    preview: {
      ...plan,
      settings: { ...plan.settings, phase: '4' },
      stages: {
        ...plan.stages,
        3: { feasible: false, reason: 'Earlier phase shortfall' },
        5: { feasible: false, reason: evil, shortfalls: [{ name: 'Coal', needed: 10, budget: 5 }] },
      },
    },
  });
  noMarkup();
  assert.doesNotMatch(main(), /Earlier phase shortfall/, 'a phase behind the start');
  assert.ok(main().includes('Phase 5 — budget exceeded: ' + evil), 'a phase it plans');
  assert.match(main(), /Raise the short budget/, 'with its options');
});

// A short fluid budget is named in m³/min, a short ore budget in /min (#367).
test('Review names a short fluid budget in m³/min and a short ore in /min (#367)', () => {
  const plan = generated();
  wizardAt(5, {
    preview: {
      ...plan,
      settings: { ...plan.settings, phase: '5' },
      stages: {
        ...plan.stages,
        5: {
          feasible: false,
          reason: 'Short',
          shortfalls: [
            { name: 'Crude Oil', needed: 300, budget: 120 },
            { name: 'Coal', needed: 10, budget: 5 },
          ],
        },
      },
    },
  });
  const review = main().replace(/ /g, ' ');
  assert.match(review, /Crude Oil to about 300 m³\/min \(entered: 120 m³\/min\)/);
  assert.match(review, /Coal to about 10\/min \(entered: 5\/min\)/);
});

test('Review credits production you already run, and says nothing for an older plan', () => {
  const plan = generated();
  wizardAt(5);
  assert.equal($('.supply-notice'), null, 'nothing declared, nothing credited');
  const older: StoredCalculatedPlan = generated();
  delete older.settings.existingSupply;
  for (const stage of Object.values(older.stages)) delete stage.supplied;
  wizardAt(5, { preview: older });
  assert.equal($('.supply-notice'), null, 'a plan from before the question');
  wizardAt(5, {
    preview: {
      ...plan,
      settings: { ...plan.settings, existingSupply: { 'Modular Frame': 50, Plastic: 5 } },
      stages: { ...plan.stages, 4: { ...plan.stages[4], supplied: { 'Modular Frame': 20 } } },
    },
  });
  assert.match(text('.supply-notice'), /Modular Frame 50\/min declared · the plan draws up to 20/);
  assert.match(text('.supply-notice'), /Plastic 5\/min declared · this plan has no use for it/);
});

test('adding a profile to a save offers to carry its progress, hostile names and all', async () => {
  wizardAt(5, { saveId: 's', carryFrom: 'p' });
  noMarkup();
  assert.ok($('.carry-list'));
  const from = $<HTMLSelectElement>('select[name=carryFrom]')!;
  assert.deepEqual(
    [...from.options].map(o => [o.value, o.textContent.trim()]),
    [
      ['original', evil],
      ['p', evil],
    ],
  );
  assert.equal(from.value, 'p', 'the profile being continued is preselected');
  for (const key of [
    'unlocks',
    'storage',
    'commissioning',
    'deliveries',
    'notes',
    'planEdits',
    'factories',
  ])
    assert.ok(
      $<HTMLInputElement>(`input[name=carry][value=${key}]`)!.checked,
      key + ' is carried by default',
    );
  assert.equal(
    $('input[name=carry][value=picked]'),
    null,
    'no recipe picks without custom recipes',
  );
  const plan = generated();
  wizardAt(5, {
    saveId: 's',
    carryFrom: 'p',
    preview: {
      ...plan,
      settings: {
        ...plan.settings,
        recipes: 'custom',
        alternateRecipes: ['Recipe_Alternate_Screw_C'],
      },
    },
  });
  assert.ok(
    $<HTMLInputElement>('input[name=carry][value=picked]')!.checked,
    'hand-picked recipes can be claimed',
  );
  assert.match(text('input[value=picked] + span'), /\(1\)/);
  wizardAt(5);
  assert.equal($('.carry-list'), null, 'a brand new save has nothing to carry');
});

// What the create submit posts to /api/profiles (createProfile in wizard/wizard.ts).
type ProfileRequest = Pick<
  WizardDraft,
  'saveId' | 'saveName' | 'name' | 'settings' | 'carryFrom' | 'carry'
> & { built: string[] };

test('creating the profile opens it and says what was carried', async () => {
  wizardAt(5, { saveId: 's', carryFrom: 'p', name: 'Third' });
  $<HTMLInputElement>('input[name=carry][value=notes]')!.checked = false;
  const calls = stubFetch<ProfileRequest>({
    '/api/profiles': { workspace: workspace, saveId: 's', profileId: 'p3', carriedChecks: 2 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Third' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan: generated(),
    },
  });
  await submit();
  await settle();
  const body = calls.find(([path]) => path === '/api/profiles')![1];
  assert.equal(body.name, 'Third');
  assert.equal(body.carryFrom, 'p');
  assert.equal(body.carry.notes, false, 'the unticked record is left behind');
  assert.equal(body.carry.storage, true);
  assert.deepEqual(body.built, []);
  assert.equal(wizard, null, 'the draft is done');
  assert.equal(view, 'plan');
  assert.match($('#toast')!.textContent, /Profile created: 2 steps carried over\./);
});

test('a failed create leaves the draft and says why', async () => {
  wizardAt(5);
  stubFetch({});
  await submit();
  assert.ok(wizard, 'nothing was created');
  assert.match($('#wizard-error')!.textContent, /unexpected \/api\/profiles/);
  const button = $<HTMLButtonElement>('#wizard-form button[type=submit]')!;
  assert.equal(button.textContent, 'Create profile');
  assert.equal(button.disabled, false);
});

test('Cancel drops the draft and shows the profiles', async () => {
  wizardAt(1);
  await click('[data-cancel-wizard]');
  assert.equal(wizard, null);
  assert.equal(view, 'profiles');
});

// --- The guided start ---

test('every guided screen offers All settings at the step that owns its question', () => {
  guidedAt(1);
  const flow = guidedFlow();
  assert.ok(flow.length >= 5 && flow.length <= 7, 'a handful of questions, not a form');
  for (let step = 1; step <= flow.length; step++) {
    guidedAt(step);
    assert.ok($('#wizard-form.guided-panel'), 'step ' + step);
    assert.ok($('.guided-card') || $('.supply-list'), 'cards, or the rows for the rate question');
    assert.match($('[data-guided-advanced]')!.dataset.guidedAdvanced!, /^[1-4]$/);
    assert.equal($('[data-guided-advanced]')!.dataset.guidedAdvanced, String(flow[step - 1]!.step));
    // The questions, then Review as the flow's last step (#1072).
    assert.equal($$('.guided-progress [role=listitem]').length, flow.length + 1);
    // SP-35: numbered steps, the current one marked for assistive software, and 'n of total'.
    const current = $('.guided-progress .current')!;
    assert.equal(current.getAttribute('aria-current'), 'step');
    assert.equal($$('.guided-progress [aria-current]').length, 1);
    assert.equal(current.querySelector('.guided-step-label')!.textContent, flow[step - 1]!.short);
    assert.equal(current.querySelector('i')!.textContent, String(step));
    assert.equal(current.querySelector('i')!.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(
      $$('.guided-progress i').map(i => i.textContent),
      [...flow, 'review'].map((_, i) => String(i + 1)),
    );
    assert.equal($$('.guided-progress .done').length, step - 1, 'the steps before it are done');
    assert.equal($('[data-guided-count]')!.textContent, step + ' of ' + (flow.length + 1));
    assert.equal(
      $('#wizard-form button[type=submit]')!.textContent.trim(),
      step === flow.length ? 'Calculate plan' : 'Continue →',
    );
    assert.equal(!!$('[data-cancel-wizard]'), step === 1, 'the first screen cancels');
  }
  guidedAt(1);
  assert.equal($('[data-guided-advanced]')!.dataset.guidedAdvanced, '1');
  guidedAt(flow.findIndex(q => q.id === 'goal') + 1);
  assert.equal($('[data-guided-advanced]')!.dataset.guidedAdvanced, '3');
});

test('an answer redraws the question, and All settings keeps it', async () => {
  guidedAt(1);
  const goalStep = guidedFlow().findIndex(q => q.id === 'goal') + 1;
  guidedAt(goalStep, { saveName: evil });
  noMarkup();
  assert.equal($<HTMLInputElement>('input[name=saveName]')!.value, evil);
  assert.equal($('input[name=hours]'), null, 'hours only for a timed goal');
  await change('input[name="guided:goal"][value=timed]', true);
  assert.equal(wizard!.settings.goal, 'timed');
  assert.ok(
    $('input[name="guided:goal"][value=timed]')!
      .closest('.guided-card')!
      .classList.contains('is-picked'),
  );
  assert.ok($('input[name=hours]'), 'a timed goal asks for its hours');
  await click('[data-guided-advanced]');
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 3, 'lands on the step that owns the question');
  assert.ok(
    $<HTMLInputElement>('input[name=goal][value=timed]')!.checked,
    'the answer survives the switch',
  );
  await click('[data-guided-start]');
  assert.equal(wizard!.mode, 'guided');
  assert.ok($('.guided-progress'), 'and the guided start comes back');
});

test('Continue walks the questions and Back returns', async () => {
  guidedAt(1);
  await submit();
  assert.equal(wizard!.guidedStep, 2);
  assert.ok($('[data-guided-back]'));
  await click('[data-guided-back]');
  assert.equal(wizard!.guidedStep, 1);
  await click('[data-cancel-wizard]');
  assert.equal(wizard, null);
});

test('past the last question the plan is calculated and Review takes over', async () => {
  guidedAt(1);
  const last = guidedFlow().length;
  guidedAt(last);
  const calls = stubFetch({ '/api/preview': generated() });
  await submit();
  assert.equal(calls.length, 1);
  assert.equal(wizard!.step, 5);
  // One flow (#1072): Review is the guided start's last step, not a second set of five tabs.
  assert.equal(vuePage('wizard', wizard), GuidedPage);
  // The name is the descriptive default (#1071): the goal, what differs and the date.
  assert.match(
    $('#main h2')!.textContent!,
    new RegExp(`^Step ${last + 1} of ${last + 1}: Review Balanced progression · `),
  );
  assert.equal($$('[data-wizard-step]').length, 0, 'no five step tabs');
  assert.equal($$('.guided-progress [role=listitem]').length, last + 1);
  assert.equal($('.guided-progress .current')!.textContent, `${last + 1}Review`);
  assert.equal($('[data-guided-count]')!.textContent, `${last + 1} of ${last + 1}`);
  assert.equal($$('#wizard-form button[type=submit]').length, 1, 'one Create button');
  assert.equal(text('#wizard-form button[type=submit]'), 'Create profile');
  assert.equal($('input[name=saveName]'), null, 'the name was asked with the questions');
  // Back returns to the last question; All settings shows the same Review in the five steps.
  await click('[data-guided-back]');
  assert.equal(wizard!.guidedStep, last);
  assert.ok($('.guided-card'));
  stubFetch({ '/api/preview': generated() });
  await submit();
  await click('[data-guided-advanced]');
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 5);
  assert.ok(wizard!.preview, 'the plan is kept');
  assert.equal(vuePage('wizard', wizard), WizardPage);
  assert.match($('#main h2')!.textContent, /^Step 5 of 5: Review /);
});

test('the guided Review creates the profile with the guided answers, once (#1072)', async () => {
  guidedAt(1);
  guidedAt(guidedFlow().length, { tutorial: 'done' });
  stubFetch({ '/api/preview': generated() });
  await submit();
  const calls = stubFetch<ProfileRequest>({
    '/api/profiles': { workspace: workspace, saveId: 's', profileId: 'p3', carriedChecks: 2 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Balanced progression' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan: generated(),
    },
  });
  await submit();
  await settle();
  const created = calls.filter(([path]) => path === '/api/profiles');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]![1].built, ['early-base-hub', 'unlock-Schematic_Tutorial5_C']);
  assert.equal(wizard, null, 'the draft is done');
  assert.equal(view, 'plan');
});

test('a second profile for a save is asked what changed, naming the profile safely', async () => {
  guidedAt(1, { saveId: 's', saveName: evil, carryFrom: 'p' });
  noMarkup();
  assert.ok($('.guided-topics'), 'the topic picker comes first');
  assert.equal($('.guided-progress'), null);
  assert.ok(main().includes('Starting from the settings of ' + evil));
  assert.ok($('.guided-known'), 'with the settings it keeps');
  assert.equal($<HTMLInputElement>('input[name=topic][value=phase]')!.checked, true);
  assert.equal($('input[name=saveName]'), null, 'no name box on this screen');
  wizard!.guidedAsk = ['phase'];
  await redraw();
  assert.ok($('.guided-card'), 'choosing only the phase asks only the phase');
  assert.equal(
    $<HTMLInputElement>('input[name=profileName]')!.placeholder,
    'Named after its goal, changes and date if left blank',
  );
});

test('ticking topics keeps the "what is different" screen; Continue asks exactly those', async () => {
  guidedAt(1, { saveId: 's', saveName: 'World', carryFrom: 'p' });
  await change('input[name=topic][value=phase]', false);
  await change('input[name=topic][value=goal]', true);
  await change('input[name=topic][value=exact]', true);
  assert.ok($('.guided-topics'), 'still on the topic picker after ticking');
  assert.equal(wizard!.guidedAsk, null, 'nothing is applied before Continue');
  await redraw();
  const ticked = () => $$<HTMLInputElement>('input[name=topic]:checked').map(el => el.value);
  assert.deepEqual(ticked(), ['goal', 'exact'], 'the ticks survive a redraw');
  await submit();
  assert.deepEqual(
    guidedFlow().map(q => q.id),
    ['goal', 'exact'],
  );
  assert.equal(wizard!.guidedStep, 1);
  assert.equal($('.guided-topics'), null);
  assert.ok($('input[name="guided:goal"]'), 'the first chosen question is on screen');
  assert.equal($$('.guided-progress [role=listitem]').length, 3, 'the two, then Review');
});

test('a failed calculation with no topics ticked stays on the "what is different" screen', async () => {
  guidedAt(1, { saveId: 's', saveName: 'World', carryFrom: 'p' });
  await change('input[name=topic][value=phase]', false);
  stubFetch({}); // /api/preview answers 500
  await submit();
  await settle();
  assert.equal(vuePage('wizard', wizard), GuidedPage);
  assert.ok($('.guided-topics'), 'the topic picker is still on screen');
  assert.match(text('#wizard-form .form-error'), /unexpected \/api\/preview/);
  // SP-34: the guided start's error is the same notice above its buttons, and takes focus.
  const error = $('#wizard-error.notice.error')!;
  assert.equal(error.nextElementSibling, $('#wizard-form .wizard-actions'), 'above the buttons');
  assert.equal(document.activeElement, error);
  assert.equal(wizard!.mode, 'guided');
  // Trying again once it can be calculated goes on to Review.
  stubFetch({ '/api/preview': generated() });
  await submit();
  assert.equal(wizard!.step, 5);
  assert.equal(vuePage('wizard', wizard), GuidedPage, 'the guided start’s own Review (#1072)');
  assert.equal($('.guided-topics'), null);
  assert.match($('#main h2')!.textContent, /^Step ([0-9]+) of [0-9]+: Review /);
});

test('"← Guided start" after All settings with no topics ticked returns to the topics', async () => {
  guidedAt(1, { saveId: 's', saveName: 'World', carryFrom: 'p' });
  await change('input[name=topic][value=phase]', false);
  await click('[data-guided-advanced]');
  assert.equal(vuePage('wizard', wizard), WizardPage, 'All settings shows the five steps');
  await click('[data-guided-start]');
  assert.equal(vuePage('wizard', wizard), GuidedPage);
  assert.ok($('.guided-topics'), 'back on "What is different this time?"');
  assert.deepEqual(
    $$<HTMLInputElement>('input[name=topic]:checked').map(el => el.value),
    [],
    'still with nothing ticked',
  );
});

test('the already-running question asks for a rate, with an item search we own', async () => {
  guidedAt(1);
  const supplyStep = guidedFlow().findIndex(q => q.id === 'supply') + 1;
  guidedAt(supplyStep);
  assert.ok($('.supply-list'));
  assert.equal($('.guided-card'), null, 'no cards to pick from');
  assert.equal($<HTMLInputElement>('input[name=supplyItem]')!.placeholder, 'Search item');
  assert.equal(
    $<HTMLInputElement>('input[name=supplyRate]')!.placeholder,
    '',
    'the rate carries no example',
  );
  assert.equal($('datalist'), null, 'suggestions are drawn in the page');
  assert.equal($('.supply-options')!.getAttribute('role'), 'listbox');
  assert.equal($$('input[name=supplyItem]').length, 1, 'one blank row to start');
  guidedAt(supplyStep, {}, { existingSupply: { 'Modular Frame': 50 } });
  assert.equal($$('input[name=supplyItem]').length, 2, 'the declared line plus a blank row');
  assert.equal($<HTMLInputElement>('input[name=supplyItem]')!.value, 'Modular Frame');
  assert.equal($<HTMLInputElement>('input[name=supplyRate]')!.value, '50');
  assert.ok($('[data-supply-remove="0"]'));
  assert.match(main(), /builds only the remainder/i);
  assert.match(main(), /net of them/i);
  // All settings step 1 has the same rows.
  wizardAt(1, {}, { existingSupply: { 'Modular Frame': 50 } });
  assert.ok($('.supply-list'));
  assert.equal($<HTMLInputElement>('input[name=supplyItem]')!.value, 'Modular Frame');
});

// --- Production you already run ---

const supplyAt = (
  rows?: WizardDraft['supplyRows'] | null,
  settings: Partial<WizardSettings> = {},
) => {
  wizardAt(1, rows ? { supplyRows: rows } : {}, settings);
};

test('a half-finished row survives, and says plainly why it does not count', async () => {
  supplyAt([{ name: 'Modular Frame', rate: '' }]);
  assert.equal($<HTMLInputElement>('input[name=supplyItem]')!.value, 'Modular Frame');
  assert.match(text('.supply-hint'), /Add a rate and this line is credited/);
  supplyAt([{ name: 'Modul', rate: '12' }]);
  assert.match(text('.supply-hint'), /No item of that name/);
  assert.ok($('.supply-hint')!.classList.contains('warn'));
  assert.equal($('.has-icon'), null, 'no icon for a name that is not an item');
  assert.equal($('img[src="./icons/modul.png"]'), null);
  supplyAt([{ name: 'Modular Frame', rate: '50' }]);
  assert.equal($('.supply-hint'), null, 'a complete row counts');
});

test('every supply row reserves the same columns', () => {
  supplyAt(null, { existingSupply: { Computer: 20 } });
  assert.equal($$('.supply-row').length, 2);
  const removes = $$('.supply-remove');
  assert.equal(removes.length, 2, 'both rows reserve the remove slot');
  assert.deepEqual(
    removes.map(b => b.classList.contains('is-blank')),
    [false, true],
    'only the blank row hides it',
  );
  assert.equal(removes[0]!.getAttribute('aria-label'), 'Remove Computer');
  assert.equal(removes[1]!.getAttribute('tabindex'), '-1', 'and it is inert');
  assert.equal(removes[1]!.getAttribute('aria-hidden'), 'true');
  assert.equal($('.supply-spacer'), null);
});

test('a chosen item shows its icon, and the icon follows the typing', async () => {
  supplyAt(null, { existingSupply: { 'Modular Frame': 50 } });
  const wraps = $$('.supply-input');
  assert.ok(wraps[0]!.classList.contains('has-icon'));
  assert.equal(wraps[0]!.dataset.icon, 'Modular Frame');
  assert.equal(wraps[0]!.firstElementChild!.getAttribute('src'), './icons/modular-frame.png');
  assert.equal(wraps[1]!.dataset.icon, '', 'the blank row has none');
  assert.equal($$('.has-icon').length, 1);
  const blank = $$<HTMLInputElement>('input[name=supplyItem]')[1]!;
  blank.value = 'Computer';
  blank.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.equal($$('.supply-input')[1]!.dataset.icon, 'Computer', 'shown while typing');
});

test('the item search works from the keyboard', async () => {
  supplyAt();
  const input = () => $<HTMLInputElement>('input[name=supplyItem]')!;
  const key = async (name: string) => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
    await nextTick();
  };
  input().value = 'frame';
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  const options = () => $$('.supply-option');
  assert.ok(options().length > 1);
  assert.ok(options().some(o => o.textContent.trim() === 'Modular Frame'));
  assert.equal($('.supply-options')!.hidden, false);
  assert.equal(input().getAttribute('aria-expanded'), 'true');
  await key('Escape');
  assert.equal($('.supply-options')!.hidden, true, 'Escape closes');
  assert.equal(input().value, 'frame', 'and what was typed stays');
  await key('ArrowDown');
  assert.equal($('.supply-options')!.hidden, false, '↓ opens it again');
  await key('ArrowDown');
  assert.equal(options()[0]!.getAttribute('aria-selected'), 'true');
  await key('ArrowUp');
  assert.equal(options().at(-1)!.getAttribute('aria-selected'), 'true', '↑ wraps round');
  const chosen = options().at(-1)!.textContent.trim();
  await key('Enter');
  await settle();
  assert.equal(wizard!.supplyRows![0]!.name, chosen, 'Enter picks it');
  assert.equal(input().value, chosen);
  assert.equal(document.activeElement, $('input[name=supplyRate]'), 'and moves to the rate');
  assert.equal($$('.supply-row').length, 2, 'with a fresh blank row');
  // A rate, once committed, is credited.
  await change('input[name=supplyRate]', '12');
  assert.deepEqual(wizard!.settings.existingSupply, { [chosen]: 12 });
  // A click picks too.
  const second = $$<HTMLInputElement>('input[name=supplyItem]')[1]!;
  second.value = 'comp';
  second.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  $$('.supply-option')[0]!.click();
  await settle();
  assert.equal(
    wizard!.supplyRows![1]!.name,
    $$<HTMLInputElement>('input[name=supplyItem]')[1]!.value,
  );
  // Remove drops the row and its credit.
  await click('[data-supply-remove="0"]');
  assert.deepEqual(wizard!.settings.existingSupply, {});
  assert.equal(wizard!.supplyRows!.length, 1);
});

// The list leaves out the item the text already names, so its first suggestion is another item;
// Enter with nothing highlighted used to pick that one (#295, form/ItemSearch.vue).
test('Enter on a name that is already an item keeps that item', async () => {
  supplyAt();
  const input = $<HTMLInputElement>('input[name=supplyItem]')!;
  input.value = 'iron plate';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.deepEqual(
    $$('.supply-option').map(o => o.textContent.trim()),
    ['Reinforced Iron Plate'],
    'the list offers only the other item',
  );
  assert.equal($$('.supply-option')[0]!.tabIndex, -1, 'a suggestion is no Tab stop');
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await settle();
  assert.equal(wizard!.supplyRows![0]!.name, 'Iron Plate', 'spelled as the list spells it');
});

test('signing out drops an unfinished wizard draft, so the next user never sees it', async () => {
  wizardAt(2, { saveId: 's', saveName: 'Previous user' });
  assert.ok(wizard);
  // boot() after a sign-out or an ended session: /api/workspace answers with no user.
  stubFetch({ '/api/workspace': { user: null, accountsEnabled: true, saves: [] } });
  await boot();
  assert.equal(wizard, null);
  assert.ok($('#auth-form'), 'the sign-in screen is up');
});

test('signing out or reaching an empty workspace closes the previous view state', async () => {
  setFloor('upper');
  setFactoryFilter('open');
  setQuery('coal');
  setPlanEditing(true);
  setEditingTask('phase-3-iron');
  setFactoryEditing(true);
  setLayoutEditing(true);
  stubFetch({ '/api/workspace': { user: null, accountsEnabled: true, saves: [] } });
  await boot();
  assert.deepEqual(
    [floor, factoryFilter, query, planEditing, editingTask, factoryEditing, layoutEditing],
    ['ground', 'all', '', false, null, false, false],
  );
  // A new user with no saves yet: the editing modes of whoever used the tab before are gone.
  setPlanEditing(true);
  setEditingTask('phase-3-iron');
  setFactoryEditing(true);
  setLayoutEditing(true);
  stubFetch({
    '/api/workspace': { user: { id: 'u2', username: 'next' }, accountsEnabled: true, saves: [] },
    '/progression.json': {},
  });
  await boot();
  assert.deepEqual(
    [planEditing, editingTask, factoryEditing, layoutEditing],
    [false, null, false, false],
  );
});

test('Cancel asks only once something was entered since the wizard started', async () => {
  const asked = answerConfirms(false);
  // Untouched: Continue to the next question and back again changes no answer.
  startWizard();
  render();
  await submit();
  await click('[data-guided-back]');
  await click('[data-cancel-wizard]');
  assert.equal(asked.length, 0, 'nothing entered, nothing asked');
  assert.equal(wizard, null);
  // Nor through All settings: step 2 and back reads each form without changing an answer.
  startWizard();
  render();
  await click('[data-guided-advanced]');
  await click('[data-wizard-step="2"]');
  await click('[data-wizard-step="1"]');
  await click('[data-cancel-wizard]');
  assert.equal(asked.length, 0, 'reading unchanged forms is not a change');
  assert.equal(wizard, null);
  // A changed answer is asked about; keeping it keeps the draft as it was.
  startWizard();
  render();
  $<HTMLInputElement>('input[name=saveName]')!.value = 'My world';
  // What the input listener in listeners.ts (not loaded by these tests) does for typing.
  noteWizardEdit();
  await submit();
  await click('[data-guided-back]');
  await click('[data-cancel-wizard]');
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /Discard the answers you entered/);
  assert.ok(wizard, 'kept');
  assert.equal((wizard as WizardDraft | null)?.saveName, 'My world');
  answerConfirms(true);
  await click('[data-cancel-wizard]');
  assert.equal(wizard, null);
  assert.equal(view, 'profiles');
});

// SP-33 (#268): Goals and Resources show a live estimate from a background /api/preview marked
// `estimate`, debounced so it starts ESTIMATE_DELAY after the last edit (under a second with the
// solve), one at a time, and cancelled when the step is left or the estimate is paused.
const pause = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms)).then(() => nextTick());
function freshEstimate() {
  cancelEstimate(true);
  setEstimatePaused(false, null);
}
// The generated plan with Iron Ore at `share` of its budget in Phase 5. Its power is enough there:
// the plan sizes its generators to its need (#1064, the stage's grid).
function estimated(share: number) {
  const plan = structuredClone(generated());
  const last = plan.stages['5'];
  last.raw!['Iron Ore'] = plan.settings.limits['Iron Ore']! * share;
  return plan;
}
const previews = <B>(calls: [string, B][]) =>
  calls.filter(([path]) => path.startsWith('/api/preview'));

test('Goals and Resources show a live estimate beside the form, the other steps none (SP-33)', async () => {
  freshEstimate();
  const calls = stubFetch({ '/api/preview': estimated(0.5) });
  for (const step of [1, 2, 5]) {
    wizardAt(step);
    assert.equal($('[data-estimate]'), null, 'no estimate on step ' + step);
  }
  wizardAt(4);
  assert.ok($('.wizard-body.with-estimate [data-estimate]'), 'beside the form');
  // Arriving estimates the draft's settings straight away.
  await pause(30);
  assert.equal(previews(calls).length, 1);
  // Marked in the address, which the server reads before the body (#413).
  assert.equal(calls[0]![0], '/api/preview?estimate=1', 'marked as an estimate');
  const plan = estimated(0.5),
    last = plan.stages['5'];
  assert.equal(
    text('[data-estimate-buildings]').trim(),
    num(last.rows!.reduce((total, row) => total + row.machines, 0)),
  );
  assert.equal(
    text('[data-estimate-power]').trim(),
    `${power(last.grid!.needMW)} of ${power(last.grid!.availableMW)}`,
  );
  // What that need holds for trains, drones and pumps (#1090).
  assert.equal(
    text('[data-estimate-allowance]').trim(),
    `incl. ${power(last.grid!.allowanceMW)} for trains, drones and pumps (20%)`,
  );
  assert.ok(text('[data-estimate-tightest]').length > 0, 'the tightest resource is named');
  assert.equal($('[data-estimate-status]')!.getAttribute('aria-live'), 'polite');
  assert.equal($('[data-estimate-warning]'), null, 'nothing over budget');
});

test('a budget over 100% shows a warning in the estimate (SP-33)', async () => {
  freshEstimate();
  stubFetch({ '/api/preview': estimated(1.25) });
  wizardAt(4);
  await pause(30);
  assert.match(text('[data-estimate-tightest]'), /^ ?Iron Ore 125% Phase 5/);
  assert.ok($('[data-estimate-tightest]')!.classList.contains('warn'));
  assert.match(text('[data-estimate-warning]'), /Iron Ore is over its budget: 125% in Phase 5\./);
  // Too little power at the last phase warns as well, as the plan's headroom notice would: here a
  // grid with 1 GW less than the phase needs.
  freshEstimate();
  const plan = structuredClone(generated()),
    last = plan.stages['5'];
  last.grid = { ...last.grid!, availableMW: last.grid!.needMW - 1000 };
  stubFetch({ '/api/preview': plan });
  wizardAt(3);
  await pause(30);
  assert.ok($('[data-estimate-power]')!.classList.contains('warn'));
  assert.ok(
    text('[data-estimate-warning]').includes(
      `Phase 5 needs ${power(last.grid.needMW)} of power; ${power(last.grid.availableMW)} is available.`,
    ),
  );
  // A phase that does not fit says so.
  freshEstimate();
  const draft = structuredClone(plan);
  draft.stages['4'] = { ...draft.stages['4'], feasible: false, reason: 'Needs more coal.' };
  stubFetch({ '/api/preview': draft });
  wizardAt(3);
  await pause(30);
  assert.match(text('[data-estimate-warning]'), /Phase 4 does not fit these settings\./);
});

// #412: on a phone the panel sits under the form, so a one-line bar at the foot of the screen
// carries the tightest resource and a warning mark, and tapping it brings the panel into view with
// its heading focused. It hides while the panel is on screen (the stylesheet hides it on wider
// screens).
test('a one-line estimate bar carries the tightest resource and its warning, and opens the panel (#412)', async () => {
  freshEstimate();
  stubFetch({ '/api/preview': estimated(0.5) });
  wizardAt(4);
  await pause(30);
  const bar = () => $<HTMLButtonElement>('[data-estimate-peek]');
  assert.equal(text('[data-estimate-peek-text]'), 'Iron Ore 50%');
  assert.equal(text('[data-estimate-peek] .eyebrow'), 'Tightest');
  assert.equal($('[data-estimate-peek] .estimate-peek-warn'), null, 'no warning mark');
  assert.ok(!bar()!.classList.contains('warn'));
  freshEstimate();
  stubFetch({ '/api/preview': estimated(1.25) });
  wizardAt(4);
  await pause(30);
  assert.equal(text('[data-estimate-peek-text]'), 'Iron Ore 125%');
  // The mark sits outside the text, so a long figure cut short on a phone keeps it.
  assert.ok($('[data-estimate-peek] .estimate-peek-warn'));
  assert.match(
    text('[data-estimate-peek]'),
    /^Live estimate: TightestIron Ore 125%⚠, with a warning↓$/,
  );
  assert.ok(bar()!.classList.contains('warn'));
  let scrolled: Element | null = null;
  const scroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled = this;
  };
  try {
    bar()!.click();
    await nextTick();
  } finally {
    Element.prototype.scrollIntoView = scroll;
  }
  assert.equal(scrolled, $('[data-estimate]'), 'the panel comes into view');
  assert.equal(document.activeElement, $('#wizard-estimate-title'), 'its heading takes focus');
});

test('the estimate bar hides while the panel is on screen (#412)', async () => {
  freshEstimate();
  stubFetch({ '/api/preview': estimated(0.5) });
  const observers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const real = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly scrollMargin = '';
    readonly thresholds = [];
    constructor(callback: IntersectionObserverCallback) {
      // A partial entry: the estimate bar reads only isIntersecting.
      observers.push(entries => callback(entries as IntersectionObserverEntry[], this));
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  try {
    wizardAt(4);
    await pause(30);
    assert.ok($('[data-estimate-peek]'), 'shown while the panel is out of view');
    observers.at(-1)!([{ isIntersecting: true }]);
    await nextTick();
    assert.equal($('[data-estimate-peek]'), null, 'hidden while the panel is on screen');
    observers.at(-1)!([{ isIntersecting: false }]);
    await nextTick();
    assert.ok($('[data-estimate-peek]'), 'back when it scrolls away');
  } finally {
    globalThis.IntersectionObserver = real;
  }
});

test('edits are debounced into one estimate of the latest settings, within a second (SP-33)', async () => {
  freshEstimate();
  const calls = stubFetch<{ settings: WizardSettings; estimate?: boolean }>({
    '/api/preview': estimated(0.5),
  });
  wizardAt(4);
  await pause(30);
  const before = previews(calls).length;
  const box = $<HTMLInputElement>('input[name="limit:Iron Ore"]')!;
  for (const value of ['1', '12', '123']) {
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(50);
  }
  assert.equal(previews(calls).length, before, 'nothing while typing');
  assert.match(
    text('[data-estimate-status]'),
    /Estimating…/,
    'marked out of date from the edit on',
  );
  assert.ok($('.estimate-figures.stale'), 'the old figures are dimmed');
  await pause(ESTIMATE_DELAY);
  const sent = previews(calls).slice(before);
  assert.equal(sent.length, 1, 'one estimate after the pause');
  assert.equal(sent[0]![1].settings.limits['Iron Ore'], 123, 'of the latest value');
  assert.ok(ESTIMATE_DELAY < 1000);
});

test('leaving the step or pausing cancels the estimate, and a late answer is ignored (SP-33)', async () => {
  freshEstimate();
  let answer: (response: Response) => void = () => {};
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_path: RequestInfo | URL, options: RequestInit = {}) => {
    bodies.push(JSON.parse(String(options.body)));
    return new Promise<Response>(resolve => (answer = resolve));
  }) as typeof fetch;
  wizardAt(3);
  await pause(30);
  assert.equal(bodies.length, 1, 'estimating');
  assert.match(text('[data-estimate-status]'), /Estimating…/);
  // The page never waits on it: the form still moves between steps.
  await click('[data-wizard-back]');
  assert.equal(wizard!.step, 2);
  assert.equal($('[data-estimate]'), null);
  answer(new Response(JSON.stringify(estimated(2)), { status: 200 }));
  await pause(30);
  assert.equal(estimate.plan, null, 'the late answer is dropped');
  // Pausing: no estimate while paused, one of the settings then on resuming.
  stubFetch({ '/api/preview': estimated(0.5) });
  wizardAt(3);
  await pause(30);
  const pauseButton = $<HTMLButtonElement>('[data-estimate-pause]')!;
  pauseButton.click();
  await nextTick();
  assert.equal(pauseButton.getAttribute('aria-pressed'), 'true');
  assert.match(pauseButton.textContent, /Resume live estimate/);
  const calls = stubFetch({ '/api/preview': estimated(0.5) });
  const hours = $<HTMLInputElement>('input[name=hours]')!;
  hours.value = '9';
  hours.dispatchEvent(new Event('input', { bubbles: true }));
  await pause(ESTIMATE_DELAY + 50);
  assert.equal(calls.length, 0, 'paused');
  pauseButton.click();
  await pause(30);
  assert.equal(previews(calls).length, 1, 'resumed');
  assert.equal($('[data-estimate-pause]')!.getAttribute('aria-pressed'), 'false');
});

// With whole machines on, the estimate is solved twice: first with exact ratios, which is quick
// even for a heavy plan and is shown as a quick estimate, then as the settings stand, which
// replaces it. An edit made during the quick pass skips the whole-machine pass of the old
// settings and estimates the new ones (SP-33, the under-a-second criterion).
test('with whole machines, a quick exact-ratio estimate shows first and the full one replaces it (SP-33)', async () => {
  freshEstimate();
  const sent: { settings: WizardSettings; estimate: boolean }[] = [];
  const answers: ((plan: unknown) => void)[] = [];
  globalThis.fetch = (async (path: RequestInfo | URL, options: RequestInit = {}) => {
    sent.push({
      ...JSON.parse(String(options.body)),
      estimate: String(path).endsWith('?estimate=1'),
    });
    return new Promise<Response>(resolve =>
      answers.push(plan => resolve(new Response(JSON.stringify(plan), { status: 200 }))),
    );
  }) as typeof fetch;
  wizardAt(4, {}, { wholeMachines: true });
  await pause(30);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.settings.wholeMachines, false, 'the quick pass uses exact ratios');
  assert.equal(sent[0]!.estimate, true);
  answers[0]!(estimated(0.5));
  await pause(30);
  assert.match(text('[data-estimate-status]'), /Quick estimate with exact ratios/);
  assert.equal($('.estimate-figures.stale'), null, 'the quick figures are not dimmed');
  assert.equal(sent.length, 2, 'then the whole-machine pass');
  assert.equal(sent[1]!.settings.wholeMachines, true);
  answers[1]!(estimated(1.25));
  await pause(30);
  assert.match(text('[data-estimate-status]'), /Estimate for the settings on screen\./);
  assert.match(text('[data-estimate-warning]'), /Iron Ore is over its budget: 125%/);
  // An edit during the quick pass: its answer and the old whole-machine pass are skipped.
  const box = $<HTMLInputElement>('input[name="limit:Iron Ore"]')!;
  box.value = '5';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await pause(ESTIMATE_DELAY + 30);
  assert.equal(sent.length, 3, 'a quick pass for the edit');
  box.value = '7';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await pause(ESTIMATE_DELAY + 30);
  assert.equal(sent.length, 3, 'waits for the pass under way');
  answers[2]!(estimated(3));
  await pause(30);
  assert.equal(sent.length, 4, 'no whole-machine pass for the old settings');
  assert.equal(sent[3]!.settings.wholeMachines, false, 'a quick pass for the latest ones');
  assert.equal(sent[3]!.settings.limits['Iron Ore'], 7);
  assert.doesNotMatch(text('[data-estimate-tightest]'), /300%/, 'the skipped answer is not shown');
  // Without whole machines there is one pass only. (The pass still under way is answered first:
  // this stub ignores the abort, which on the server settles the request at once.)
  freshEstimate();
  answers[3]!(estimated(0.5));
  await pause(30);
  sent.length = 0;
  answers.length = 0;
  wizardAt(4, {}, { wholeMachines: false });
  await pause(30);
  answers[0]!(estimated(0.5));
  await pause(30);
  assert.equal(sent.length, 1);
  assert.match(text('[data-estimate-status]'), /Estimate for the settings on screen\./);
});

// A new profile carrying progress from a transcribed handbook solves that plan afresh, so the
// carry panel says so while that profile is the source (#480).
test('the carry panel warns when the source profile is a transcribed plan (#480)', async () => {
  wizardAt(5, { saveId: 's', carryFrom: 'p' });
  assert.equal($('.carry-panel [data-resolve-warning]'), null, 'an ordinary source says nothing');
  const save = workspace.saves.find(s => s.id === 's')!;
  save.profiles.find(p => p.id === 'p')!.transcribed = true;
  render();
  await nextTick();
  assert.equal($('.carry-panel [data-resolve-warning]')!.textContent, RESOLVE_WARNING);
});
