// The recipe part cost multiplier (#1161) in the interface: All settings step 1
// (ui/wizard/SettingsStep.vue) offers the game's steps with a line saying what it does, the draft
// keeps the choice (absent at 1×, as settings() stores it), and the sidebar footer names the
// multiplier a plan was calculated with when it is not 1×, so a plan never changes it by itself.
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
const select = () => $<HTMLSelectElement>('select[name=recipeCost]')!;

// Step 1 of the five steps, as "All settings" leaves it, from `settings`.
function settingsStep(settings: CurrentCalculatedPlan['settings']) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 1,
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

test('step 1 offers the game’s recipe part costs at 1× with a line saying what it does', async () => {
  settingsStep(generated().settings);
  const field = select().closest('label')!;
  assert.match(field.textContent!, /^Recipe part cost multiplier/);
  assert.deepEqual(
    [...select().options].map(option => [option.value, option.textContent!.trim()]),
    [
      ['0.25', '0.25×'],
      ['0.5', '0.5×'],
      ['0.75', '0.75×'],
      ['1', '1× (default)'],
      ['1.25', '1.25×'],
      ['1.5', '1.5×'],
      ['1.75', '1.75×'],
      ['2', '2×'],
    ],
  );
  assert.equal(select().value, '1', 'a plan without the field shows 1×');
  assert.equal(
    field.parentElement!.querySelector('p')!.textContent!.trim(),
    'Every recipe takes this many times its usual inputs; its outputs stay the same.',
  );
  // Choosing 2× keeps it in the draft the wizard calculates from.
  select().value = '2';
  select().dispatchEvent(new Event('change', { bubbles: true }));
  await pressContinue();
  assert.equal(wizard!.step, 2);
  assert.equal(wizard!.settings.recipeCost, 2);
});

test('a draft keeps its multiplier, and 1× leaves the field out again', async () => {
  settingsStep({ ...generated().settings, recipeCost: 0.5 });
  assert.equal(select().value, '0.5');
  select().value = '1';
  select().dispatchEvent(new Event('change', { bubbles: true }));
  await pressContinue();
  assert.equal(wizard!.step, 2);
  assert.equal('recipeCost' in wizard!.settings, false);
});

test('the sidebar names the recipe part cost a plan was calculated with, only when not 1×', () => {
  const footer = () => $('.sidebar-foot .profile-switcher')!.textContent!;
  for (const [recipeCost, shown] of [
    [undefined, null],
    [2, '2× recipe part cost'],
    [0.75, '0.75× recipe part cost'],
  ] as const) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    if (recipeCost !== undefined) plan.settings.recipeCost = recipeCost;
    open({ calculated: plan });
    render();
    if (shown) assert.ok(footer().includes(shown), footer());
    else assert.doesNotMatch(footer(), /recipe part cost/);
    assert.equal(
      $('.sidebar-foot .profile-switcher')!.querySelectorAll('br').length,
      shown ? 4 : 3,
    );
  }
});
