// Augmenters and the somersloop budget (#1059). Review's fuel verdict compares like with like: the
// power the fuel adds to Phase 5's grid against the demand it adds, the headline following that
// balance, with the buildings (or hours) of both plans beside it. The ledger on All settings step 2
// follows the fields as they are typed and shows the real budget, a commitment beyond it as a
// warning. A stored plan that commits more than its budget keeps its numbers and its pages say
// so. Numbers are written as in en-US.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, catalog, generated, go, open, page } from './setup.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';
import type { CurrentCalculatedPlan, FuelVerdict } from '../../public/types/index.ts';

const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  HTMLFormElement.prototype.reportValidity = () => true;
});

function wizardAt(
  step: number,
  settings: Partial<WizardSettings>,
  preview?: CurrentCalculatedPlan,
) {
  page();
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: preview ?? null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  } as WizardDraft);
  go('wizard');
  render();
}

// Review of a plan with `augmenters` (`fueled` of them fueled) and this verdict on Phase 5.
function reviewWith(verdict: FuelVerdict, augmenters = 1, fueled = 1, goal = 'balanced') {
  const plan = generated();
  Object.assign(plan.settings, { somersloops: 106, augmenters, fueledAugmenters: fueled, goal });
  plan.stages['5']!.fuelVerdict = verdict;
  wizardAt(5, {}, plan);
  return $('[data-fuel-verdict]');
}
const GW = 1000;
const verdict = (fields: Partial<FuelVerdict>): FuelVerdict => ({
  unfueledFeasible: true,
  buildings: 733,
  buildingsUnfueled: 557,
  requiredMW: 140 * GW,
  requiredMWUnfueled: 40 * GW,
  availableMW: 300 * GW,
  availableMWUnfueled: 63 * GW,
  hours: 10,
  hoursUnfueled: 10,
  matrixRate: 5,
  worthIt: false,
  ...fields,
});

// The issue's first case: the fuel adds 237 GW for 100 GW of demand, and the plan builds more.
// Before #1059 that read "costs more than it returns".
test('237 GW returned for 100 GW of demand returns more power than it costs', () => {
  const notice = reviewWith(verdict({ gainMW: 237 * GW }))!;
  assert.equal(notice.dataset.fuelVerdict, 'pays');
  assert.ok(notice.classList.contains('info'));
  const words = notice.textContent!.replace(/\s+/g, ' ').trim();
  assert.match(words, /^Fueling these augmenters returns more power than it costs\./);
  assert.match(
    words,
    /In Phase 5 the fuel raises the multiplier from 10% to 30%, which adds 237 GW to the grid, and producing its 5 Alien Power Matrix\/min adds 100 GW to the demand: a net gain of 137 GW\./,
  );
  assert.match(words, /Phase 5 has 733 buildings fueled against 557 unfueled \(\+176\)\./);
  assert.match(
    words,
    /The generators it saves are fewer than the fuel line's buildings, so here it adds buildings: fuel the augmenter when you will use the extra power elsewhere\.$/,
  );
  assert.doesNotMatch(words, /costs more/);
});

// The issue's second case: 129 GW for 123 GW of demand, with fewer buildings. Before #1059 that
// read "pays off" beside two numbers that hardly differ; now it says by how much.
test('129 GW returned for 123 GW of demand says the net gain and the buildings it saves', () => {
  const notice = reviewWith(
    verdict({
      gainMW: 129 * GW,
      requiredMW: 163 * GW,
      buildings: 1900,
      buildingsUnfueled: 1950,
      worthIt: true,
    }),
    4,
    2,
  )!;
  assert.equal(notice.dataset.fuelVerdict, 'pays');
  const words = notice.textContent!.replace(/\s+/g, ' ').trim();
  assert.match(words, /^Fueling these augmenters returns more power than it costs\./);
  assert.match(words, /raises the multiplier from 40% to 80%, which adds 129 GW to the grid/);
  assert.match(words, /adds 123 GW to the demand: a net gain of 6 GW\./);
  assert.match(words, /Phase 5 has 1,900 buildings fueled against 1,950 unfueled \(−50\)\./);
  assert.match(
    words,
    /The extra power saves more generators than the fuel line costs, so the plan builds 50 fewer buildings\.$/,
  );
});

test('a fuel line that draws more than the multiplier adds costs more power than it returns', () => {
  const notice = reviewWith(
    verdict({ gainMW: 12.1 * GW, requiredMW: 70 * GW, requiredMWUnfueled: 24.1 * GW }),
  )!;
  assert.equal(notice.dataset.fuelVerdict, 'costs');
  assert.ok(notice.classList.contains('warn'));
  const words = notice.textContent!.replace(/\s+/g, ' ').trim();
  assert.match(words, /^Fueling these augmenters costs more power than it returns\./);
  assert.match(
    words,
    /adds 12.1 GW to the grid, .* adds 45.9 GW to the demand: a net loss of 33.8 GW\./,
  );
  assert.match(
    words,
    /Build the augmenter unfueled, or put 4 somersloops in the Alien Power Matrix encoder/,
  );
});

test('under maximum output the verdict gives the hours, and a verdict without a gain uses the boost', () => {
  const notice = reviewWith(
    verdict({ gainMW: undefined, hours: 9.5, hoursUnfueled: 10, worthIt: true }),
    2,
    2,
    'maximum',
  )!;
  const words = notice.textContent!.replace(/\s+/g, ' ').trim();
  // A verdict calculated before #1059: the rise in available power stands in for the gain.
  assert.match(words, /from 20% to 60%, which adds 237 GW to the grid/);
  assert.match(words, /Phase 5 takes about 9 h 30 min fueled against about 10 h unfueled\./);
  assert.match(words, /The extra power lets Phase 5 finish sooner\.$/);
  assert.doesNotMatch(words, /buildings/);
});

test('fueled augmenters a plan cannot do without are said to carry it', () => {
  const notice = reviewWith(verdict({ unfueledFeasible: false, buildingsUnfueled: null }))!;
  assert.equal(notice.dataset.fuelVerdict, 'carrying');
  assert.match(notice.textContent!, /Fueled augmenters are carrying this plan/);
});

// Typing in a field of the step without leaving it.
async function type(name: string, value: string) {
  const input = $<HTMLInputElement>(`[name=${name}]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

test('the ledger follows the fields as they are typed and shows the real budget', async () => {
  wizardAt(2, {});
  assert.equal(text('[data-sloop-committed]'), '0');
  assert.equal(text('[data-sloop-available]'), '0');
  await type('somersloops', '106');
  await type('augmenters', '10');
  await type('fueledAugmenters', '10');
  assert.equal(text('[data-sloop-available]'), '106', 'the budget as typed');
  assert.match(text('[data-sloop-ledger]'), /10 augmenters cost 100 sloops/);
  assert.match(text('[data-sloop-ledger]'), /Fueling 10 of them adds 50 Alien Power Matrix\/min/);
  assert.match(
    text('[data-sloop-ledger]'),
    /Committed: 100 of 106 available \(100 for 10 Alien Power Augmenters\)\./,
  );
  assert.ok($('[data-sloop-ledger]')!.classList.contains('info'));
  // The issue's 191 of 106: amplification and the three hand-fed lines on top.
  await type('amplifySloops', '88');
  for (const box of $$<HTMLInputElement>('input[name=sloop]')) {
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await nextTick();
  const ledger = $('[data-sloop-ledger]')!;
  assert.ok(ledger.classList.contains('warn'), 'more than the budget is a warning');
  assert.match(
    text('[data-sloop-ledger]'),
    /Committed: 191 of 106 available \(100 for 10 Alien Power Augmenters, 3 parked in hand-fed lines and 88 for production amplification\)\. That is 85 more than you have, so Review will not calculate this plan/,
  );
  assert.match(text('#main'), /Production amplification will place up to 88 somersloops/);
  // Nothing is written to the draft while typing, so a box being cleared is not filled back in.
  assert.equal(wizard!.settings.somersloops, 0);
  await type('somersloops', '');
  assert.equal($<HTMLInputElement>('[name=somersloops]')!.value, '');
  assert.equal(text('[data-sloop-available]'), '0');
  // Within the budget again.
  await type('somersloops', '106');
  await type('amplifySloops', '3');
  assert.match(text('[data-sloop-ledger]'), /Committed: 106 of 106 available/);
  assert.ok($('[data-sloop-ledger]')!.classList.contains('info'));
});

// A plan stored before the budget was a hard limit: 191 of 106 somersloops committed.
function overCommitted(): CurrentCalculatedPlan {
  const plan = generated();
  Object.assign(plan.settings, {
    somersloops: 106,
    augmenters: 10,
    fueledAugmenters: 0,
    amplifySloops: 88,
    sloopReserved: ['biofuel', 'dna', 'shards'],
  });
  return plan;
}

test('a stored plan that commits more somersloops than it has keeps its numbers, with a warning', () => {
  for (const view of ['plan', 'factories', 'resources'] as const) {
    page();
    const plan = overCommitted();
    const stored = structuredClone(plan);
    open({ calculated: plan, phase: '5' });
    go(view);
    render();
    const notice = $('[data-sloop-overcommit]');
    assert.ok(notice, `${view}: the warning is shown`);
    assert.ok(notice.classList.contains('warn'));
    assert.equal(
      notice.textContent!.replace(/\s+/g, ' ').trim(),
      'More somersloops than you have. This plan commits 191 somersloops (100 for 10 Alien Power Augmenters, 3 parked in hand-fed lines and 88 for production amplification), but only 106 are available to spend. The plan was calculated before plans were held to that budget, so it keeps its numbers, Phase 5’s power from 10 augmenters included. Recalculating it is refused until the somersloops it commits fit the ones available. Change somersloops in Edit settings →',
    );
    assert.deepEqual(plan, stored, `${view}: the plan is not changed`);
  }
  // A plan within its budget has none.
  page();
  const fits = generated();
  Object.assign(fits.settings, { somersloops: 106, augmenters: 10, amplifySloops: 6 });
  open({ calculated: fits, phase: '5' });
  go('plan');
  render();
  assert.equal($('[data-sloop-overcommit]'), null);
});
