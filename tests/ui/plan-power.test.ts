// The build plan's power figures (#1048, #1064): the summary line gives what the phase has
// against what it needs, as the Resources page's bar and the power step give them (powerView in
// public/power.ts), and with spare existing power in the settings the lead step, "Power available
// now", builds on it. A plan stored before #1064 keeps its old summary: the new power, what the
// augmenters add and the spare existing power. Numbers are written as in en-US.
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { power } from '../../public/app/wizard/fields.ts';
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

test('with augmenters a stored summary adds their boost, as the Resources bar does (#1050 review)', () => {
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
    `${power(stage.generationMW)} new power + 3 GW augmenter boost + 20 GW existing spare power`,
  );
});
