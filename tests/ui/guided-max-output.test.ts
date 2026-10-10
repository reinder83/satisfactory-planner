// The guided start's maximum-output goal (#1072, ui/guided/GuidedBudgets.vue): "As fast as the map
// allows" no longer hands over to All settings step 4. The budgets it needs confirmed are asked on
// a screen of their own right after the goal, with step 4's own boxes (BudgetInputs.vue,
// BudgetConfirm.vue), and the questions after it follow as for any other goal, ending on the
// guided Review. Its answers land in the same settings All settings writes for the same choices.
// Both editions creating the same profile from them is tests/guided-max-output.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWizard, wizard, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { vuePage } from '../../public/app/ui/pages.ts';
import GuidedPage from '../../public/app/ui/pages/GuidedPage.vue';
import { cancelEstimate } from '../../public/app/wizard/estimate.ts';
import { moveExtraction } from '../../public/app/wizard/extraction.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { carryOptions } from '../../public/state.ts';
import {
  $,
  $$,
  catalog,
  evil,
  generated,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';

const IRON = 'limit:Iron Ore';
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const ids = () => guidedFlow().map(q => q.id);
const current = () => guidedFlow()[wizard!.guidedStep - 1]?.id;

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  HTMLFormElement.prototype.reportValidity = () => true;
});

// A new save's draft (mining per phase on, as freshSettings starts one) for a Phase 3 start, in
// the guided start at question `id`, or in All settings at `step`.
function draftAt(
  where: { id: string } | { step: number },
  settings: Partial<WizardSettings> = {},
  extra: Partial<WizardDraft> = {},
) {
  const draft = (guidedStep: number): WizardDraft => ({
    step: 'step' in where ? where.step : 1,
    saveId: null,
    saveName: evil,
    name: '',
    settings: {
      ...structuredClone(generated().settings),
      phase: '3',
      phaseMining: true,
      ...settings,
    },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'step' in where ? 'advanced' : 'guided',
    guidedStep,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  page();
  setWizard(draft(1));
  const step = 'id' in where ? guidedFlow().findIndex(q => q.id === where.id) + 1 : 1;
  assert.ok(step > 0, `${JSON.stringify(where)} is asked`);
  page();
  setWizard(draft(step));
  go('wizard');
  render();
}
const submit = async () => {
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
};
const click = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await settle();
};
const choose = async (selector: string, value: string | boolean) => {
  const el = $<HTMLInputElement>(selector);
  assert.ok(el, selector + ' is on screen');
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};
// The budget screen answered: Iron Ore lowered to `iron`, the budgets confirmed.
const answerBudgets = async (iron: string) => {
  await choose(`input[name="${IRON}"]`, iron);
  await choose('input[name=limitsConfirmed]', true);
};

test('"As fast as the map allows" asks for the budgets next, then the questions after it, in the guided start', async () => {
  draftAt({ id: 'goal' });
  assert.equal(ids().includes('budgets'), false, 'no budget screen for another goal');
  assert.equal(
    $('input[name="guided:goal"][value=maximum]')!.closest('.guided-card')!.querySelector('.badge'),
    null,
    'no "Opens All settings"',
  );
  assert.match(text('.guided-card:has(input[value=maximum])'), /You confirm those budgets next\./);
  await choose('input[name="guided:goal"][value=maximum]', true);
  assert.equal(wizard!.settings.goal, 'maximum');
  assert.deepEqual(ids(), [
    'phase',
    'have',
    'supply',
    'goal',
    'budgets',
    'recipes',
    'stock',
    'exact',
    'power',
  ]);
  assert.equal($$('.guided-progress [role=listitem]').length, 10, 'nine questions and Review');

  await submit();
  assert.equal(wizard!.mode, 'guided', 'no hand-over to All settings');
  assert.equal(current(), 'budgets');
  assert.ok($('[data-guided-budgets]'));
  assert.equal($('[data-wizard-step]'), null, 'no five step tabs');
  assert.equal(text('#main h2'), 'Step 5 of 10: Are these resource budgets right for your save?');
  assert.equal(text('.guided-progress .current .guided-step-label'), 'Your budgets');
  assert.equal($('[data-guided-advanced]')!.dataset.guidedAdvanced, '4', 'All settings, step 4');
  assert.equal($('x-evil'), null);
  // Step 4's boxes, from the draft's budgets, and its confirmation, required here and unticked.
  const boxes = $$<HTMLInputElement>('[data-guided-budgets] input[name^="limit:"]');
  assert.deepEqual(
    boxes.map(box => box.name.slice('limit:'.length)),
    workspace.catalog.raw,
  );
  for (const box of boxes)
    assert.equal(Number(box.value), wizard!.settings.limits[box.name.slice(6)], box.name);
  const confirm = $<HTMLInputElement>('input[name=limitsConfirmed]')!;
  assert.equal(confirm.checked, false);
  assert.equal(confirm.required, true, 'Continue waits for the box');
  assert.match(text('[data-guided-budgets]'), /I have checked these budgets for my save/);
  assert.ok($('[data-guided-budgets] [data-open-extraction]'), 'the node survey is offered');

  // Answered, Continue goes on to the next question with the budgets read as step 4 reads them.
  await answerBudgets('30000');
  await submit();
  assert.equal(wizard!.mode, 'guided');
  assert.equal(current(), 'recipes');
  assert.equal(wizard!.settings.limits['Iron Ore'], 30000);
  assert.equal(wizard!.settings.limitsConfirmed, true);

  // Back keeps the answers: the budget screen as answered, then the goal as chosen.
  await click('[data-guided-back]');
  assert.equal(current(), 'budgets');
  assert.equal($<HTMLInputElement>(`input[name="${IRON}"]`)!.value, '30000');
  assert.equal($<HTMLInputElement>('input[name=limitsConfirmed]')!.checked, true);
  await click('[data-guided-back]');
  assert.equal(current(), 'goal');
  assert.equal($<HTMLInputElement>('input[name="guided:goal"][value=maximum]')!.checked, true);
  await submit();
  await submit();
  assert.equal(current(), 'recipes', 'forward again, the budgets still answered');

  // The questions after it, then the plan is calculated and the guided Review takes over.
  while (wizard!.guidedStep < guidedFlow().length) await submit();
  assert.equal(current(), 'power');
  const plan = generatedWith({ phase: '3', goal: 'maximum', limitsConfirmed: true });
  const calls = stubFetch<{ settings: WizardSettings }>({ '/api/preview': plan });
  await submit();
  assert.equal(calls[0]![0], '/api/preview');
  const sent = calls[0]![1].settings;
  assert.equal(sent.goal, 'maximum');
  assert.equal(sent.limitsConfirmed, true);
  assert.equal(sent.limits['Iron Ore'], 30000);
  assert.equal(wizard!.mode, 'guided');
  assert.equal(vuePage('wizard', wizard), GuidedPage);
  assert.match(text('#main h2'), /^Step 10 of 10: Review /);
  assert.equal($$('[data-wizard-step]').length, 0, 'no five step tabs');
  assert.equal(text('#wizard-form button[type=submit]'), 'Create profile');
});

test('the settings are the ones All settings makes for the same answers', async () => {
  // The guided start: maximum output, Iron Ore lowered, budgets confirmed.
  draftAt({ id: 'goal' });
  await choose('input[name="guided:goal"][value=maximum]', true);
  await submit();
  await answerBudgets('30000');
  await submit();
  assert.equal(current(), 'recipes');
  const guided = structuredClone(wizard!.settings);

  // All settings: the same goal on step 3, the same budget and confirmation on step 4.
  draftAt({ step: 3 });
  await choose('input[name=goal][value=maximum]', true);
  await click('[data-wizard-step="4"]');
  assert.equal(wizard!.step, 4);
  await answerBudgets('30000');
  await click('[data-wizard-step="3"]');
  cancelEstimate();
  assert.deepEqual(wizard!.settings, guided);
});

test('All settings from the budget screen lands on step 4 with the answers kept', async () => {
  draftAt({ id: 'budgets' }, { goal: 'maximum' });
  await answerBudgets('12345');
  await click('[data-guided-advanced]');
  cancelEstimate();
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 4);
  assert.equal($<HTMLInputElement>(`input[name="${IRON}"]`)!.value, '12345');
  assert.equal($<HTMLInputElement>('input[name=limitsConfirmed]')!.checked, true);
  assert.equal(
    $<HTMLInputElement>('input[name=limitsConfirmed]')!.required,
    false,
    'step 4 does not require it, as before',
  );
  // And "← Guided start" comes back to the budget screen.
  await click('[data-guided-start]');
  assert.equal(wizard!.mode, 'guided');
  assert.equal(current(), 'budgets');
  assert.equal($<HTMLInputElement>(`input[name="${IRON}"]`)!.value, '12345');
});

test('the node survey opened from the budget screen comes back to it, budgets set and confirmed', async () => {
  draftAt({ id: 'budgets' }, { goal: 'maximum' });
  await click('[data-guided-budgets] [data-open-extraction]');
  assert.equal(wizard!.mode, 'extraction');
  wizard!.extractionStep = 4;
  render();
  await settle();
  await moveExtraction(5);
  await settle();
  assert.equal(wizard!.mode, 'guided');
  assert.equal(current(), 'budgets');
  assert.equal(wizard!.settings.limitsConfirmed, true, 'counted numbers are confirmed numbers');
  assert.equal($<HTMLInputElement>('input[name=limitsConfirmed]')!.checked, true);
});

test('another goal drops the screen; the confirmation stays as answered, as in All settings', async () => {
  draftAt({ id: 'budgets' }, { goal: 'maximum' });
  await answerBudgets('30000');
  await click('[data-guided-back]');
  assert.equal(current(), 'goal');
  await choose('input[name="guided:goal"][value=balanced]', true);
  assert.equal(ids().includes('budgets'), false);
  await submit();
  assert.equal(current(), 'recipes', 'straight on to the recipes');
  assert.equal(wizard!.settings.limitsConfirmed, true);
  assert.equal(wizard!.settings.limits['Iron Ore'], 30000);
});

test('a second profile that changes its goal to maximum output is asked for the budgets too', async () => {
  draftAt({ id: 'goal' }, { goal: 'maximum' }, { saveId: 's1', guidedAsk: ['goal'] });
  assert.deepEqual(ids(), ['goal', 'budgets']);
  draftAt({ id: 'power' }, { goal: 'maximum' }, { saveId: 's1', guidedAsk: ['power'] });
  assert.deepEqual(ids(), ['power'], 'only the goal brings the budgets');
});
