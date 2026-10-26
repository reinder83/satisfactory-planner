// "New to Satisfactory" (#1076, app/beginner.ts): a view preference remembered in this browser
// (localStorage, like Hide completed), never in a saved profile. Switched on, the guided start
// leaves out the recipes and exactness questions while their answers are the simple ones, a new
// save's stock starts at "Nothing", and the build plan hides what whole machines cost and the
// hard-drive payoff; switched off, everything is back. Switching never calculates anything.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { BEGINNER_KEY, beginnerMode, setBeginnerMode } from '../../public/app/beginner.ts';
import { calculated, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { guidedAnswer, guidedFlow } from '../../public/app/wizard/guided.ts';
import { startWizard } from '../../public/app/wizard/wizard.ts';
import { guidedQuestions } from '../../public/preferences.ts';
import { $, catalog, generatedWith, go, open, page } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const ids = () => guidedFlow().map(question => question.id);
const stock = guidedQuestions.find(question => question.id === 'stock')!;

beforeEach(() => {
  page();
  setBeginnerMode(false);
  HTMLFormElement.prototype.reportValidity = () => true;
});
afterEach(() => setBeginnerMode(false));

async function flip(value: boolean) {
  const box = $<HTMLInputElement>('[data-beginner-switch]');
  assert.ok(box, 'the switch is on screen');
  box.checked = value;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

test('the preference is remembered in this browser, and unreadable storage means off', async () => {
  setBeginnerMode(true);
  assert.equal(localStorage.getItem(BEGINNER_KEY), 'on');
  assert.equal(document.documentElement.hasAttribute('data-beginner'), true);
  // A new page load reads it back.
  vi.resetModules();
  const reloaded = await import('../../public/app/beginner.ts');
  assert.equal(reloaded.beginnerMode(), true);
  setBeginnerMode(false);
  assert.equal(localStorage.getItem(BEGINNER_KEY), 'off');
  assert.equal(document.documentElement.hasAttribute('data-beginner'), false);
  vi.resetModules();
  assert.equal((await import('../../public/app/beginner.ts')).beginnerMode(), false);
  // Nothing stored (every browser before #1076) and storage that refuses both mean off.
  localStorage.removeItem(BEGINNER_KEY);
  vi.resetModules();
  assert.equal((await import('../../public/app/beginner.ts')).beginnerMode(), false);
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = () => {
    throw Error('refused');
  };
  try {
    vi.resetModules();
    assert.equal((await import('../../public/app/beginner.ts')).beginnerMode(), false);
  } finally {
    Storage.prototype.getItem = getItem;
  }
});

test('the guided start: a new save starts at Nothing and skips the recipes and exactness questions', async () => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  render();
  await settle();
  assert.deepEqual(ids().includes('recipes') && ids().includes('exact'), true, 'off: all asked');
  assert.equal(guidedAnswer(stock), 'construction');
  assert.deepEqual(wizard!.settings.storageOverrides, { Concrete: 20 });

  await flip(true);
  assert.equal(beginnerMode(), true);
  assert.equal(ids().includes('recipes'), false, 'no alternates question');
  assert.equal(ids().includes('exact'), false, 'no clock question');
  assert.equal(guidedAnswer(stock), 'none', 'stock defaults to Nothing');
  assert.equal(wizard!.settings.storage, 'none');
  assert.deepEqual(wizard!.settings.storageOverrides, {});
  assert.equal(wizard!.settings.recipes, 'standard');
  assert.equal(wizard!.settings.wholeMachines, true);
  assert.equal(wizard!.preview, null, 'nothing calculated');

  await flip(false);
  assert.deepEqual(
    guidedFlow().map(question => question.id),
    ['phase', 'tutorial', 'goal', 'recipes', 'stock', 'exact', 'power'],
    'every question is back',
  );
  assert.equal(guidedAnswer(stock), 'construction', 'the stock default is back');
  assert.deepEqual(wizard!.settings.storageOverrides, { Concrete: 20 });
});

test('a new save started in beginner mode starts at Nothing; a stock the user picked is kept', () => {
  setBeginnerMode(true);
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  assert.equal(wizard!.settings.storage, 'none');
  assert.deepEqual(wizard!.settings.storageOverrides, {});
  // Picked "Everything it can automate": switching leaves it.
  Object.assign(wizard!.settings, { storage: 'all', collectables: true });
  go('wizard');
  render();
  return flip(false).then(() => {
    assert.equal(wizard!.settings.storage, 'all');
    assert.deepEqual(wizard!.settings.storageOverrides, {});
  });
});

test('questions answered the advanced way stay asked in beginner mode', () => {
  setBeginnerMode(true);
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  Object.assign(wizard!.settings, { recipes: 'all', wholeMachines: false });
  assert.equal(ids().includes('recipes'), true);
  assert.equal(ids().includes('exact'), true);
});

test('the build plan hides what whole machines cost and the payoff, and shows them again', async () => {
  const plan = generatedWith({ wholeMachines: true });
  open({ calculated: plan, phase: '3' });
  go('plan');
  render();
  await settle();
  assert.ok($('#main [data-rounding-cost]'), 'off: whole-machine cost shown');
  assert.ok($('#main [data-payoff]'), 'off: the payoff shown');
  assert.ok($('[data-plan-tab="hard-drives"]'), 'in its own tab (#1243)');
  const before = JSON.stringify(calculated);
  let requests = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests++;
    return new Response('{}', { status: 503 });
  };
  try {
    await flip(true);
    assert.equal($('#main [data-rounding-cost]'), null);
    assert.ok($('#main [data-beginner-note]'), 'the page says what it hides');
    assert.equal(document.documentElement.hasAttribute('data-beginner'), true);
    assert.equal($('#main [data-payoff]'), null, 'payoff hidden');
    assert.equal($('[data-plan-tab="hard-drives"]'), null, 'its tab too');
    await flip(false);
    assert.ok($('#main [data-rounding-cost]'));
    assert.ok($('#main [data-payoff]'));
    assert.ok($('[data-plan-tab="hard-drives"]'));
    assert.equal($('#main [data-beginner-note]'), null);
    assert.equal(document.documentElement.hasAttribute('data-beginner'), false);
  } finally {
    globalThis.fetch = fetch;
  }
  assert.equal(requests, 0, 'nothing saved or recalculated');
  assert.equal(JSON.stringify(calculated), before, 'the plan is unchanged');
});
