// The profile wizard's five steps (ui/pages/WizardPage.vue, ui/wizard/) and the guided start
// (ui/pages/GuidedPage.vue, ui/guided/), mounted through render() the way the app mounts them.
// The readers and moves behind them (wizard/*.js) are tested in tests/guided.test.mjs and
// tests/interface.test.mjs; the node survey in tests/ui/survey.test.mjs.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.js';
import { setWizard, view, wizard, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { vuePage } from '../../public/app/ui/pages.ts';
import GuidedPage from '../../public/app/ui/pages/GuidedPage.vue';
import SurveyPage from '../../public/app/ui/pages/SurveyPage.vue';
import WizardPage from '../../public/app/ui/pages/WizardPage.vue';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { $, $$, catalog, evil, generated, go, open, page, stubFetch } from './setup.mjs';

const text = s => ($(s)?.textContent || '').replace(/\s+/g, ' ');
const main = () => text('#main');
const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
const settle = () => new Promise(r => setTimeout(r, 20)).then(() => nextTick());

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not, so every
  // move forward would stop at the form's own validation.
  HTMLFormElement.prototype.reportValidity = () => true;
});

// A draft in the five steps at `step`; `extra` overrides fields, `settings` the settings. Each
// is drawn on a fresh page: an update to a page already mounted lands on the next tick.
function wizardAt(step, extra = {}, settings = {}) {
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
    usedGuided: false,
    tutorial: 'doing',
    ...extra,
  });
  go('wizard');
  render();
}
const guidedAt = (guidedStep, extra = {}, settings = {}) =>
  wizardAt(1, { mode: 'guided', guidedStep, ...extra }, settings);

const redraw = async () => {
  render();
  await nextTick();
};
const click = async selector => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await settle();
};
const change = async (selector, value) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = value;
  else el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};
const submit = async () => {
  $('#wizard-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
};

test('#wizard shows the survey, the guided questions or the five steps, by the draft', () => {
  assert.equal(vuePage('wizard', null, null), WizardPage, 'no draft: offer to create a save');
  assert.equal(vuePage('wizard', null, { mode: 'extraction' }), SurveyPage);
  assert.equal(vuePage('wizard', null, {}), WizardPage, 'a draft from before the guided start');
  assert.equal(vuePage('wizard', null, { mode: 'advanced' }), WizardPage);
  guidedAt(1);
  assert.equal(vuePage('wizard', null, wizard), GuidedPage);
  wizard.guidedStep = guidedFlow().length + 1;
  assert.equal(vuePage('wizard', null, wizard), WizardPage, 'answered: the five steps’ Review');
});

test('without a draft the wizard offers to create a save', () => {
  setWizard(null);
  go('wizard');
  render();
  assert.equal($('#main h1').textContent, 'Choose a save first');
  assert.ok($('#main [data-new-save]'));
  assert.equal($('#main a.btn').getAttribute('href'), '#profiles');
});

test('the five steps keep every setting, and escape the save name once', async () => {
  wizardAt(1, { saveName: evil });
  noMarkup();
  assert.equal($('#main h1').textContent, 'Create your factory plan');
  assert.equal($('input[name=saveName]').value, evil);
  assert.equal($('input[name=saveName]').readOnly, false);
  for (let step = 1; step <= 5; step++) {
    wizardAt(step, { saveId: 's', saveName: evil, name: evil });
    noMarkup();
    assert.ok($('#wizard-form'), 'step ' + step);
    assert.equal($('#main h1').textContent, 'Add a profile to ' + evil);
    assert.equal($$('[data-wizard-step]').length, 5, 'step ' + step + ' has every tab');
    assert.equal($('[data-wizard-step][aria-current=step]').dataset.wizardStep, String(step));
    assert.equal($('.guided-card'), null, 'step ' + step + ' shows no guided cards');
    assert.equal(
      !!$('[data-guided-start]'),
      step < 5,
      'the way back to the guided start, before Review',
    );
  }
  wizardAt(1, { saveId: 's' });
  assert.equal($('input[name=saveName]').readOnly, true, 'a profile for a save keeps its name');
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
  assert.equal($('#wizard-form button[type=submit]').textContent.trim(), 'Calculate plan');
  wizardAt(5);
  assert.equal($('#wizard-form button[type=submit]').textContent.trim(), 'Create profile');
});

test('a help tip opens without a mouse and has no native tooltip', () => {
  wizardAt(1);
  const tip = $('.setting-help');
  assert.ok(tip, 'the settings carry help');
  assert.equal(tip.getAttribute('tabindex'), '0');
  assert.ok(tip.getAttribute('aria-label'));
  assert.equal(tip.querySelector('[role=tooltip]').textContent, tip.getAttribute('aria-label'));
  assert.equal(tip.getAttribute('title'), null);
  wizardAt(3, {}, { goal: 'timed' });
  const phaseTime = $('select[name=phaseTime]').closest('label').querySelector('[role=tooltip]');
  assert.match(phaseTime.textContent, /final phase/, 'the target-time choice is explained');
});

test('moving between steps reads the step being left, and Review calculates', async () => {
  wizardAt(1);
  $('input[name=saveName]').value = 'Edited world';
  $('select[name=purity]').value = 'pure';
  await click('[data-wizard-step="2"]');
  assert.equal(wizard.step, 2);
  assert.equal(wizard.saveName, 'Edited world');
  assert.equal(wizard.settings.limits['Iron Ore'], 152400, 'a new purity brings its budgets');
  assert.equal(wizard.preview, null);
  $('input[name=utilityPercent]').value = '35';
  $('input[name=somersloops]').value = '104';
  $('input[name=sloop][value=shards]').checked = true;
  const calls = stubFetch({ '/api/preview': generated() });
  await click('[data-wizard-step="5"]');
  assert.equal(calls.length, 1, 'jumping to Review calculates');
  assert.equal(calls[0][1].settings.utilityPercent, 35, 'with the step it left');
  assert.equal(calls[0][1].settings.somersloops, 104);
  assert.deepEqual(calls[0][1].settings.sloopReserved, ['shards']);
  assert.equal(wizard.step, 5);
  assert.equal($('#main h2').textContent, 'Review Balanced progression', 'named after the goal');
  assert.equal($$('#main tbody tr').length, 3, 'the phases from the start phase on');
  // Back steps without validating; Continue moves on.
  await click('[data-wizard-back]');
  assert.equal(wizard.step, 4);
  await click('[data-wizard-step="3"]');
  await submit();
  assert.equal(wizard.step, 4, 'Enter or Continue moves on');
});

test('a failed calculation says why in the form and gives the button back', async () => {
  wizardAt(4);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Calculation timed out. Try fewer alternates.' }), {
      status: 500,
    });
  await submit();
  assert.equal(wizard.step, 4, 'the draft stays where it was');
  assert.match(text('#wizard-error'), /timed out/);
  assert.match(text('#wizard-error'), /Planner’s choice/, 'with ways to get a plan');
  assert.match(text('#wizard-error'), /whole-machine production/);
  const b = $('#wizard-form button[type=submit]');
  assert.equal(b.textContent, 'Calculate plan');
  assert.equal(b.disabled, false);
  // Another step clears the error line.
  await click('[data-wizard-step="3"]');
  assert.equal(text('#wizard-error'), '');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: evil }), { status: 500 });
  await click('[data-wizard-step="5"]');
  noMarkup();
  assert.equal($('#wizard-error').textContent, evil, 'other errors are plain text');
});

test('recipe access, preferred power and ingots redraw the step', async () => {
  wizardAt(2);
  assert.equal($('.alt-picker'), null, 'standard recipes need no picker');
  await change('select[name=recipes]', 'custom');
  assert.equal(wizard.settings.recipes, 'custom');
  assert.ok($('.alt-picker'), 'picking specific alternates shows the picker');
  await change('select[name=recipes]', 'standard');
  assert.equal($('.alt-picker'), null);
});

test('the alternate picker ticks, forces, filters and shows each recipe', async () => {
  const RIP = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
  const box = id => $(`input[name=alt][value="${id}"]`);
  const star = id => $(`input[name=altpref][value="${id}"]`);
  wizardAt(2, {}, { recipes: 'custom', alternateRecipes: [RIP] });
  assert.ok(box(RIP).checked, 'picked alternates are pre-checked');
  assert.match(main(), /Stitched Iron Plate/);
  assert.match(main(), /MAM research/, 'MAM-researched recipes are labelled');
  assert.ok(box('Recipe_Alternate_Turbofuel_C'), 'MAM recipes are picks with neutral power');
  assert.ok(box('Recipe_Alternate_PureIronIngot_C'), 'pure recipes are picks by default');
  assert.doesNotMatch(main(), /Charcoal/, 'recipes beyond Phase 5 are not offered');
  assert.match(text('.alt-picker-head b'), /1 selected/);
  assert.equal(star(RIP).disabled, false, 'a picked row can be forced');
  assert.equal(star('Recipe_Alternate_Screw_C').disabled, true, 'an unpicked one cannot');
  // Ticks and stars are the picker's own until the step is read.
  await change(`input[name=alt][value="Recipe_Alternate_Screw_C"]`, true);
  assert.match(text('.alt-picker-head b'), /2 selected/);
  assert.equal(star('Recipe_Alternate_Screw_C').disabled, false);
  await change(`input[name=altpref][value="${RIP}"]`, true);
  await change(`input[name=alt][value="${RIP}"]`, false);
  assert.equal(star(RIP).checked, false, 'unticking a recipe drops its star');
  assert.equal(star(RIP).disabled, true);
  // The filter hides rows in place; Select all and Clear all apply to what it shows.
  const filter = $('#alt-filter');
  filter.value = 'iron plate';
  filter.dispatchEvent(new Event('input'));
  await nextTick();
  const shown = $$('.alt-row:not([hidden])');
  assert.ok(shown.length > 0 && shown.length < $$('.alt-row').length);
  await click('[data-alt-all]');
  for (const row of shown) {
    const b = row.querySelector('input[name=alt]');
    if (b) assert.ok(b.checked, row.dataset.altText);
  }
  assert.equal(box('Recipe_Alternate_Screw_C').checked, true, 'a hidden row keeps its tick');
  assert.equal(box('Recipe_Alternate_Turbofuel_C').checked, false, 'and a hidden row gets none');
  await click('[data-alt-none]');
  for (const row of shown)
    assert.equal(row.querySelector('input[name=alt]')?.checked ?? false, false);
  // Reading the step takes exactly what the screen shows.
  await click('[data-wizard-step="1"]');
  assert.deepEqual(wizard.settings.alternateRecipes, ['Recipe_Alternate_Screw_C']);
  // "recipe ↗" compares the alternate with the standard recipe.
  wizardAt(2, {}, { recipes: 'custom' });
  await click(`[data-alt-info="${RIP}"]`);
  assert.ok($('#detail').open);
  assert.equal($('#detail h2').textContent, 'Stitched Iron Plate');
  assert.ok($('#detail .rail-recipe'), 'the pop-out shows the recipe card');
  assert.match(text('#detail'), /Standard recipe for Reinforced Iron Plate/);
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

test('Planner’s choice ticks the alternates the planner uses', async () => {
  wizardAt(2, {}, { recipes: 'custom', alternateRecipes: [] });
  const calls = stubFetch({ '/api/preview': generated() });
  await click('[data-alt-best]');
  assert.equal(calls[0][1].settings.recipes, 'all', 'calculated with every alternate allowed');
  assert.deepEqual(wizard.settings.alternateRecipes, [
    'Recipe_Alternate_EnrichedCoal_C',
    'Recipe_Alternate_Turbofuel_C',
  ]);
  assert.ok($('input[name=alt][value="Recipe_Alternate_Turbofuel_C"]').checked, 'and shown');
  assert.match($('#toast').textContent, /Selected 2 alternate recipes/);
  assert.equal($('[data-alt-best]').textContent.trim(), 'Planner’s choice');
  assert.equal($('[data-alt-best]').disabled, false);
});

test('the somersloop ledger totals what the plan commits', () => {
  wizardAt(
    2,
    {},
    { somersloops: 104, augmenters: 1, fueledAugmenters: 1, sloopReserved: ['shards'] },
  );
  assert.equal($$('input[name=sloop]').length, 3);
  assert.ok($('input[name=sloop][value=shards]').checked);
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
  const rate = n => $(`input[name="rate:${n}"]`);
  assert.equal($('input[name=buildRate]').value, '30');
  assert.equal($('input[name=storageRate]').value, '1');
  assert.ok($('details.rate-picker').open, 'open while any override is set');
  assert.match(text('.rate-picker summary'), /1 set/);
  assert.equal(rate('Concrete').value, '60');
  assert.equal(rate('Screws').value, '');
  assert.equal(rate('Iron Plate').placeholder, '30', 'construction follows the build rate');
  assert.equal(rate('Screws').placeholder, '1', 'the rest the general rate');
  assert.equal(rate('Nuclear Pasta').placeholder, '0', 'delivered parts start at zero');
  assert.equal(rate('Concrete').closest('.rate-row').dataset.rateGroup, 'build');
  assert.equal(rate('Nuclear Pasta').closest('.rate-row').dataset.rateGroup, 'delivered');
  assert.equal(rate('Screws').closest('.rate-row').dataset.rateGroup, 'other');
  // Typing a group rate refreshes the placeholders it applies to.
  const type = async (name, value) => {
    const el = $(`input[name=${name}]`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  };
  // A per-item rate typed but not read yet survives the placeholders and the filter redrawing
  // the list.
  rate('Screws').value = '7';
  await type('buildRate', '45');
  assert.equal(rate('Screws').value, '7', 'typing is not reset by a redraw');
  assert.equal(rate('Iron Plate').placeholder, '45');
  assert.equal(rate('Screws').placeholder, '1', 'the general boxes are untouched');
  assert.equal(rate('Nuclear Pasta').placeholder, '0');
  await type('storageRate', '4');
  assert.equal(rate('Screws').placeholder, '4');
  assert.equal(rate('Iron Plate').placeholder, '45');
  await type('buildRate', '');
  assert.equal(rate('Iron Plate').placeholder, '4', 'an empty build rate falls back');
  await type('storageRate', '');
  assert.equal(rate('Screws').placeholder, '4', 'a half-typed rate keeps the last one');
  // The filter hides rows in place.
  const filter = $('#rate-filter');
  filter.value = 'screw';
  filter.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(rate('Concrete').closest('.rate-row').hidden, true);
  assert.equal(rate('Screws').closest('.rate-row').hidden, false);
  assert.equal(rate('Screws').value, '7');
  assert.equal(rate('Concrete').value, '60');
  // The list follows the selected storage supply.
  wizardAt(2, {}, { storage: 'construction' });
  assert.ok(rate('Concrete'));
  assert.equal(rate('Ballistic Warp Drive'), null, 'items outside the contract are not listed');
  wizardAt(2, {}, { storage: 'none' });
  assert.equal($('.rate-list'), null, 'no dedicated storage, no rates');
});

test('the goals step and what Review says about each phase', () => {
  wizardAt(3, {}, { goal: 'timed', hours: 10 });
  assert.equal($('select[name=phaseTime]').value, 'every', 'every phase is the default');
  assert.ok($('input[name=goal][value=timed]').checked);
  assert.equal($('input[name=profileName]').value, 'Target completion time', 'the goal’s name');
  wizardAt(3, {}, { goal: 'timed', phaseTime: 'final', multiplier: 10 });
  assert.equal($('select[name=phaseTime]').value, 'final');
  assert.match(text('.goal-card:has(input[value=timed])'), /Suggested/);
  const p = generated();
  wizardAt(5, {
    preview: {
      ...p,
      settings: { ...p.settings, phase: '1' },
      stages: { ...p.stages, 1: { ...p.stages[1], hours: 5.21, aheadOf: 9.92 } },
    },
  });
  assert.match(main(), /was 9[.,]92 h/, 'a pulled-forward phase shows what it used to take');
  wizardAt(5);
  assert.doesNotMatch(main(), /was /);
  // Review flags only the phases the profile plans.
  wizardAt(5, {
    preview: {
      ...p,
      settings: { ...p.settings, phase: '4' },
      stages: {
        ...p.stages,
        3: { feasible: false, reason: 'Earlier phase shortfall' },
        5: { feasible: false, reason: evil, shortfalls: [{ name: 'Coal', needed: 10, budget: 5 }] },
      },
    },
  });
  noMarkup();
  assert.doesNotMatch(main(), /Earlier phase shortfall/, 'a phase behind the start');
  assert.ok(main().includes('Phase 5: ' + evil), 'a phase it plans');
  assert.match(main(), /Raise the short budget/, 'with its options');
});

test('Review credits production you already run, and says nothing for an older plan', () => {
  const p = generated();
  wizardAt(5);
  assert.equal($('.supply-notice'), null, 'nothing declared, nothing credited');
  const older = generated();
  delete older.settings.existingSupply;
  for (const st of Object.values(older.stages)) delete st.supplied;
  wizardAt(5, { preview: older });
  assert.equal($('.supply-notice'), null, 'a plan from before the question');
  wizardAt(5, {
    preview: {
      ...p,
      settings: { ...p.settings, existingSupply: { 'Modular Frame': 50, Plastic: 5 } },
      stages: { ...p.stages, 4: { ...p.stages[4], supplied: { 'Modular Frame': 20 } } },
    },
  });
  assert.match(text('.supply-notice'), /Modular Frame 50\/min declared · the plan draws up to 20/);
  assert.match(text('.supply-notice'), /Plastic 5\/min declared · this plan has no use for it/);
});

test('adding a profile to a save offers to carry its progress, hostile names and all', async () => {
  wizardAt(5, { saveId: 's', carryFrom: 'p' });
  noMarkup();
  assert.ok($('.carry-list'));
  const from = $('select[name=carryFrom]');
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
    assert.ok($(`input[name=carry][value=${key}]`).checked, key + ' is carried by default');
  assert.equal(
    $('input[name=carry][value=picked]'),
    null,
    'no recipe picks without custom recipes',
  );
  const p = generated();
  wizardAt(5, {
    saveId: 's',
    carryFrom: 'p',
    preview: {
      ...p,
      settings: {
        ...p.settings,
        recipes: 'custom',
        alternateRecipes: ['Recipe_Alternate_Screw_C'],
      },
    },
  });
  assert.ok($('input[name=carry][value=picked]').checked, 'hand-picked recipes can be claimed');
  assert.match(text('input[value=picked] + span'), /\(1\)/);
  wizardAt(5);
  assert.equal($('.carry-list'), null, 'a brand new save has nothing to carry');
});

test('creating the profile opens it and says what was carried', async () => {
  wizardAt(5, { saveId: 's', carryFrom: 'p', name: 'Third' });
  $('input[name=carry][value=notes]').checked = false;
  const calls = stubFetch({
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
  const body = calls.find(([path]) => path === '/api/profiles')[1];
  assert.equal(body.name, 'Third');
  assert.equal(body.carryFrom, 'p');
  assert.equal(body.carry.notes, false, 'the unticked record is left behind');
  assert.equal(body.carry.storage, true);
  assert.deepEqual(body.built, []);
  assert.equal(wizard, null, 'the draft is done');
  assert.equal(view, 'plan');
  assert.match($('#toast').textContent, /Profile created: 2 steps carried over\./);
});

test('a failed create leaves the draft and says why', async () => {
  wizardAt(5);
  stubFetch({});
  await submit();
  assert.ok(wizard, 'nothing was created');
  assert.match($('#wizard-error').textContent, /unexpected \/api\/profiles/);
  const b = $('#wizard-form button[type=submit]');
  assert.equal(b.textContent, 'Create profile');
  assert.equal(b.disabled, false);
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
    assert.match($('[data-guided-advanced]').dataset.guidedAdvanced, /^[1-4]$/);
    assert.equal($('[data-guided-advanced]').dataset.guidedAdvanced, String(flow[step - 1].step));
    assert.equal($$('.guided-progress [role=listitem]').length, flow.length);
    assert.equal($('.guided-progress .current').textContent, flow[step - 1].short);
    assert.equal(
      $('#wizard-form button[type=submit]').textContent.trim(),
      step === flow.length ? 'Calculate plan' : 'Continue →',
    );
    assert.equal(!!$('[data-cancel-wizard]'), step === 1, 'the first screen cancels');
  }
  guidedAt(1);
  assert.equal($('[data-guided-advanced]').dataset.guidedAdvanced, '1');
  guidedAt(flow.findIndex(q => q.id === 'goal') + 1);
  assert.equal($('[data-guided-advanced]').dataset.guidedAdvanced, '3');
});

test('an answer redraws the question, and All settings keeps it', async () => {
  guidedAt(1);
  const at = guidedFlow().findIndex(q => q.id === 'goal') + 1;
  guidedAt(at, { saveName: evil });
  noMarkup();
  assert.equal($('input[name=saveName]').value, evil);
  assert.equal($('input[name=hours]'), null, 'hours only for a timed goal');
  await change('input[name="guided:goal"][value=timed]', true);
  assert.equal(wizard.settings.goal, 'timed');
  assert.ok(
    $('input[name="guided:goal"][value=timed]')
      .closest('.guided-card')
      .classList.contains('is-picked'),
  );
  assert.ok($('input[name=hours]'), 'a timed goal asks for its hours');
  await click('[data-guided-advanced]');
  assert.equal(wizard.mode, 'advanced');
  assert.equal(wizard.step, 3, 'lands on the step that owns the question');
  assert.ok($('input[name=goal][value=timed]').checked, 'the answer survives the switch');
  await click('[data-guided-start]');
  assert.equal(wizard.mode, 'guided');
  assert.ok($('.guided-progress'), 'and the guided start comes back');
});

test('Continue walks the questions and Back returns', async () => {
  guidedAt(1);
  await submit();
  assert.equal(wizard.guidedStep, 2);
  assert.ok($('[data-guided-back]'));
  await click('[data-guided-back]');
  assert.equal(wizard.guidedStep, 1);
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
  assert.equal(wizard.step, 5);
  assert.equal(vuePage('wizard', null, wizard), WizardPage);
  assert.match($('#main h2').textContent, /^Review /);
});

test('a second profile for a save is asked what changed, naming the profile safely', async () => {
  guidedAt(1, { saveId: 's', saveName: evil, carryFrom: 'p' });
  noMarkup();
  assert.ok($('.guided-topics'), 'the topic picker comes first');
  assert.equal($('.guided-progress'), null);
  assert.ok(main().includes('Starting from the settings of ' + evil));
  assert.ok($('.guided-known'), 'with the settings it keeps');
  assert.equal($('input[name=topic][value=phase]').checked, true);
  assert.equal($('input[name=saveName]'), null, 'no name box on this screen');
  wizard.guidedAsk = ['phase'];
  await redraw();
  assert.ok($('.guided-card'), 'choosing only the phase asks only the phase');
  assert.equal($('input[name=profileName]').placeholder, 'Named after your goal if left blank');
});

test('ticking topics keeps the "what is different" screen; Continue asks exactly those', async () => {
  guidedAt(1, { saveId: 's', saveName: 'World', carryFrom: 'p' });
  await change('input[name=topic][value=phase]', false);
  await change('input[name=topic][value=goal]', true);
  await change('input[name=topic][value=exact]', true);
  assert.ok($('.guided-topics'), 'still on the topic picker after ticking');
  assert.equal(wizard.guidedAsk, null, 'nothing is applied before Continue');
  await redraw();
  const ticked = () => $$('input[name=topic]:checked').map(el => el.value);
  assert.deepEqual(ticked(), ['goal', 'exact'], 'the ticks survive a redraw');
  await submit();
  assert.deepEqual(
    guidedFlow().map(q => q.id),
    ['goal', 'exact'],
  );
  assert.equal(wizard.guidedStep, 1);
  assert.equal($('.guided-topics'), null);
  assert.ok($('input[name="guided:goal"]'), 'the first chosen question is on screen');
  assert.equal($$('.guided-progress [role=listitem]').length, 2);
});

test('the already-running question asks for a rate, with an item search we own', async () => {
  guidedAt(1);
  const at = guidedFlow().findIndex(q => q.id === 'supply') + 1;
  guidedAt(at);
  assert.ok($('.supply-list'));
  assert.equal($('.guided-card'), null, 'no cards to pick from');
  assert.equal($('input[name=supplyItem]').placeholder, 'Search item');
  assert.equal($('input[name=supplyRate]').placeholder, '', 'the rate carries no example');
  assert.equal($('datalist'), null, 'suggestions are drawn in the page');
  assert.equal($('.supply-options').getAttribute('role'), 'listbox');
  assert.equal($$('input[name=supplyItem]').length, 1, 'one blank row to start');
  guidedAt(at, {}, { existingSupply: { 'Modular Frame': 50 } });
  assert.equal($$('input[name=supplyItem]').length, 2, 'the declared line plus a blank row');
  assert.equal($('input[name=supplyItem]').value, 'Modular Frame');
  assert.equal($('input[name=supplyRate]').value, '50');
  assert.ok($('[data-supply-remove="0"]'));
  assert.match(main(), /builds only the remainder/i);
  assert.match(main(), /net of them/i);
  // All settings step 1 has the same rows.
  wizardAt(1, {}, { existingSupply: { 'Modular Frame': 50 } });
  assert.ok($('.supply-list'));
  assert.equal($('input[name=supplyItem]').value, 'Modular Frame');
});

// --- Production you already run ---

const supplyAt = (rows, settings = {}) => {
  wizardAt(1, rows ? { supplyRows: rows } : {}, settings);
};

test('a half-finished row survives, and says plainly why it does not count', async () => {
  supplyAt([{ name: 'Modular Frame', rate: '' }]);
  assert.equal($('input[name=supplyItem]').value, 'Modular Frame');
  assert.match(text('.supply-hint'), /Add a rate and this line is credited/);
  supplyAt([{ name: 'Modul', rate: '12' }]);
  assert.match(text('.supply-hint'), /No item of that name/);
  assert.ok($('.supply-hint').classList.contains('warn'));
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
  assert.equal(removes[0].getAttribute('aria-label'), 'Remove Computer');
  assert.equal(removes[1].getAttribute('tabindex'), '-1', 'and it is inert');
  assert.equal(removes[1].getAttribute('aria-hidden'), 'true');
  assert.equal($('.supply-spacer'), null);
});

test('a chosen item shows its icon, and the icon follows the typing', async () => {
  supplyAt(null, { existingSupply: { 'Modular Frame': 50 } });
  const wraps = $$('.supply-input');
  assert.ok(wraps[0].classList.contains('has-icon'));
  assert.equal(wraps[0].dataset.icon, 'Modular Frame');
  assert.equal(wraps[0].firstElementChild.getAttribute('src'), './icons/modular-frame.png');
  assert.equal(wraps[1].dataset.icon, '', 'the blank row has none');
  assert.equal($$('.has-icon').length, 1);
  const blank = $$('input[name=supplyItem]')[1];
  blank.value = 'Computer';
  blank.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.equal($$('.supply-input')[1].dataset.icon, 'Computer', 'shown while typing');
});

test('the item search works from the keyboard', async () => {
  supplyAt();
  const input = () => $('input[name=supplyItem]');
  const key = async k => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
    await nextTick();
  };
  input().value = 'frame';
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  const options = () => $$('.supply-option');
  assert.ok(options().length > 1);
  assert.ok(options().some(o => o.textContent.trim() === 'Modular Frame'));
  assert.equal($('.supply-options').hidden, false);
  assert.equal(input().getAttribute('aria-expanded'), 'true');
  await key('Escape');
  assert.equal($('.supply-options').hidden, true, 'Escape closes');
  assert.equal(input().value, 'frame', 'and what was typed stays');
  await key('ArrowDown');
  assert.equal($('.supply-options').hidden, false, '↓ opens it again');
  await key('ArrowDown');
  assert.equal(options()[0].getAttribute('aria-selected'), 'true');
  await key('ArrowUp');
  assert.equal(options().at(-1).getAttribute('aria-selected'), 'true', '↑ wraps round');
  const chosen = options().at(-1).textContent.trim();
  await key('Enter');
  await settle();
  assert.equal(wizard.supplyRows[0].name, chosen, 'Enter picks it');
  assert.equal(input().value, chosen);
  assert.equal(document.activeElement, $('input[name=supplyRate]'), 'and moves to the rate');
  assert.equal($$('.supply-row').length, 2, 'with a fresh blank row');
  // A rate, once committed, is credited.
  await change('input[name=supplyRate]', '12');
  assert.deepEqual(wizard.settings.existingSupply, { [chosen]: 12 });
  // A click picks too.
  const second = $$('input[name=supplyItem]')[1];
  second.value = 'comp';
  second.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  $$('.supply-option')[0].click();
  await settle();
  assert.equal(wizard.supplyRows[1].name, $$('input[name=supplyItem]')[1].value);
  // Remove drops the row and its credit.
  await click('[data-supply-remove="0"]');
  assert.deepEqual(wizard.settings.existingSupply, {});
  assert.equal(wizard.supplyRows.length, 1);
});
