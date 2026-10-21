// "Expert mode" (#1197, app/expert.ts): a view preference remembered in this browser, never in a
// profile, and never on together with "New to Satisfactory". Switched on, a new plan opens on All
// settings, which takes three denser screens without the explanatory paragraphs (the same fields,
// so the same answers give the same settings and the same plan), and the build plan groups its HUB
// milestones by tier and its MAM research, with a tick per group that writes exactly the per-item
// ticks. Switching it never calculates or saves anything.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { BEGINNER_KEY, beginnerMode, setBeginnerMode } from '../../public/app/beginner.ts';
import {
  EXPERT_KEY,
  expertMode,
  setExpertMode,
  switchBeginnerMode,
} from '../../public/app/expert.ts';
import { setHideDone, setQuery, setWizard, state, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { startWizard } from '../../public/app/wizard/wizard.ts';
import {
  $,
  $$,
  applyUpdate,
  catalog,
  generated,
  go,
  open,
  page,
  stubFetch,
  useStylesheet,
} from './setup.ts';
import type { WizardSettings } from '../../public/app/wizard/wizard.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const click = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await settle();
};
const flip = async (selector: string, value: boolean) => {
  const box = $<HTMLInputElement>(selector);
  assert.ok(box, selector + ' is on screen');
  box.checked = value;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};

beforeEach(() => {
  page();
  setBeginnerMode(false);
  setExpertMode(false);
  setQuery('');
  setHideDone(false);
  HTMLFormElement.prototype.reportValidity = () => true;
});
afterEach(() => {
  setBeginnerMode(false);
  setExpertMode(false);
});

test('the preference is remembered in this browser, off by default and when unreadable', async () => {
  localStorage.removeItem(EXPERT_KEY);
  vi.resetModules();
  assert.equal((await import('../../public/app/expert.ts')).expertMode(), false, 'off by default');
  setExpertMode(true);
  assert.equal(localStorage.getItem(EXPERT_KEY), 'on');
  vi.resetModules();
  assert.equal((await import('../../public/app/expert.ts')).expertMode(), true, 'read back');
  setExpertMode(false);
  assert.equal(localStorage.getItem(EXPERT_KEY), 'off');
  vi.resetModules();
  assert.equal((await import('../../public/app/expert.ts')).expertMode(), false);
  localStorage.setItem(EXPERT_KEY, 'on');
  // Storage that refuses to be read, as blocked site data does.
  const stored = localStorage;
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw Error('refused');
    },
    setItem: () => {
      throw Error('refused');
    },
  });
  try {
    vi.resetModules();
    const refused = await import('../../public/app/expert.ts');
    assert.equal(refused.expertMode(), false, 'unreadable');
    refused.setExpertMode(true);
    assert.equal(refused.expertMode(), true, 'switching still works for this page');
  } finally {
    vi.unstubAllGlobals();
    stored.removeItem(EXPERT_KEY);
  }
  // A browser that somehow has both stored reads as a beginner.
  localStorage.setItem(EXPERT_KEY, 'on');
  localStorage.setItem(BEGINNER_KEY, 'on');
  vi.resetModules();
  const both = await import('../../public/app/expert.ts');
  assert.equal(both.expertMode(), false);
  localStorage.removeItem(EXPERT_KEY);
  localStorage.removeItem(BEGINNER_KEY);
});

test('switching one mode on switches the other off, in storage too', () => {
  setBeginnerMode(true);
  setExpertMode(true);
  assert.equal(expertMode(), true);
  assert.equal(beginnerMode(), false, 'expert on: beginner off');
  assert.equal(localStorage.getItem(BEGINNER_KEY), 'off');
  switchBeginnerMode(true);
  assert.equal(beginnerMode(), true);
  assert.equal(expertMode(), false, 'beginner on: expert off');
  assert.equal(localStorage.getItem(EXPERT_KEY), 'off');
  switchBeginnerMode(false);
  assert.equal(expertMode(), false, 'and it stays off');
});

test('the build plan offers both switches beside Hide completed, never both ticked', async () => {
  open({ calculated: generated(), phase: '1' });
  go('plan');
  render();
  await settle();
  const requests = stubFetch({});
  await flip('#main [data-beginner-switch]', true);
  await flip('#main [data-expert-switch]', true);
  assert.equal($<HTMLInputElement>('#main [data-expert-switch]')!.checked, true);
  assert.equal($<HTMLInputElement>('#main [data-beginner-switch]')!.checked, false);
  assert.ok($('#main [data-expert-note]'));
  await flip('#main [data-beginner-switch]', true);
  assert.equal($<HTMLInputElement>('#main [data-expert-switch]')!.checked, false);
  assert.equal($('#main [data-unlock-groups]'), null, 'no groups outside expert mode');
  assert.equal(requests.length, 0, 'nothing saved or calculated');
});

test('a new plan opens on All settings in three screens without the explanations', async () => {
  useStylesheet();
  open({ workspace: { catalog: catalog(), saves: [] } });
  setExpertMode(true);
  startWizard();
  render();
  await settle();
  assert.equal(wizard!.mode, 'advanced', 'no guided start');
  assert.deepEqual(
    $$('#main [data-wizard-step]').map(tab => [tab.dataset.wizardStep, text(tab)]),
    [
      ['1', '1. Settings & preferences'],
      ['3', '2. Goals & resources'],
      ['5', '3. Review'],
    ],
  );
  const form = $('#wizard-form')!;
  assert.ok(form.classList.contains('compact'));
  assert.ok($('#wizard-form [name=saveName]') && $('#wizard-form [name=utilityPercent]'));
  assert.deepEqual(
    $$('#wizard-form [data-step-heading]').map(heading => text(heading)),
    ['Step 1 of 3: Your save and game settings', 'How do you want to build?'],
  );
  const explained = $$('#wizard-form [data-explain]');
  assert.ok(explained.length >= 3, 'the explanations are marked');
  for (const el of explained) assert.equal(getComputedStyle(el).display, 'none');
  const tip = $('#wizard-form .setting-help')!;
  assert.notEqual(getComputedStyle(tip).display, 'none', 'help tips stay');
  assert.equal(tip.getAttribute('tabindex'), '0');
  assert.ok($('#wizard-form [data-guided-start]'), 'the guided start stays one click away');
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(wizard!.step, 3, 'Continue goes to the second screen');
  assert.ok($('#wizard-form [name=profileName]') && $('#wizard-form [name=phaseMining]'));
  assert.equal(text($('#wizard-form button[type=submit]')), 'Calculate plan');
  await click('[data-wizard-back]');
  assert.ok($('#wizard-form [name=saveName]'), 'Back lands on the first screen');
  // Switched off on the screen: the five steps again, the draft as it was.
  await flip('#wizard-form [data-expert-switch]', false);
  assert.equal($$('#main [data-wizard-step]').length, 5);
  assert.equal($('#wizard-form [name=saveName]'), null, 'step 2 alone');
});

test('the guided start offers expert mode; on, it goes on to All settings as a non-beginner', async () => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  render();
  await settle();
  assert.equal(wizard!.mode, 'guided');
  await flip('#main [data-beginner-switch]', true);
  assert.equal(wizard!.settings.storage, 'none', 'the beginner stock');
  $<HTMLInputElement>('#main [name=saveName]')!.value = 'Typed world';
  await flip('#main [data-expert-switch]', true);
  assert.equal(beginnerMode(), false);
  assert.equal(expertMode(), true);
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.saveName, 'Typed world', 'what was typed is kept');
  assert.equal(wizard!.settings.storage, 'construction', 'the usual stock is back');
  assert.ok($('#wizard-form.compact'));
});

// The answers, by field, that each test below enters on the screens that show them.
const ANSWERS: [string, string | boolean][] = [
  ['[name=saveName]', 'Same world'],
  ['[name=phase]', '2'],
  ['[name=purity]', 'pure'],
  ['[name=multiplier]', '2'],
  ['[name=utilityPercent]', '35'],
  ['[name=somersloops]', '10'],
  ['input[name=goal][value=timed]', true],
  ['[name=hours]', '4'],
  ['[name=roundRates]', false],
  ['[name=wholeMachines]', false],
  ['[name=limitsConfirmed]', true],
  ['[name="limit:Iron Ore"]', '5000'],
];
function answerOnScreen() {
  for (const [selector, value] of ANSWERS) {
    const el = $<HTMLInputElement>('#wizard-form ' + selector);
    if (!el) continue;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(value);
    else el.value = String(value);
  }
}
async function settingsSent(expert: boolean, moves: string[]) {
  page();
  setExpertMode(expert);
  setWizard({
    step: 1,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(generated().settings) as WizardSettings,
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  await settle();
  const calls = stubFetch<{ settings: WizardSettings }>({ '/api/preview': generated() });
  for (const move of moves) {
    answerOnScreen();
    await click(`[data-wizard-step="${move}"]`);
  }
  const previews = calls.filter(([path]) => path === '/api/preview');
  assert.equal(previews.length, 1, 'Review calculated once');
  return { settings: previews[0]![1].settings, saveName: wizard!.saveName };
}

test('the same answers give the same settings, and so the same plan, on either layout', async () => {
  open({ workspace: { catalog: catalog() } });
  const five = await settingsSent(false, ['2', '3', '4', '5']);
  const three = await settingsSent(true, ['3', '5']);
  assert.equal(five.settings.phase, '2', 'the answers were read');
  assert.equal(five.settings.limits!['Iron Ore'], 5000);
  assert.equal(five.settings.roundRates, false);
  assert.deepEqual(three, five);
});

// A Phase 3 plan shown on Phase 1, a milestone-only phase: its steps are all HUB milestones and
// MAM research, grouped in expert mode.
let updates: [string, UpdateOp][];
async function unlocksPage(checks: Record<string, boolean> = {}) {
  open({ calculated: generated(), phase: '1', state: { version: 3, checks } });
  setExpertMode(true);
  go('plan');
  render();
  await settle();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
}
const groupKeys = (key: string) =>
  $$<HTMLInputElement>(`#main [data-unlock-group="${key}"] [data-check]`).map(
    box => box.dataset.check!,
  );

test('the build plan groups the unlocks by tier, with a tick per group and per item', async () => {
  await unlocksPage();
  assert.equal(document.querySelector('x-evil'), null, 'a hostile name stays text');
  const groups = $$('#main [data-unlock-group]').map(group => group.dataset.unlockGroup);
  assert.ok(groups.length >= 2, groups.join());
  assert.equal(groups.at(-1), 'mam', 'MAM research after the tiers');
  assert.equal($('#main [data-open-steps]'), null, 'every step of this phase is in a group');
  assert.equal($('#main .empty-state'), null);
  const tier = groups.find(key => key !== 'mam' && groupKeys(key!).length >= 2)!;
  const box = $<HTMLInputElement>(`#main [data-unlock-group-tick="${tier}"]`)!;
  assert.equal(text(box.closest('label')), `${tier.replace('tier-', 'Tier ')} done`);
  assert.equal(box.type, 'checkbox', 'a native checkbox: Tab reaches it, Space ticks it');
  assert.equal(box.tabIndex, 0);
  assert.equal(box.disabled, false);
  // An item ticked by itself writes its own check.
  const [first, ...rest] = groupKeys(tier);
  await click(`#main [data-unlock-group="${tier}"] [data-check="${first}"]`);
  assert.deepEqual(updates.at(-1)![1], { type: 'check', key: first, value: true });
  assert.equal(box.indeterminate, true, 'some done: mixed');
  assert.match(text($(`#main [data-unlock-group="${tier}"] [data-unlock-group-count]`)), /^1 of /);
  // The group's tick: the rest, in one update, focus staying on it.
  const before = structuredClone(state.checks);
  box.focus();
  box.click();
  await settle();
  assert.deepEqual(updates.at(-1)![1], { type: 'checks', keys: rest, value: true });
  const byHand = rest.reduce(
    (checks, key) => ({ ...checks, [key]: true }),
    before as Record<string, boolean>,
  );
  assert.deepEqual(state.checks, byHand, 'the same ticks as ticking each item');
  assert.equal(document.activeElement, $(`#main [data-unlock-group-tick="${tier}"]`));
  assert.equal($<HTMLInputElement>(`#main [data-unlock-group-tick="${tier}"]`)!.checked, true);
  assert.match(text($('#toast')), /^Tier \d+ done: \d+ unlocks? ticked; 1 already was\./);
  // Unticked: the group's own items only.
  const other = groups.find(key => key !== tier)!;
  await click(`#main [data-unlock-group="${other}"] [data-check="${groupKeys(other)[0]}"]`);
  $<HTMLInputElement>(`#main [data-unlock-group-tick="${tier}"]`)!.click();
  await settle();
  assert.deepEqual(updates.at(-1)![1], { type: 'checks', keys: [first, ...rest], value: false });
  for (const key of groupKeys(tier)) assert.equal(state.checks[key], false, key);
  assert.equal(state.checks[groupKeys(other)[0]!], true, 'another group keeps its tick');
});

test('a group tick’s Undo puts each item back as it was', async () => {
  await unlocksPage();
  const tier = $$('#main [data-unlock-group]')[0]!.dataset.unlockGroup!;
  const before = structuredClone(state.checks);
  await click(`#main [data-unlock-group-tick="${tier}"]`);
  assert.ok(groupKeys(tier).every(key => state.checks[key] === true));
  await click('#toast [data-toast-action]');
  assert.deepEqual(state.checks, before, 'never-ticked items are forgotten again');
  assert.match(text($('#toast')), /^Undone: /);
});

test('Hide completed and the search show only some items; the group tick still covers its tier', async () => {
  const plan = generated();
  open({ calculated: plan, phase: '1', state: { version: 3, checks: {} } });
  setExpertMode(true);
  go('plan');
  render();
  await settle();
  const tier = $$('#main [data-unlock-group]').find(
    group =>
      group.dataset.unlockGroup !== 'mam' && groupKeys(group.dataset.unlockGroup!).length >= 2,
  )!.dataset.unlockGroup!;
  const all = groupKeys(tier);
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await click(`#main [data-unlock-group="${tier}"] [data-check="${all[0]}"]`);
  setHideDone(true);
  render();
  await settle();
  assert.deepEqual(groupKeys(tier), all.slice(1), 'the done item is hidden');
  assert.match(text($(`#main [data-unlock-group="${tier}"] [data-unlock-group-count]`)), /^1 of /);
  await click(`#main [data-unlock-group-tick="${tier}"]`);
  assert.deepEqual(updates.at(-1)![1], { type: 'checks', keys: all.slice(1), value: true });
  assert.equal($(`#main [data-unlock-group="${tier}"]`), null, 'the done group is hidden');
  assert.ok(
    document.activeElement?.matches('[data-unlock-group-tick], #plan-search'),
    'focus goes on to the next group',
  );
});
