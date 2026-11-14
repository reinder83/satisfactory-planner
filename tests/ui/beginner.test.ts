// The Beginner detail level (#1337; "New to Satisfactory" before it, #1076, app/beginner.ts).
// Picked, the guided start leaves out the recipes and exactness questions while their answers are
// the simple ones, a new save's stock starts at "Nothing", and the build plan hides what whole
// machines cost and the hard-drive payoff; at Standard everything is back. Picking a level never
// calculates anything; on the build plan it saves the profile's level and nothing else. The level
// itself, its storage and the control are tested in detail-level.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { beginnerMode } from '../../public/app/beginner.ts';
import { setBrowserDetail } from '../../public/app/detail-level.ts';
import { calculated, state, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { guidedAnswer, guidedFlow } from '../../public/app/wizard/guided.ts';
import { startWizard } from '../../public/app/wizard/wizard.ts';
import { guidedQuestions } from '../../public/preferences.ts';
import { $, applyUpdate, catalog, generatedWith, go, open, page, stubFetch } from './setup.ts';
import type { DetailLevel, UpdateOp } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const ids = () => guidedFlow().map(question => question.id);
const stock = guidedQuestions.find(question => question.id === 'stock')!;

beforeEach(() => {
  page();
  setBrowserDetail('standard');
  HTMLFormElement.prototype.reportValidity = () => true;
});
afterEach(() => setBrowserDetail('standard'));

// Picks a level on the detail level control on screen, as a click or an arrow key does.
async function pick(level: DetailLevel) {
  const radio = $<HTMLInputElement>(`#main [data-detail-option="${level}"]`);
  assert.ok(radio, 'the detail level is on screen');
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

test('the guided start: a new save starts at Nothing and skips the recipes and exactness questions', async () => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  render();
  await settle();
  assert.deepEqual(ids().includes('recipes') && ids().includes('exact'), true, 'off: all asked');
  assert.equal(guidedAnswer(stock), 'construction');
  assert.deepEqual(wizard!.settings.storageOverrides, { Concrete: 20 });

  await pick('beginner');
  assert.equal(beginnerMode(), true);
  assert.equal(ids().includes('recipes'), false, 'no alternates question');
  assert.equal(ids().includes('exact'), false, 'no clock question');
  assert.equal(guidedAnswer(stock), 'none', 'stock defaults to Nothing');
  assert.equal(wizard!.settings.storage, 'none');
  assert.deepEqual(wizard!.settings.storageOverrides, {});
  assert.equal(wizard!.settings.recipes, 'standard');
  assert.equal(wizard!.settings.wholeMachines, true);
  assert.equal(wizard!.preview, null, 'nothing calculated');

  await pick('standard');
  assert.deepEqual(
    guidedFlow().map(question => question.id),
    ['phase', 'tutorial', 'goal', 'recipes', 'stock', 'exact', 'power'],
    'every question is back',
  );
  assert.equal(guidedAnswer(stock), 'construction', 'the stock default is back');
  assert.deepEqual(wizard!.settings.storageOverrides, { Concrete: 20 });
});

test('a new save started at Beginner starts at Nothing; a stock the user picked is kept', () => {
  setBrowserDetail('beginner');
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  assert.equal(wizard!.settings.storage, 'none');
  assert.deepEqual(wizard!.settings.storageOverrides, {});
  // Picked "Everything it can automate": switching leaves it.
  Object.assign(wizard!.settings, { storage: 'all', collectables: true });
  go('wizard');
  render();
  return pick('standard').then(() => {
    assert.equal(wizard!.settings.storage, 'all');
    assert.deepEqual(wizard!.settings.storageOverrides, {});
  });
});

test('questions answered the advanced way stay asked at Beginner', () => {
  setBrowserDetail('beginner');
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
  const requests = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await pick('beginner');
  assert.equal($('#main [data-rounding-cost]'), null);
  assert.ok($('#main [data-beginner-note]'), 'the page says what it hides');
  assert.equal($('#main [data-payoff]'), null, 'payoff hidden');
  assert.equal($('[data-plan-tab="hard-drives"]'), null, 'its tab too');
  await pick('standard');
  assert.ok($('#main [data-rounding-cost]'));
  assert.ok($('#main [data-payoff]'));
  assert.ok($('[data-plan-tab="hard-drives"]'));
  assert.equal($('#main [data-beginner-note]'), null);
  assert.deepEqual(
    requests.map(([path, body]) => [path, body]),
    [
      ['/api/update', { type: 'detailLevel', value: 'beginner' }],
      ['/api/update', { type: 'detailLevel', value: 'standard' }],
    ],
    'only the profile’s level is saved: nothing is recalculated',
  );
  assert.equal(state.detailLevel, 'standard');
  assert.equal(JSON.stringify(calculated), before, 'the plan is unchanged');
});
