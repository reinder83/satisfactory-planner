// Mining and belts per phase (#1065) on the pages: the Resources page gives the phase's own
// budgets and the miners and extractors its draw taps, the build plan has the mining step and the
// milestones of the belts it uses, Logistics names each mined resource's nodes and what a belt mark
// still needs, the wizard's budgets step offers the per-phase budgets (on for a new plan, kept as
// the profile had it otherwise) and Review names each phase's miner. A plan stored before #1065
// shows none of it and keeps its entered budgets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { bestLane, laneUnlockNote } from '../../public/app/flow.ts';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { readWizard, startWizard } from '../../public/app/wizard/wizard.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { phaseForTier } from '../../public/preferences.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type {
  Catalog,
  CurrentCalculatedPlan,
  Phase,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';
import type { WizardSettings } from '../../public/app/wizard/wizard.ts';

// The numbers read as in en-US, whatever the machine's locale.
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

let items: Catalog;
let mined: CurrentCalculatedPlan;
beforeEach(() => {
  items ??= catalog();
  mined ??= generatedWith({ phase: '3', wholeMachines: true, phaseMining: true });
  page();
});
const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();
// A plan stored before #1065 (main at ce5b9ec).
const stored: StoredCalculatedPlan = JSON.parse(
  fs.readFileSync('tests/fixtures/plan-before-1065.json', 'utf8'),
).plan;

// The Budget column of the Resources page, per resource.
const budgets = () =>
  Object.fromEntries(
    $$('table tbody tr').map(row => [
      plain(row.querySelector('.resource-name')?.textContent),
      plain(row.querySelectorAll('td')[2]?.textContent),
    ]),
  );

test('the Resources page gives the phase’s own budgets and the nodes its draw taps', () => {
  open({ calculated: structuredClone(mined), phase: '4', workspace: { catalog: items } });
  go('resources');
  render();
  // Phase 4 overclocks to 250% with Power Shards (owner's choice on #1096), a pure node capped at
  // the 780/min of its Mk.5 belt: about 79% of the entered 92,100/min.
  assert.equal(budgets()['Iron Ore'], '72,780/min', 'Miner Mk.3 at 250% on Mk.5 belts');
  assert.equal(budgets()['Crude Oil'], '9,900 m³/min');
  const panel = $('[data-mining]')!;
  assert.match(
    plain(panel.querySelector('[data-mining-equipment]')?.textContent),
    /^Miner Mk\.3 at 250% · Mk\.5 belts \(780\/min\) · Mk\.2 pipes \(600 m³\/min\)$/,
  );
  const iron = plain(panel.querySelector('[data-mining-resource="Iron Ore"]')?.textContent);
  assert.match(iron, /^Iron Ore [\d,.]+\/min\. Tap \d+ pure nodes? with Miner Mk\.3: /);
  // A pure node at 250% fills its Mk.5 belt at 162.5%, with two Power Shards.
  assert.match(iron, / at 162\.5% \(\d[\d,.]* [MG]W, \d+ Power Shards\)\.$/);
  // The power bar says the extraction is the nodes this phase taps.
  assert.match(
    plain($('[data-power-part="extraction"] small')?.textContent),
    /^Miner Mk\.3 at 250% on the nodes this phase taps, best first/,
  );
  // Crude oil's extractors at 100% and at 250% in Phase 4, and only at 100% in Phase 3, whose
  // budgets count on no Power Shards.
  const oil = () => plain($('[data-mining-resource="Crude Oil"]')?.textContent);
  assert.match(oil(), /At 100%: tap .*; at 250%: tap .*Power Shards/);
  page();
  open({ calculated: structuredClone(mined), phase: '3', workspace: { catalog: items } });
  go('resources');
  render();
  assert.equal(
    plain($('[data-mining-equipment]')?.textContent).split(' · ')[0],
    'Miner Mk.2 at 100%',
  );
  assert.match(oil(), /At 100%: tap /);
  assert.doesNotMatch(oil(), /250%|Power Shard/);
});

test('a plan stored before #1065 keeps its entered budgets and shows no mining panel', () => {
  open({ calculated: structuredClone(stored), phase: '4', workspace: { catalog: items } });
  go('resources');
  render();
  assert.equal($('[data-mining]'), null);
  assert.equal(budgets()['Iron Ore'], '92,100/min');
  assert.match(
    plain($('[data-power-part="extraction"] small')?.textContent),
    /^Miner Mk\.3 at 250% on normal nodes/,
  );
  go('plan');
  render();
  assert.equal($('[data-task="mining-4"]'), null);
});

test('the build plan has the phase’s mining step and asks for Logistics Mk.5 in Phase 4', () => {
  open({ calculated: structuredClone(mined), phase: '4' });
  go('plan');
  render();
  const step = $('[data-task="mining-4"]')!;
  assert.equal(plain(step.querySelector('summary')?.textContent), 'Tap the resource nodes');
  assert.match(plain(step.querySelector('p')?.textContent), /^Phase 4 mines with Miner Mk\.3/);
  assert.ok($('[data-task="unlock-Schematic_7-2_C"]'), 'Tier 7: Logistics Mk.5');
});

test('Logistics names each mined resource’s nodes and what its belts still need', () => {
  open({
    calculated: structuredClone(mined),
    phase: '4',
    state: { factoryGroups: defaultFactoryGroups(mined) },
  });
  go('logistics');
  render();
  const iron = $('[data-group-card][data-group="supply/Iron Ore"] [data-mining-source]');
  assert.match(plain(iron?.textContent), /^Tap \d+ pure nodes? with Miner Mk\.3/);
  assert.equal(
    plain($('[data-lane-unlock]')?.textContent),
    'Mk.5 belts need Tier 7 · Logistics Mk.5, which is not ticked yet: until then, plan with Mk.4 belts (480/min). Mk.2 pipes need Tier 6 · Pipeline Engineering Mk.2, which is not ticked yet: until then, plan with Mk.1 pipes (300 m³/min).',
  );
  // Ticked, the marks need nothing more.
  page();
  open({
    calculated: structuredClone(mined),
    phase: '4',
    state: {
      factoryGroups: defaultFactoryGroups(mined),
      checks: { 'unlock-Schematic_7-2_C': true, 'unlock-Schematic_6-5_C': true },
    },
  });
  go('logistics');
  render();
  assert.equal($('[data-lane-unlock]'), null);
});

test('property: no phase’s belts or pipes come before their tier, unless their unlock is ticked', () => {
  for (const phase of ['1', '2', '3', '4', '5'] as Phase[]) {
    page();
    open({ calculated: structuredClone(mined), phase });
    for (const fluid of [false, true]) {
      const lane = bestLane(fluid, phase);
      // Mk.1 is the fallback: Phase 1 has no pipes yet, and pumps nothing.
      if (lane.mark === 'Mk.1') continue;
      assert.ok(!lane.milestone || lane.milestone.phase <= Number(phase), `Phase ${phase}`);
      assert.ok(!lane.milestone || phaseForTier(lane.milestone.tier) <= Number(phase));
      // Until its unlock is ticked, the advice names the mark before it.
      if (lane.milestone && lane.mark !== 'Mk.1')
        assert.match(laneUnlockNote(lane), /which is not ticked yet: until then, plan with Mk\./);
    }
  }
});

// A draft at step `step` of the five steps, with `settings` over the default plan's.
function draftAt(step: number, settings: Partial<WizardSettings> = {}) {
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  return wizard!;
}

test('a new plan’s budgets follow each phase; a draft from a profile keeps its choice', () => {
  open({ workspace: { catalog: items, saves: [] } });
  startWizard();
  assert.equal(wizard!.settings.phaseMining, true, 'a new plan');
  page();
  open({ workspace: { catalog: items } });
  startWizard('s');
  assert.equal('phaseMining' in wizard!.settings, false, 'the profile had none');
});

test('the budgets step offers the per-phase budgets with each phase’s share, and reads the box', () => {
  open({ workspace: { catalog: items } });
  draftAt(4, { phaseMining: true, phase: '1' });
  go('wizard');
  render();
  const box = $<HTMLInputElement>('[name="phaseMining"]')!;
  assert.equal(box.checked, true);
  const rows = $$('[data-phase-budgets] tbody tr').map(row => plain(row.textContent));
  assert.equal(rows.length, 5);
  assert.match(rows[0]!, /^1 Miner Mk\.1 at 100% · Mk\.2 belts \(120\/min\).* 10%$/);
  assert.match(rows[3]!, /^4 Miner Mk\.3 at 250% · Mk\.5 belts \(780\/min\).* 77\.6–100%$/);
  assert.match(rows[4]!, /^5 Miner Mk\.3 at 250% · Mk\.6 belts \(1,200\/min\).* 100%$/);
  // Read with the form: unticked turns it off.
  box.checked = false;
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal(wizard!.settings.phaseMining, false);
  page();
  open({ workspace: { catalog: items } });
  draftAt(4, {});
  go('wizard');
  render();
  assert.equal($<HTMLInputElement>('[name="phaseMining"]')!.checked, false);
  assert.equal($('[data-phase-budgets]'), null);
  assert.match(plain($('#wizard-form')?.textContent), /Off: every phase plans with these budgets/);
});

// "Miners you already have" (#1068): under the box, a choice that raises every phase's miner; the
// table follows it at once, and the form reads it only with the box ticked.
test('the budgets step offers the miners you already have, and the table follows them', async () => {
  open({ workspace: { catalog: items } });
  draftAt(4, { phaseMining: true, phase: '3' });
  go('wizard');
  render();
  const select = $<HTMLSelectElement>('select[data-owned-miner]')!;
  assert.ok(select, 'offered with the box ticked');
  assert.equal(select.value, '', 'none by default');
  const phaseThree = () => plain($$('[data-phase-budgets] tbody tr')[0]!.textContent);
  assert.match(phaseThree(), /^3 Miner Mk.2 at 100%/);
  select.value = '3';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  assert.match(phaseThree(), /^3 Miner Mk.3 at 100%/, 'the table follows the choice');
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal(wizard!.settings.ownedMiner, 3);
  // Unticking the box drops it: the choice means nothing without mining per phase.
  $<HTMLInputElement>('[name="phaseMining"]')!.checked = false;
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal('ownedMiner' in wizard!.settings, false);
  page();
  open({ workspace: { catalog: items } });
  draftAt(4, {});
  go('wizard');
  render();
  assert.equal($('select[data-owned-miner]'), null, 'not offered with the box clear');
});

test('Review names the miner and belts each phase’s budgets follow', () => {
  open({ workspace: { catalog: items } });
  const draft = draftAt(5, { phaseMining: true, phase: '3', wholeMachines: true });
  draft.preview = structuredClone(mined);
  go('wizard');
  render();
  const cells = $$('table tbody tr').map(row => plain(row.textContent));
  assert.ok(cells.some(text => text.includes('Within Miner Mk.2 at 100% on Mk.4 belts')));
  assert.ok(cells.some(text => text.includes('Within Miner Mk.3 at 250% on Mk.6 belts')));
});
