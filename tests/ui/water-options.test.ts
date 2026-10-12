// Water Extractors in both options on the pages (#1142): a production line's dialog and a
// factory's flow page give the 100% and the overclocked option, the suggested one first; the
// build plan's "Tap the resource nodes" table has a Water row with both and "Power available now"
// says which one the power counts; before Power Shards the overclocked option is the research
// advice. The wizard's setting only says which one is suggested, and Edit settings names it so.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { flowRoute, setQuery, setWizard, viewOf, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { readWizard } from '../../public/app/wizard/wizard.ts';
import { settingsChanges } from '../../public/app/profile-edit.ts';
import { homeGroup } from '../../public/app/group-order.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { carryOptions } from '../../public/state.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type { Catalog, CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';
import type { WizardSettings } from '../../public/app/wizard/wizard.ts';

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
  setQuery('');
});

let items: Catalog;
let plain100: CurrentCalculatedPlan,
  overclocked: CurrentCalculatedPlan,
  early: CurrentCalculatedPlan;
beforeEach(() => {
  items ??= catalog();
  plain100 ??= generatedWith({ phase: '4', phaseMining: true });
  overclocked ??= generatedWith({ phase: '4', phaseMining: true, waterOverclock: true });
  early ??= generatedWith({ phase: '2', phaseMining: true });
  page();
  setQuery('');
});
const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();

// The first line of `plan`'s Phase `phase` that extracts Water for itself (Alumina Solution in
// Phase 4, Coal power in Phase 2).
const waterLine = (plan: CurrentCalculatedPlan, phase: '2' | '4', name: string) => {
  const row = plan.stages[phase].rows!.find(candidate => candidate.name === name);
  assert.ok(row, `${name} in Phase ${phase}`);
  return row;
};
function openPlan(plan: CurrentCalculatedPlan, phase: Phase) {
  open({
    calculated: structuredClone(plan),
    phase,
    state: { factoryGroups: defaultFactoryGroups(plan) },
  });
  render();
}
const dialogExtractors = () => plain($('#detail [data-extractors]')?.textContent);

test("a production line's dialog gives both options, the suggested one first", () => {
  openPlan(plain100, '4');
  openCalculatedFactory(waterLine(plain100, '4', 'Alumina Solution').id);
  assert.match(
    dialogExtractors(),
    /^Water Extractors at 100% \(suggested\): 1 at 100% \+ 1 at [\d.]+% \(2 extractors, [\d.]+ MW\)\. Or overclocked up to 250%: 1 at [\d.]+% \(1 extractor, 1 Power Shard, [\d.]+ MW\)\.$/,
  );
  page();
  openPlan(overclocked, '4');
  openCalculatedFactory(waterLine(overclocked, '4', 'Alumina Solution').id);
  assert.match(
    dialogExtractors(),
    /^Water Extractors overclocked up to 250% \(suggested\): 1 at [\d.]+% \(1 extractor, 1 Power Shard, [\d.]+ MW\)\. Or at 100%: 1 at 100% \+ 1 at [\d.]+% \(2 extractors, [\d.]+ MW\)\.$/,
  );
});

test('before Power Shards the overclocked option is the research advice', () => {
  openPlan(early, '2');
  openCalculatedFactory(waterLine(early, '2', 'Coal power').id);
  assert.match(
    dialogExtractors(),
    /^Water Extractors at 100% \(suggested\): 1 at 100% \+ 1 at [\d.]+% \(2 extractors, [\d.]+ MW\)\. Or overclocked up to 250%, with fewer extractors: research Power Shards in the MAM \(Blue Power Slugs, then Overclock Production\) first\.$/,
  );
});

test("a factory's flow page gives both options under the line", async () => {
  const groups = defaultFactoryGroups(overclocked);
  const row = waterLine(overclocked, '4', 'Alumina Solution');
  const group = homeGroup(row, groups);
  assert.ok(group, 'the line has a factory');
  open({ calculated: structuredClone(overclocked), phase: '4', state: { factoryGroups: groups } });
  location.hash = '#' + flowRoute(group);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
  const advice = $$(`#main .gf-card[data-line="${row.id}"] .gf-advice`)
    .map(element => plain(element.textContent))
    .find(text => text.includes('Water Extractors'));
  assert.match(
    advice ?? '',
    /Water Extractors overclocked up to 250% \(suggested\): .+\. Or at 100%: .+\.$/,
  );
});

test('the build plan: a Water row in "Tap the resource nodes", and the power step names the option', () => {
  for (const [plan, first, second] of [
    [
      plain100,
      /^Water Extractor at 100% \(suggested\): /,
      /\. Overclocked up to 250%: .+Power Shard/,
    ],
    [
      overclocked,
      /^Water Extractor overclocked up to 250% \(suggested\): /,
      /\. At 100%: .+ extractors/,
    ],
  ] as const) {
    page();
    open({ calculated: structuredClone(plan), phase: '4' });
    go('plan');
    render();
    const table = $('[data-task="mining-4"] [data-step-table]')!;
    assert.ok(table, 'the mining table');
    const water = [...table.querySelectorAll('[data-step-table-row]')].find(
      row => plain(row.querySelector('th')?.textContent) === 'Water',
    );
    assert.ok(water, 'a Water row');
    const cells = [...water.querySelectorAll('td')].map(cell => plain(cell.textContent));
    assert.match(cells[0]!, /^[\d,.]+ m³\/min$/);
    assert.equal(cells[1], 'None: any open water');
    assert.match(cells[2]!, first);
    assert.match(cells[2]!, second);
    assert.match(
      plain(table.querySelector('[data-step-table-after]')?.textContent),
      /The Water row counts all of this phase's Water together/,
    );
    const power = plain($('[data-task="startup-4-power-review"]')?.textContent);
    assert.match(
      power,
      plan === overclocked
        ? /This phase's power counts its Water Extractors overclocked up to 250%, the suggested option: .+\. At 100% instead, they would take .+\./
        : /This phase's power counts its Water Extractors at 100%, the suggested option: .+\. Overclocked up to 250% instead, they would take .+\./,
    );
  }
});

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

test('the setting only picks the suggested option, and is read as before', () => {
  open({ workspace: { catalog: items } });
  draftAt(4, { phaseMining: true });
  go('wizard');
  render();
  const box = $<HTMLInputElement>('[data-water-overclock]')!;
  assert.ok(box, 'the box');
  assert.equal(box.name, 'waterOverclock', 'the same field');
  assert.equal(box.checked, false);
  const label = plain(box.closest('label')?.textContent);
  assert.match(label, /^Suggest overclocked Water Extractors/);
  assert.match(label, /always shows both ways to build them: at 100%, and overclocked up to 250%/);
  assert.match(label, /only picks the one it suggests first and counts in the power total/);
  box.checked = true;
  readWizard($<HTMLFormElement>('#wizard-form')!);
  assert.equal(wizard!.settings.waterOverclock, true);
  // Edit settings names the suggested option.
  assert.deepEqual(
    settingsChanges({ phaseMining: true }, { phaseMining: true, waterOverclock: true }, []).changes,
    [{ label: 'Suggested Water Extractors', before: 'At 100%', after: 'Overclocked' }],
  );
});
