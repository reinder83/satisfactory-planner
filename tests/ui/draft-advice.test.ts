// An infeasible phase's advice (#1222, ui/plan/DraftAdvice.vue, app/draft-advice.ts): under the
// draft notice's reason, what runs out against what the map gives at the nodes the plan may tap,
// and the options that apply, each with a button where the app already has the action. A real
// plan: Phase 4 with coal power, a short Coal budget and a node survey that leaves 15 of the 17
// Bauxite nodes out. Nothing is recalculated until the user confirms.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { extractionLimits, presetSurvey } from '../../public/preferences.ts';
import { carryOptions } from '../../public/state.ts';
import {
  $,
  $$,
  answerConfirms,
  catalog,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const plain = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
// Numbers in the test's locale, whatever its separators.
const n = (digits: string) => digits.split('').join('[.,\\s ]?');

let plan: CurrentCalculatedPlan | undefined;
function hardRun(): CurrentCalculatedPlan {
  if (!plan) {
    const survey = presetSurvey('vanilla');
    survey.excludedNodes = { Bauxite: { impure: 4, normal: 5, pure: 6 } };
    const limits = extractionLimits(survey, {});
    limits.Coal = 2000;
    plan = generatedWith({
      phase: '4',
      goal: 'timed',
      hours: 1,
      mainPower: 'coal',
      nuclear: 'none',
      extraction: survey,
      limits,
      limitsConfirmed: true,
    });
  }
  return structuredClone(plan);
}

beforeEach(() => page());

function openDraft() {
  const draft = hardRun();
  assert.equal(draft.stages['4']!.feasible, false, 'the fixture is a draft');
  open({ calculated: draft, phase: '4', workspace: { catalog: catalog() } });
  go('plan');
  render();
  return draft;
}

test('the draft notice sets what runs out against the map and offers the levers', () => {
  openDraft();
  const notice = $('[data-draft]')!;
  assert.ok(notice.classList.contains('warn'));
  assert.match(
    plain($('[data-draft-need="Bauxite"]')?.textContent),
    new RegExp(
      `^Bauxite: needs about ${n('1023')}/min; the map gives 900/min at the nodes you allow \\(Miner Mk.3 at 250%\\), so a higher budget alone will not fit it\\.$`,
    ),
  );
  assert.match(
    plain($('[data-draft-need="Coal"]')?.textContent),
    new RegExp(
      `^Coal: needs about ${n('11859')}/min; the map gives ${n('42300')}/min at .* of it is fuel for power\\.$`,
    ),
  );
  assert.deepEqual(
    $$('[data-draft-lever]').map(item => item.dataset.draftLever),
    ['budget', 'time', 'alternates', 'amplify', 'nuclear'],
  );
  // No budget can give the Bauxite the survey leaves out, so only Coal is offered a raise.
  const budget = plain($('[data-draft-lever="budget"]')?.textContent);
  assert.match(budget, /^Raise the short budget \(Resources\): Coal to about /);
  assert.doesNotMatch(budget, /Bauxite/);
  assert.match(plain($('[data-draft-lever="alternates"]')?.textContent), /Sloppy Alumina/);
  assert.match(plain($('[data-draft-lever="nuclear"]')?.textContent), /“Nuclear goal”/);
  // The least hours the planner measured the phase fits in, as a recalculation in place.
  assert.match(
    plain($('[data-draft-lever="time"] [data-draft-recalc-hours]')?.textContent),
    /^Recalculate in place at 2[.,]5 h per phase$/,
  );
  assert.match(
    plain($('[data-draft-note]')?.textContent),
    /Nothing is recalculated until you press Recalculate in place/,
  );
});

test('an option opens Edit settings on the step that holds it', async () => {
  const draft = openDraft();
  $<HTMLButtonElement>('[data-draft-lever="budget"] [data-draft-edit="4"]')!.click();
  await settle();
  render();
  assert.equal(wizard?.mode, 'advanced');
  assert.equal(wizard?.step, 4);
  assert.equal(wizard?.edit?.profileId, 'p', 'it edits this profile, in place');
  assert.equal(wizard?.edit?.plan.createdAt, draft.createdAt);
});

test('more time recalculates in place only after the question', async () => {
  openDraft();
  const calls = stubFetch({});
  const asked = answerConfirms(false);
  $<HTMLButtonElement>('[data-draft-recalc-hours]')!.click();
  await settle();
  assert.equal(asked.length, 1, 'it asks first');
  assert.match(asked[0]!, /Recalculates “.*” with 2.5 hours per phase\./);
  assert.deepEqual(calls, [], 'nothing is sent when the question is cancelled');
  assert.ok($('[data-draft]'), 'the draft stays');
});

test('the wizard Review shows the same advice without buttons', () => {
  const draft = hardRun();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 5,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(draft.settings),
    preview: draft,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  assert.match(plain($('[data-draft-need="Bauxite"]')?.textContent), /the map gives 900\/min/);
  assert.ok($$('[data-draft-lever]').length > 0);
  assert.equal($('[data-draft-edit], [data-draft-recalc-hours], [data-draft-note]'), null);
});
