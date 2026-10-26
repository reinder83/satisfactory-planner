// "Count what buildings cost to build" (#1229) in the interface: All settings step 1
// (ui/wizard/SettingsStep.vue) has the box under the multipliers with a line saying what it does,
// the draft keeps the choice (absent when unticked, as settings() stores it), the sidebar footer
// names it on a plan calculated with it, and a phase whose buildings cost more than it can make in
// time shows the planner's reason with an option that opens Edit settings on step 1. Nothing is
// recalculated by any of it.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setView, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const plain = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
const box = () => $<HTMLInputElement>('[data-build-cost]')!;

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

test('step 1 has the box, unticked for a plan without it, and ticking it keeps it in the draft', async () => {
  settingsStep(generated().settings);
  assert.equal(box().checked, false);
  assert.equal(box().name, 'buildCost');
  assert.equal(plain(box().closest('label')!.textContent), 'Count what buildings cost to build');
  assert.equal(
    plain($(`#${box().getAttribute('aria-describedby')}`)!.textContent),
    "Each phase must then also make the parts its production lines, generators, miners and extractors cost to build, within its time and budgets; a phase that can't is a draft that says so. Not with maximum output, which has no time to count them in.",
  );
  box().click();
  await pressContinue();
  assert.equal(wizard!.step, 2);
  assert.equal(wizard!.settings.buildCost, true);
});

test('a draft keeps the box ticked, and unticking it leaves the field out again', async () => {
  settingsStep({ ...generated().settings, buildCost: true });
  assert.equal(box().checked, true);
  box().click();
  await pressContinue();
  assert.equal(wizard!.step, 2);
  assert.equal('buildCost' in wizard!.settings, false);
});

test('leaving another step changes nothing about it', async () => {
  settingsStep({ ...generated().settings, buildCost: true });
  await pressContinue();
  assert.equal(wizard!.step, 2);
  await pressContinue();
  assert.equal(wizard!.step, 3);
  assert.equal(wizard!.settings.buildCost, true);
});

test('the sidebar names it on a plan calculated with it, and only then', () => {
  const footer = () => $('.sidebar-foot .profile-switcher')!.textContent!;
  for (const counted of [false, true]) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    if (counted) plan.settings.buildCost = true;
    open({ calculated: plan });
    render();
    if (counted) assert.ok(footer().includes('Build costs counted'), footer());
    else assert.doesNotMatch(footer(), /Build costs/);
  }
});

let short: CurrentCalculatedPlan | undefined;
// Phase 3 with one hour per phase: Phase 4's buildings cost more than it can make in that hour.
const shortRun = (): CurrentCalculatedPlan =>
  structuredClone(
    (short ??= generatedWith({ phase: '3', goal: 'timed', hours: 1, buildCost: true })),
  );

test('a phase its buildings do not fit shows the reason and an option on Edit settings step 1', async () => {
  const plan = shortRun();
  assert.equal(plan.stages['4']!.feasible, false, 'the fixture is a draft');
  page();
  open({ calculated: plan, phase: '4', workspace: { catalog: catalog() } });
  go('plan');
  render();
  assert.match(
    plain($('[data-draft]')?.textContent),
    /Counting what its buildings cost to build, this phase does not fit in its 1 h: to also make its buildings' parts within its 1 h, this phase would need [\d,]+ .+ to build/,
  );
  assert.ok($$('[data-draft-lever]').some(item => item.dataset.draftLever === 'buildCost'));
  const lever = $('[data-draft-lever="buildCost"]')!;
  assert.match(plain(lever.textContent), /^Stop counting what buildings cost to build: untick/);
  lever.querySelector<HTMLButtonElement>('[data-draft-edit="1"]')!.click();
  await settle();
  render();
  assert.equal(wizard?.mode, 'advanced');
  assert.equal(wizard?.step, 1);
  assert.equal(box().checked, true, 'Edit settings starts from the plan’s settings');
});
