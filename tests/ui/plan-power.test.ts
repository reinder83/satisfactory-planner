// The build plan's power figures (#1048, #1064): the summary line gives what the phase has
// against what it needs, as the Resources page's bar and the power step give them (powerView in
// public/power.ts), and with spare existing power in the settings the lead step, "Power available
// now", builds on it. A plan stored before #1064 keeps its old summary: the new power, what the
// augmenters add and the spare existing power. Numbers are written as in en-US.
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { powerView } from '../../public/power.ts';
import { $, generated, generatedWith, open, page } from './setup.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';

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

const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const summaryPower = () =>
  $('#main [data-plan-summary] [data-summary="power"]')!.textContent!.trim();

// `plan` as a release before #1064 stored it: no grid on any stage.
function storedBefore1064(plan: StoredCalculatedPlan): StoredCalculatedPlan {
  const copy = structuredClone(plan);
  for (const stage of Object.values(copy.stages)) delete stage.grid;
  return copy;
}

test('the summary gives the power the phase has for what it needs, spare power included', () => {
  const plan = generatedWith({ availablePowerGW: 44.425, installedPowerGW: 44.425 });
  const grid = plan.stages['3'].grid!;
  assert.equal(grid.spareMW, 44425, 'the spare power counts');
  open({ calculated: plan });
  render();
  assert.equal(
    summaryPower(),
    `${power(grid.availableMW)} of power for ${power(grid.needMW)} needed`,
  );
  // The lead step is "Power available now", and it starts from the spare power.
  const lead = $('#main [data-open-steps] > .task.lead')!;
  assert.equal(lead.querySelector('summary')!.textContent, 'Power available now');
  assert.match(
    lead.querySelector('details > p')!.textContent!,
    /^You have 44\.43 GW of spare power available, which covers this phase's /,
  );
}, 60000);

test('without spare power the summary is the generators against the need', () => {
  const plan = generated();
  assert.equal(plan.settings.availablePowerGW, 0);
  const grid = plan.stages['3'].grid!;
  assert.equal(grid.availableMW, grid.generationMW);
  open({ calculated: plan });
  render();
  assert.equal(
    summaryPower(),
    `${power(grid.availableMW)} of power for ${power(grid.needMW)} needed`,
  );
});

test('a plan stored before #1064 keeps its summary: the new power and the spare power', () => {
  const plan = storedBefore1064(generated());
  plan.settings.availablePowerGW = 44.425;
  open({ calculated: plan });
  render();
  assert.equal(
    summaryPower(),
    `${power(plan.stages['3'].generationMW)} new power + 44.43 GW existing spare power`,
  );
  page();
  const none = storedBefore1064(generated());
  open({ calculated: none });
  render();
  assert.equal(summaryPower(), `${power(none.stages['3'].generationMW)} new power`);
});

test('with augmenters a stored summary adds what they add, as the Resources bar does (#1050 review)', () => {
  const plan = storedBefore1064(generated());
  const stage = plan.stages['3'];
  plan.settings.availablePowerGW = 20;
  plan.settings.installedPowerGW = 40;
  // What the augmenters add on top of the new generation and the spare power, as availableMW
  // holds it: 3 GW here.
  stage.augmenters = 2;
  stage.availableMW = (stage.generationMW || 0) + 20000 + 3000;
  open({ calculated: plan });
  render();
  assert.equal(
    summaryPower(),
    `${power(stage.generationMW)} new power + 3 GW from 2 augmenters + 20 GW existing spare power`,
  );
});

// Phase 5 with augmenters and new generators (#1020, from the #1050 re-review): the summary, the
// Resources page's bar and "Power available now" split the power one way, as stageSupply and a
// plan with a grid do: the new generators with the augmenters' boost on them, and what the
// augmenters add besides (their 500 MW each and their boost on installed generation). The
// summary used to put the boost on the new generators with the augmenters, as the bar did, while
// the step counted it with the generators. The totals are unchanged.
test("a stored plan's summary, bar and power step split the augmenters' boost alike", () => {
  const plan = storedBefore1064(generated());
  const stage = plan.stages['3'];
  plan.settings.availablePowerGW = 1;
  plan.settings.installedPowerGW = 1;
  const generation = stage.generationMW || 0;
  assert.ok(generation > 100, 'the phase builds generators');
  // 4 augmenters, fuelled: 2 GW and a 40% boost on the base production (the new generation and
  // 1 GW installed), as the planner stored availableMW before #1064.
  stage.augmenters = 4;
  stage.augmenterMW = 2000;
  stage.boost = 0.4;
  stage.availableMW = generation * 1.4 + 1000 + 2000 + 400;
  const boosted = generation * 1.4,
    augmenters = 2400;
  open({ calculated: plan });
  render();
  assert.equal(
    summaryPower(),
    `${power(boosted)} new power with the augmenters' boost + ${power(augmenters)} from 4 augmenters + ${power(1000)} existing spare power`,
  );
  const view = powerView(stage, plan.settings);
  const part = (key: string) => view.supply.find(entry => entry.key === key)!;
  close(part('generation').mw, boosted, 'the bar gives the new generators with the boost');
  assert.match(part('generation').caption, /with the augmenters' boost/);
  close(part('boost').mw, augmenters, 'and the augmenters their own part');
  close(part('spare').mw, 1000, 'the spare power');
  close(view.availableMW, stage.availableMW, 'the total is as stored');
  const step = $('[data-task="startup-3-power-review"] p')!.textContent!;
  assert.match(step, new RegExp(`your 4 augmenters add ${escaped(power(augmenters))}`));
  assert.match(step, new RegExp(`which (provides|adds) ${escaped(power(boosted))}`));
});
