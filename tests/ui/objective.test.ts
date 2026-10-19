// What the plan keeps lowest (#1180) in the interface: All settings step 3
// (ui/wizard/ObjectiveChoice.vue in GoalStep.vue) offers the fewest buildings, least power, least
// raw resources and a weighted mix as cards with a line each, the draft keeps the choice (absent
// for the fewest buildings, as settings() stores it), and the sidebar footer names the objective
// a plan was calculated with when it is not the fewest buildings, so a plan never changes it by
// itself.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setView, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const card = (id: string) => $<HTMLInputElement>(`[data-objective] input[value=${id}]`)!;
const weight = (name: string) => $<HTMLInputElement>(`input[name="objectiveWeight:${name}"]`);

// Step 3 of the five steps, as "All settings" leaves it, from `settings`.
function goalStep(settings: CurrentCalculatedPlan['settings']) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 3,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(settings),
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

async function choose(id: string) {
  card(id).checked = true;
  card(id).dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

async function pressContinue() {
  $<HTMLFormElement>('#wizard-form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await settle();
}

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts).
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('step 3 offers what the plan keeps lowest, the fewest buildings first and chosen', async () => {
  goalStep(generated().settings);
  const fieldset = $('[data-objective]')!;
  assert.match(fieldset.querySelector('legend')!.textContent!, /^What the plan keeps lowest/);
  assert.deepEqual(
    [...fieldset.querySelectorAll('.goal-card')].map(label => [
      label.querySelector('input')!.value,
      label.querySelector('strong')!.textContent,
      label.querySelector('p')!.textContent,
    ]),
    [
      [
        'buildings',
        'Fewest buildings (default)',
        'The fewest machines and generators that meet the goal; less power breaks a tie.',
      ],
      [
        'power',
        'Least power',
        'The least power for the production lines, miners and extractors; fewer buildings break a tie.',
      ],
      [
        'raw',
        'Least raw resources',
        'The least ore, oil and gas mined per minute (Water does not count: it never runs out); fewer buildings break a tie.',
      ],
      [
        'weighted',
        'Weighted mix',
        'Your own weights from 0 to 10: one building counts as much as 10 MW of power or 10 raw resources per minute, each times its weight.',
      ],
    ],
  );
  assert.equal(card('buildings').checked, true, 'a plan without the field is the fewest buildings');
  assert.equal(weight('power'), null, 'no weights until the mix is chosen');
  // Choosing least power keeps it in the draft the wizard calculates from.
  await choose('power');
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal(wizard!.settings.objective, 'power');
});

test('a weighted mix shows three weights, and the draft keeps what is typed', async () => {
  goalStep(generated().settings);
  await choose('weighted');
  assert.deepEqual(
    ['buildings', 'power', 'raw'].map(name => [
      weight(name)!.closest('label')!.textContent!.trim(),
      weight(name)!.value,
      weight(name)!.min,
      weight(name)!.max,
      weight(name)!.step,
    ]),
    [
      ['Buildings weight', '1', '0', '10', '1'],
      ['Power weight', '1', '0', '10', '1'],
      ['Raw resources weight', '1', '0', '10', '1'],
    ],
  );
  // Three zeros cannot be continued from: the first box says why.
  for (const name of ['buildings', 'power', 'raw']) {
    weight(name)!.value = '0';
    weight(name)!.dispatchEvent(new Event('input', { bubbles: true }));
  }
  assert.equal(weight('buildings')!.validationMessage, 'Give at least one weight above 0.');
  weight('power')!.value = '3';
  weight('power')!.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(weight('buildings')!.validationMessage, '');
  weight('buildings')!.value = '2';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.deepEqual(wizard!.settings.objective, { buildings: 2, power: 3, raw: 0 });
});

test('a draft keeps its objective, and the fewest buildings leaves the field out again', async () => {
  goalStep({ ...generated().settings, objective: { buildings: 0, power: 4, raw: 1 } });
  assert.equal(card('weighted').checked, true);
  assert.deepEqual(
    ['buildings', 'power', 'raw'].map(name => weight(name)!.value),
    ['0', '4', '1'],
  );
  await choose('buildings');
  assert.equal(weight('power'), null);
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal('objective' in wizard!.settings, false);
});

test('the sidebar names the objective a plan was calculated with, only when not the fewest buildings', () => {
  const footer = () => $('.sidebar-foot .profile-switcher')!.textContent!;
  for (const [objective, shown] of [
    [undefined, null],
    ['power', 'Objective: least power'],
    ['raw', 'Objective: least raw resources'],
    [{ buildings: 2, power: 1, raw: 0 }, 'Objective: weighted mix (buildings 2, power 1, raw 0)'],
  ] as const) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    if (objective !== undefined) plan.settings.objective = objective;
    open({ calculated: plan });
    render();
    if (shown) assert.ok(footer().includes(shown), footer());
    else assert.doesNotMatch(footer(), /Objective/);
    assert.equal(
      $('.sidebar-foot .profile-switcher')!.querySelectorAll('br').length,
      shown ? 4 : 3,
    );
  }
});
