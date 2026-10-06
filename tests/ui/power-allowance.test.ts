// #1090: Power needed already holds the utility allowance for trains, drone ports and pumps
// (utilityPercent, Extra utilities power in Preferences, 20% by default), but the review table and
// the power step gave it as one number ("624.99 GW of 627.15 GW"), which read as "no room left for
// trains". Every page that gives the figure now takes it apart with one formatter (the need powerView gives in
// public/power.ts): the wizard's Review, the build plan's "Power available now" and the Resources
// page. The parts it shows add up to Power needed, the percentage leads to the Preferences setting,
// and a plan stored before the power model (#1064, no `grid`) is taken apart as powerView reads it,
// never recalculated. Numbers are written as in en-US.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { setWizard, wizard, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { powerView } from '../../public/power.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type { Phase, StoredCalculatedPlan } from '../../public/types/index.ts';

const toLocale = Number.prototype.toLocaleString;
beforeAll(() => {
  Number.prototype.toLocaleString = function (
    this: number,
    _locale?: unknown,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocale.call(this, 'en-US', options);
  };
});
afterAll(() => {
  Number.prototype.toLocaleString = toLocale;
});
beforeEach(() => page());

const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// The MW figures a sentence gives for its parts ("483.1 GW for production lines", "96.62 GW at
// 20% for trains, drones and pumps"), their sum, and how far the rounding of each (to 0.01 of its
// unit) can take that sum from the exact need.
function shownParts(text: string) {
  let sum = 0,
    slack = 1e-6,
    count = 0;
  for (const [, amount, unit] of text.matchAll(/([\d,.]+) ([MG]W) (?:at \d+% )?for /g)) {
    const scale = unit === 'GW' ? 1000 : 1;
    sum += Number(amount!.replace(/,/g, '')) * scale;
    slack += 0.005 * scale;
    count++;
  }
  return { sum, slack, count };
}
function assertAddsUp(text: string, needMW: number, where: string) {
  const { sum, slack, count } = shownParts(text);
  assert.ok(count >= 2, `${where}: the parts are shown: ${text}`);
  assert.ok(
    Math.abs(sum - needMW) <= slack,
    `${where}: ${sum} MW shown against ${needMW}: ${text}`,
  );
}

function wizardAt(plan: StoredCalculatedPlan, step: number) {
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: 'Power',
    settings: structuredClone(plan.settings),
    preview: structuredClone(plan),
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
}
function review(plan: StoredCalculatedPlan) {
  page();
  open({ workspace: { catalog: catalog() } });
  wizardAt(plan, 5);
  go('wizard');
  render();
  return Object.fromEntries(
    $$('table tbody tr').map(row => [
      plain(row.querySelector('td')?.textContent),
      plain(row.querySelector('[data-review-allowance]')?.textContent),
    ]),
  );
}
function resources(plan: StoredCalculatedPlan, phase: Phase) {
  page();
  open({ calculated: structuredClone(plan), phase });
  go('resources');
  render();
  return {
    parts: plain($('[data-power-parts]')?.textContent),
    peak: plain($('[data-power-peak]')?.textContent),
  };
}
function powerStep(plan: StoredCalculatedPlan, phase: Phase) {
  page();
  open({ calculated: structuredClone(plan), phase });
  go('plan');
  render();
  return plain($('#main [data-open-steps] > .task.lead details > p')?.textContent);
}

// Every phase of `plan`: Review's allowance line, the Resources page's parts and, where the step
// builds on spare power, "Power available now" give the same allowance, and their parts add up
// to Power needed.
function checkPlan(plan: StoredCalculatedPlan, label: string) {
  plan.settings.phase = '1';
  const percent = plan.settings.utilityPercent ?? 20;
  const cells = review(plan);
  for (const phase of ['1', '2', '3', '4', '5'] as const) {
    const stage = plan.stages[phase];
    if (!stage.feasible) continue;
    const view = powerView(stage, plan.settings),
      need = view.need,
      where = `${label}, Phase ${phase}`;
    const allowance = `${power(need.allowanceMW)} for trains, drones and pumps (${percent}%)`;
    // The parts are powerView's, and add up to its need.
    assert.ok(
      Math.abs(need.parts.reduce((sum, part) => sum + part.mw, 0) - view.needMW) < 1e-6,
      where,
    );
    if (stage.grid)
      assert.equal(need.allowanceMW, stage.grid.allowanceMW, `${where}: the grid's allowance`);
    assert.equal(cells[phase], `incl. ${allowance}`, `${where}: Review`);
    const page = resources(plan, phase);
    assert.ok(page.parts.startsWith('Power needed: '), `${where}: ${page.parts}`);
    assert.ok(
      page.parts.includes(`${power(need.allowanceMW)} at ${percent}% for trains, drones and pumps`),
      `${where}: Resources: ${page.parts}`,
    );
    assertAddsUp(page.parts, view.needMW, `${where}: Resources`);
    assert.equal(!!page.peak, !!view.variable, `${where}: the peak note`);
    if (view.variable)
      assert.ok(page.peak.includes(`${power(view.variable.peakMW)} peak`), page.peak);
    if (view.spareMW + view.augmenterMW > 0 && phase !== '1') {
      const step = powerStep(plan, phase);
      const inAll = step.match(
        /\(([\d,.]+ [MG]W) in all: ([^)]*)\)|'s ([\d,.]+ [MG]W) \(([^)]*)\)/,
      );
      assert.ok(inAll, `${where}: ${step}`);
      assert.equal(inAll[1] ?? inAll[3], power(view.needMW), `${where}: the step's need`);
      assertAddsUp(inAll[2] ?? inAll[4]!, view.needMW, `${where}: the power step`);
      assert.ok(
        step.includes(
          `The ${percent}% for trains, drones and pumps is Extra utilities power in Preferences`,
        ),
        step,
      );
    }
  }
}

test('Review, the power step and the Resources page take Power needed apart the same way', () => {
  checkPlan(generated(), 'default');
}, 60000);

test('with spare power and a 35% allowance, the parts still add up on every page', () => {
  checkPlan(generatedWith({ availablePowerGW: 2, utilityPercent: 35 }), '35% and spare power');
}, 120000);

test('a plan stored before #1064 is taken apart as powerView reads it, not recalculated', () => {
  const stored: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
  );
  assert.equal(stored.stages['3'].grid, undefined);
  const before = JSON.stringify(stored);
  checkPlan(structuredClone(stored), 'stored');
  // Its parts are its whole-machine peak and the allowance, the bar's own.
  const stage = stored.stages['3'],
    need = powerView(stage, stored.settings).need;
  assert.deepEqual(
    need.parts.map(part => part.key),
    ['peak', 'utility'],
  );
  assert.equal(need.parts[0]!.mw, stage.peakMW);
  assert.ok(Math.abs(need.allowanceMW - stage.requiredMW! + stage.peakMW!) < 1e-6);
  // Spare power makes the power step give it too, from the same stored figures.
  const spare = structuredClone(stored);
  spare.settings.availablePowerGW = 1;
  const step = powerStep(spare, '3');
  assert.ok(
    step.includes(
      `in all: ${power(need.parts[0]!.mw)} for production lines at their whole-machine peak and ${power(need.allowanceMW)} at 20% for trains, drones and pumps)`,
    ),
    step,
  );
  // Nothing reads a grid into the stored plan.
  assert.equal(JSON.stringify(stored), before);
  assert.equal(stored.stages['3'].grid, undefined);
});

test("Review's percentage leads to Extra utilities power on the Preferences step", async () => {
  const plan = generated();
  review(plan);
  const note = plain($('[data-review-power-note]')?.textContent);
  assert.ok(note.includes('20% of the production lines for trains, drones and pumps'), note);
  const button = $<HTMLButtonElement>('[data-review-preferences]')!;
  assert.equal(plain(button.textContent), 'Change Extra utilities power in Preferences');
  assert.equal(button.type, 'button', 'it does not create the profile');
  button.click();
  await tick();
  render();
  assert.equal(wizard?.step, 2);
  assert.ok($('#wizard-form [name="utilityPercent"]'), 'the Preferences step shows the setting');
});

test("the Resources page's link opens Preferences for a new profile from this profile", async () => {
  const plan = generated();
  plan.settings.utilityPercent = 35;
  page();
  open({ calculated: structuredClone(plan), phase: '3', profileId: 'original' });
  // Another tab opened profile p last (#1052): the link still starts from this tab's profile.
  workspace.saves[0]!.activeProfile = 'p';
  go('resources');
  render();
  const button = $<HTMLButtonElement>('[data-power-preferences]')!;
  assert.match(plain(button.textContent), /^Change Extra utilities power in Preferences/);
  button.click();
  await tick();
  render();
  assert.equal(wizard?.mode, 'advanced');
  assert.equal(wizard?.step, 2);
  assert.equal(wizard?.saveId, 's');
  assert.equal(wizard?.carryFrom, 'original', 'progress is offered from this profile');
  assert.deepEqual(
    wizard?.settings,
    workspace.saves[0]!.profiles.find(profile => profile.id === 'original')!.settings,
  );
  assert.ok($('#wizard-form [name="utilityPercent"]'));
});
