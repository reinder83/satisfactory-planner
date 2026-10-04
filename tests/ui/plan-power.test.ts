// The build plan's power figures with spare existing power in the settings (#1048): the summary
// line names the spare power beside the new generation, and the lead step, "Power available now",
// builds on it. Numbers are written as in en-US.
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { $, generated, open, page } from './setup.ts';

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

test('the summary names the spare existing power beside the new power', () => {
  const plan = generated();
  plan.settings.availablePowerGW = 44.425;
  plan.settings.installedPowerGW = 44.425;
  open({ calculated: plan });
  render();
  assert.equal(
    summaryPower(),
    `${power(plan.stages['3'].generationMW)} new power + 44.43 GW existing spare power`,
  );
  assert.match(summaryPower(), /^[\d.]+ (MW|GW) new power \+ 44\.43 GW existing spare power$/);
  // The lead step is "Power available now", and it starts from that figure.
  const lead = $('#main [data-open-steps] > .task.lead')!;
  assert.equal(lead.querySelector('summary')!.textContent, 'Power available now');
  assert.match(
    lead.querySelector('details > p')!.textContent!,
    /^You have 44\.43 GW of spare power available, which covers this phase's /,
  );
});

test('without spare power the summary is the new power alone, as before', () => {
  const plan = generated();
  assert.equal(plan.settings.availablePowerGW, 0);
  open({ calculated: plan });
  render();
  assert.equal(summaryPower(), `${power(plan.stages['3'].generationMW)} new power`);
});

test('with augmenters the summary adds their boost, as the Resources bar does (#1050 review)', () => {
  const plan = generated();
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
