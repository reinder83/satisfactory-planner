// #1064: every page gives a phase's power from one model (powerView in public/power.ts), so the
// Resources page's bar, the notice over the build plan, the build plan's summary and "Power
// available now", and Review's Power needed column always agree, on every phase of several
// profiles: new plans (exact, with spare power, with Phase 5's augmenters) and a plan the first
// release stored, which keeps its own figures. Before #1064 the bar, the notice and Review each
// read the stage differently, and Review said "Within entered limits" whatever the power.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { powerView } from '../../public/power.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type { Phase, StoredCalculatedPlan } from '../../public/types/index.ts';

// The numbers read as in en-US, so a figure is found the same way on every page.
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

const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();

// What each page says about `phase` of `plan`.
function resourcesBar(plan: StoredCalculatedPlan, phase: Phase) {
  page();
  open({ calculated: structuredClone(plan), phase });
  go('resources');
  render();
  return {
    figures: plain($('[data-power-headline] > span')?.textContent),
    short: !!$('.power-headline.short'),
  };
}
function buildPlan(plan: StoredCalculatedPlan, phase: Phase) {
  page();
  open({ calculated: structuredClone(plan), phase });
  go('plan');
  render();
  return {
    summary: plain($('[data-plan-summary] [data-summary="power"]')?.textContent),
    notice: plain($('#main [data-power-short]')?.textContent),
    lead: plain($('#main [data-open-steps] > .task.lead details > p')?.textContent),
  };
}
function reviewCells(plan: StoredCalculatedPlan) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 5,
    saveId: null,
    saveName: 'World',
    name: 'Power',
    settings: structuredClone(generated().settings),
    preview: structuredClone(plan),
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
  return Object.fromEntries(
    $$('table tbody tr').map(row => [
      plain(row.querySelector('td')?.textContent),
      // The need and what it has; what it holds is under it (#1090, power-allowance.test.ts).
      plain(row.querySelector('[data-review-power]')?.textContent).replace(/ incl\. .*$/, ''),
    ]),
  );
}

function checkPlan(plan: StoredCalculatedPlan, label: string) {
  // Start in Phase 1, so every phase is planned and shown.
  plan.settings.phase = '1';
  const review = reviewCells(plan);
  for (const phase of ['1', '2', '3', '4', '5'] as const) {
    const stage = plan.stages[phase];
    if (!stage.feasible) continue;
    const view = powerView(stage, plan.settings);
    const need = power(view.needMW),
      have = power(view.availableMW),
      where = `${label}, Phase ${phase}`;
    // The Resources page's bar.
    const bar = resourcesBar(plan, phase);
    assert.equal(bar.figures, `${need} needed of ${have} available`, where);
    assert.equal(bar.short, view.shortMW > 0, where);
    // The build plan: its notice asks for exactly the shortfall, its summary gives the same two
    // figures for a plan with its own power model.
    const built = buildPlan(plan, phase);
    if (view.shortMW > 0) assert.ok(built.notice.includes(power(view.shortMW)), where);
    else assert.equal(built.notice, '', `${where}: no notice`);
    if (view.modelled)
      assert.equal(built.summary, `${have} of power for ${need} needed`, `${where}: summary`);
    // "Power available now" names the same need when it builds on spare power.
    if (view.spareMW + view.augmenterMW > 0 && phase !== '1')
      assert.ok(built.lead.includes(need), `${where}: ${built.lead}`);
    // Review's Power needed column.
    assert.equal(
      review[phase],
      view.shortMW > 0
        ? phase === '1'
          ? `${need} from biomass`
          : `Short by ${power(view.shortMW)} of ${need}`
        : `${need} of ${have}`,
      `${where}: Review`,
    );
  }
}

test('the bar, the notice, the summary, the power step and Review agree on a new plan', () => {
  checkPlan(generated(), 'default');
});

test('they agree with spare power and with Phase 5 augmenters', () => {
  checkPlan(generatedWith({ availablePowerGW: 2, installedPowerGW: 2 }), 'spare power');
  checkPlan(
    generatedWith({
      availablePowerGW: 3,
      installedPowerGW: 5,
      augmenters: 2,
      fueledAugmenters: 1,
      somersloops: 40,
    }),
    'augmenters',
  );
}, 120000);

test('they agree on a plan the first release stored, which keeps its own figures', () => {
  const stored: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
  );
  assert.equal(stored.stages['3'].grid, undefined);
  checkPlan(stored, 'stored');
});
