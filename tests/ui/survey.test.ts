// The wizard's node survey (ui/pages/SurveyPage.vue and ui/survey/), mounted through render()
// the way the app mounts it. The survey maths and presets are tested in tests/guided.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  blankExtraction,
  distributions,
  matchingPreset,
  minedResources,
  nodeCounts,
  presetSurvey,
  purities,
  richShape,
} from '../../public/preferences.ts';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, catalog, generated, go, open, page } from './setup.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';

const text = (s: string) => $(s)!.textContent.replace(/\s+/g, ' ');
const main = () => text('#main');

// The survey for the default world: the wiki's node counts.
const defaultSurvey = () => {
  const e = blankExtraction();
  for (const [name, [impure, normal, pure]] of Object.entries(nodeCounts))
    (name === 'Nitrogen Gas' ? e.wells : e.nodes)[name] = { impure, normal, pure };
  return e;
};

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
});

// A draft in the survey at `step`, opened from All settings step 4, with `settings` over a
// calculated plan's settings. `draft` fields override the rest.
function survey(
  step: number,
  settings: Partial<WizardSettings> = {},
  draft: Partial<WizardDraft> = {},
) {
  // A partial draft (no usedGuided, a return without its guidedStep), as the tests have
  // always opened it.
  setWizard({
    step: 4,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: null,
    carryFrom: null,
    carry: {},
    mode: 'extraction',
    extractionStep: step,
    extractionReturn: { mode: 'advanced', step: 4 },
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    ...draft,
  } as WizardDraft);
  go('wizard');
  render();
}

const redraw = async () => {
  render();
  await nextTick();
};
const click = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await nextTick();
};
const change = async (selector: string, value: string) => {
  const el = $<HTMLInputElement | HTMLSelectElement>(selector)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
};

test('the survey has four screens as tabs and links to the map', async () => {
  survey(1);
  const tabs = $$('.wizard-progress [data-extraction-step]');
  assert.deepEqual(
    tabs.map(b => b.textContent.trim()),
    ['1. How you mine', '2. Ore nodes', '3. Resource wells', '4. Your budgets'],
  );
  assert.equal($('.guided-progress'), null, 'the wizard tabs, not the guided dots');
  assert.equal(tabs[0]!.getAttribute('aria-current'), 'step');
  assert.ok(tabs[0]!.classList.contains('current'));
  assert.equal(tabs[1]!.getAttribute('aria-current'), null);
  assert.ok($('#wizard-form.extraction-panel'));
  // Where the numbers come from, and that uploading a save is the user's call.
  assert.equal(
    $('#main a[target=_blank]')!.getAttribute('href'),
    'https://satisfactory-calculator.com/en/interactive-map',
  );
  assert.match(main(), /upload your save/i);
  assert.match(main(), /never sends your save anywhere/i);
  assert.ok($('select[name=mark]') && $('select[name=clock]'));
  assert.equal($('[data-extraction-back]')!.textContent.trim(), 'Cancel');
  assert.equal($('[data-extraction-cancel]'), null, 'nothing to leave alone yet');
  // Ten ores, three purities each, with their icons.
  wizard!.extractionStep = 2;
  await redraw();
  assert.equal($$('input[name^="node:"][name$=":pure"]').length, minedResources.length);
  assert.ok($('img[src="./icons/iron-ore.png"]'));
  assert.match(main(), /Zero means zero/);
  assert.match(main(), /the plan cannot mine/);
  // A zero count means none of that purity, not the unallocated budget of a rich map.
  assert.doesNotMatch(main(), /unallocated, not absent/);
  assert.equal($('[data-extraction-back]')!.textContent.trim(), 'Back');
  // Oil nodes and wells are asked separately, and water is explained rather than asked.
  wizard!.extractionStep = 3;
  await redraw();
  assert.ok($('input[name="node:Crude Oil:pure"]'));
  assert.ok($('input[name="well:Crude Oil:pure"]'));
  assert.ok($('input[name="well:Nitrogen Gas:pure"]'));
  assert.equal($('input[name^="node:Water"]'), null, 'water is not counted');
  assert.match(main(), /Water is not counted/);
  assert.ok($('select[name=purity]'), 'the world settings are on the oil screen too');
  // The last screen totals it and takes off what is committed.
  wizard!.extractionStep = 4;
  await redraw();
  assert.ok($('input[name="used:Iron Ore"]'));
  assert.equal($('#wizard-form button[type=submit]')!.textContent.trim(), 'Use these budgets');
});

test('jumping between screens keeps what was typed, and a tab never applies it', async () => {
  survey(2, { purity: 'vanilla', distribution: 'original' });
  // Typed, not yet committed with a change event.
  $<HTMLInputElement>('input[name="node:Iron Ore:pure"]')!.value = '46';
  await click('[data-extraction-step="4"]');
  assert.equal(wizard!.extractionStep, 4, 'jumped straight to the last screen');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 46, 'and read the screen it left');
  await click('[data-extraction-step="2"]');
  assert.equal(wizard!.extractionStep, 2, 'and back again');
  assert.equal($<HTMLInputElement>('input[name="node:Iron Ore:pure"]')!.value, '46');
  assert.ok(!wizard!.settings.extraction, 'no tab click has applied the survey');
  await click('[data-extraction-step="2"]');
  assert.equal(wizard!.extractionStep, 2, 'clicking the current tab is a no-op');
});

test('a committed count updates its total, and the budgets take off what is committed', async () => {
  survey(2, { purity: 'vanilla', distribution: 'original' });
  const row = () =>
    $$('.count-row').find(r => r.querySelector('.count-name')!.textContent === 'Iron Ore');
  const before = row()!.querySelector('.count-total')!.textContent;
  await change('input[name="node:Iron Ore:pure"]', '0');
  await change('input[name="node:Iron Ore:normal"]', '0');
  await change('input[name="node:Iron Ore:impure"]', '0');
  assert.notEqual(before, '—');
  assert.equal(row()!.querySelector('.count-total')!.textContent, '—', 'no nodes, no rate');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore'], undefined, 'an all-zero row is dropped');
  // Iron now has no nodes, so the budgets screen names it.
  wizard!.extractionStep = 4;
  await redraw();
  assert.match(text('#main .notice'), /One resource has no nodes entered: Iron Ore\./);
  const copper = () =>
    $$('#main tbody tr').find(
      r => r.querySelector('.resource-name span')!.textContent === 'Copper Ore',
    );
  const pool = Number(copper()!.querySelectorAll('td')[1]!.textContent.replace(/\D/g, ''));
  await change('input[name="used:Copper Ore"]', String(pool + 1));
  assert.equal(wizard!.extraction!.used!['Copper Ore'], pool + 1);
  assert.equal(copper()!.querySelectorAll('td')[3]!.textContent, '0', 'nothing is left');
  assert.ok(copper()!.querySelectorAll('td')[3]!.classList.contains('warn'), 'over the pool');
});

test('an unsurveyed resource is called out on the budgets screen, a complete survey is not', async () => {
  const partial = blankExtraction();
  partial.nodes = { 'Iron Ore': { impure: 39, normal: 42, pure: 46 } };
  survey(4, {}, { extraction: partial });
  const notice = $$('#main .notice').find(n => /no nodes entered/.test(n.textContent))!;
  assert.equal(notice.querySelector('b')!.textContent, '11 resources have no nodes entered:');
  assert.match(notice.textContent, /Copper Ore/);
  assert.doesNotMatch(notice.textContent, /Iron Ore/, 'the one that was surveyed is not listed');
  assert.match(notice.textContent, /go back and fill them in/);
  // A complete survey says nothing.
  wizard!.extraction = defaultSurvey();
  await redraw();
  assert.doesNotMatch(main(), /no nodes entered/);
  // An all-pure world is a complete survey, zeros and all.
  const allPure = blankExtraction();
  for (const [name, [i, n, p]] of Object.entries(nodeCounts))
    (name === 'Nitrogen Gas' ? allPure.wells : allPure.nodes)[name] = {
      impure: 0,
      normal: 0,
      pure: i + n + p,
    };
  wizard!.extraction = allPure;
  await redraw();
  assert.doesNotMatch(main(), /no nodes entered/, 'zero impure and zero normal is an answer');
});

test('the survey asks the two World Randomization settings and fills what it can', async () => {
  survey(2, { purity: 'vanilla', distribution: 'original' });
  // The same pair the game shows, with the same options in the same order.
  assert.match(main(), /Resource node randomization/);
  assert.match(main(), /Resource node purity/);
  assert.deepEqual(
    $$('select[name=distribution] option').map(o => o.textContent),
    distributions.map(([, l]) => l),
  );
  assert.deepEqual(
    $$('select[name=purity] option').map(o => o.textContent),
    purities.map(([, l]) => l),
  );
  assert.equal($<HTMLSelectElement>('select[name=purity]')!.value, 'vanilla');
  // Opening the survey with a known world starts from it rather than from blank.
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.normal, 42, 'prefilled from the purity');
  assert.match(text('.node-presets'), /counts below are the map's node totals at Default\./);
  // Choosing another known world on screen refills the counts and names it.
  await change('select[name=purity]', 'pure');
  assert.equal(wizard!.settings.purity, 'pure', 'written to the settings at once');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 127);
  assert.equal($<HTMLInputElement>('input[name="node:Iron Ore:pure"]')!.value, '127', 'and shown');
  assert.match(text('.node-presets'), /node totals at All Pure\./);
});

test('a refill over hand-typed counts can be undone', async () => {
  survey(2, { purity: 'vanilla', distribution: 'original' });
  await change('input[name="node:Iron Ore:pure"]', '3');
  await change('select[name=purity]', 'pure');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 127, 'refilled');
  assert.equal($('[data-node-undo]')!.textContent!.trim(), 'Undo refill');
  assert.match(text('.node-presets'), /Your typed counts were replaced/);
  await click('[data-node-undo]');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 3, 'the typed count is back');
  assert.equal(wizard!.extractionUndo, null, 'and the undo spent');
  assert.match($('#toast')!.textContent!, /counts you typed/);
});

test('a refill keeps an earlier undo, and offers none when nothing was typed', async () => {
  // Reset, then refill: the reset's undo still brings back the counts from before it.
  survey(2, { purity: 'vanilla', distribution: 'original' });
  await click('[data-node-reset]');
  await change('select[name=purity]', 'pure');
  assert.equal($('[data-node-undo]')!.textContent!.trim(), 'Undo reset');
  await click('[data-node-undo]');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.normal, 42, 'the Default counts are back');
  // A blank survey (a world with no table) set to a known one: nothing typed, nothing to undo.
  page();
  open({ workspace: { catalog: catalog() } });
  survey(2, { purity: 'random', distribution: 'original' });
  await change('select[name=purity]', 'pure');
  assert.ok(!wizard!.extractionUndo, 'no undo');
  assert.ok($('[data-node-reset]'));
  // Typed, then two refills in a row (arrowing through the select): the typed counts survive.
  page();
  open({ workspace: { catalog: catalog() } });
  survey(2, { purity: 'vanilla', distribution: 'original' });
  await change('input[name="node:Iron Ore:pure"]', '3');
  await change('select[name=purity]', 'pure');
  await change('select[name=purity]', 'mostly-impure');
  assert.equal($('[data-node-undo]')!.textContent!.trim(), 'Undo refill');
  await click('[data-node-undo]');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 3);
});

test('an edit after a reset drops its undo, so undoing cannot throw the edit away', async () => {
  survey(2, { purity: 'vanilla', distribution: 'original' });
  await click('[data-node-reset]');
  assert.ok($('[data-node-undo]'));
  await change('input[name="node:Copper Ore:pure"]', '50');
  assert.equal($('[data-node-undo]'), null, 'no undo left to press');
  assert.ok($('[data-node-reset]'));
  assert.equal(wizard!.extraction!.nodes!['Copper Ore']!.pure, 50, 'the typed count stays');
});

test('a world with no table says why, and fills nothing', async () => {
  // A purity with no fixed layout.
  survey(2, { purity: 'random', distribution: 'original' });
  assert.match(main(), /No preset for these settings/);
  assert.match(main(), /no fixed split to rearrange/);
  assert.equal(JSON.stringify(wizard!.extraction!.nodes), '{}', 'nothing is invented');
  // A resource-rich distribution describes its direction, never numbers.
  for (const d of ['basic', 'advanced', 'fossil'] as const) {
    page();
    open({ workspace: { catalog: catalog() } });
    survey(2, { purity: 'pure', distribution: d });
    assert.match(main(), /No preset for these settings/, d);
    assert.match(main(), /a third apart from one seed to the next/, d);
    assert.ok(main().includes(richShape[d]!), d + ' shape shown');
    assert.match(main(), /Which way it goes is consistent; how far is not/, d);
    assert.equal(JSON.stringify(wizard!.extraction!.nodes), '{}', d + ' fills nothing');
  }
  // Counts already on screen under a world with no table are flagged as the default
  // world's rather than passed off as the user's.
  wizard!.extraction = presetSurvey('pure', wizard!.extraction);
  await redraw();
  assert.match(main(), /still the map's totals at All Pure, so check them/);
});

test('Random with a uniform purity fills in; with the map’s own split it says what is missing', async () => {
  survey(2, { purity: 'pure', distribution: 'randomized' });
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 127, 'the shuffle-proof totals');
  assert.match(main(), /node totals at All Pure\. Random moves nodes around the map/);
  assert.match(main(), /Nitrogen wells are left for you/);
  assert.equal(JSON.stringify(wizard!.extraction!.wells), '{}', 'nitrogen not filled');
  page();
  open({ workspace: { catalog: catalog() } });
  survey(2, { purity: 'vanilla', distribution: 'randomized' });
  assert.match(main(), /Only the purity split is missing/);
  assert.match(main(), /same number of nodes for each resource as the default map/);
  assert.match(main(), /If you actually chose All Pure, Average or All Impure/);
  assert.equal(JSON.stringify(wizard!.extraction!.nodes), '{}', 'so nothing is filled in');
});

test('the survey can be emptied and put back, so a hand counter never corrects a preset', async () => {
  const filled = presetSurvey('pure', { mark: 2, clock: 1 }, 'original');
  filled.used = { 'Iron Ore': 500 };
  survey(2, { purity: 'pure', distribution: 'original' }, { extraction: filled });
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 127, 'starts filled');
  assert.ok($('[data-node-reset]'));
  wizard!.extractionStep = 3;
  await redraw();
  assert.ok($('[data-node-reset]'), 'offered on both counting screens');
  // No confirm(): a browser told to block this page's dialogs would answer false without
  // showing one, and the button would do nothing.
  await click('[data-node-reset]');
  assert.equal(
    JSON.stringify(wizard!.extraction),
    JSON.stringify({ mark: 2, clock: 1, nodes: {}, wells: {}, used: {} }),
    'emptied but still Mk.2 at 100%',
  );
  assert.equal(matchingPreset(wizard!.extraction), '');
  assert.match(main(), /Fill in the counts below/, 'an empty survey can be filled again');
  assert.equal(
    $<HTMLInputElement>('input[name="node:Crude Oil:pure"]')!.value,
    '0',
    'the inputs show it',
  );
  assert.ok($('[data-node-undo]'), 'undo offered');
  assert.equal($('[data-node-reset]'), null, 'and not both at once');
  await click('[data-node-undo]');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 127, 'put back');
  assert.equal(wizard!.extraction!.used!['Iron Ore'], 500, 'including what was committed');
  assert.equal(wizard!.extractionUndo, null, 'and spent');
  assert.ok($('[data-node-reset]'), 'reset offered again');
  // Filling from the world settings is the other wholesale change, so it takes the undo.
  await click('[data-node-reset]');
  await click('[data-node-preset="pure"]');
  assert.equal(wizard!.extraction!.nodes!['Iron Ore']!.pure, 127, 'filled from the preset');
  assert.equal(wizard!.extractionUndo, null, 'undo spent by the fill');
  assert.equal($('#toast')!.textContent.includes('Filled in the default world at All Pure'), true);
  // And leaving the survey does too, so the undo cannot outlive the screen.
  await click('[data-node-reset]');
  await click('[data-extraction-cancel]');
  assert.equal(wizard!.extractionUndo, null, 'undo cleared on the way out');
});

test('applying the survey writes and confirms the budgets, and returns to step 4', async () => {
  survey(4, { limitsConfirmed: false }, { extraction: defaultSurvey() });
  // Enter or "Use these budgets": handled by the survey alone, not the wizard's own submit.
  let reached = 0;
  const onSubmit = () => reached++;
  document.addEventListener('submit', onSubmit);
  try {
    $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
  } finally {
    document.removeEventListener('submit', onSubmit);
  }
  assert.equal(reached, 0, 'no other submit listener sees it');
  assert.equal(wizard!.settings.limits!['Iron Ore'], 92100);
  assert.equal(wizard!.settings.limits!.Limestone, 69300);
  assert.equal(wizard!.settings.limitsConfirmed, true, 'counted numbers are confirmed numbers');
  assert.equal(wizard!.preview, null, 'and the plan is recalculated');
  assert.deepEqual(
    wizard!.settings.extraction!.nodes!['Iron Ore'],
    { impure: 39, normal: 42, pure: 46 },
    'the survey is kept for next time',
  );
  assert.equal(wizard!.mode, 'advanced', 'back where it was opened from');
  assert.equal(wizard!.step, 4);
  // The legacy step 4 has taken over <main>, showing the new budgets.
  assert.equal($('.extraction-panel'), null);
  assert.equal($<HTMLInputElement>('input[name="limit:Iron Ore"]')!.value, '92100');
});

test('leaving the survey alone changes no budget', async () => {
  survey(1, { limitsConfirmed: false });
  const before = JSON.stringify(wizard!.settings.limits);
  await click('[data-extraction-step="2"]');
  await change('input[name="node:Iron Ore:pure"]', '1');
  await click('[data-extraction-cancel]');
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(JSON.stringify(wizard!.settings.limits), before);
  assert.equal(wizard!.settings.limitsConfirmed, false);
  assert.ok(!wizard!.settings.extraction);
  // Cancel on the first screen leaves the same way.
  survey(1);
  await click('[data-extraction-back]');
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 4);
});
