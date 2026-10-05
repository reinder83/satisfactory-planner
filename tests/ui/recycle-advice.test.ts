// Byproduct recycling advice on the pages (#1022): the factory dialog's "Byproducts" notice, the
// build-plan step's text for the phase shown, and the ♻ line under a row of a group's flow page,
// on the planner's own plan with every alternate recipe from Phase 3 and the default factory
// groups, Industrial parts renamed to a hostile name. Numbers read as in en-US.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { flowRoute, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { calcTasks } from '../../public/app/views/calculated.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, evil, generatedWith, go, open, page } from './setup.ts';
import type { FactoryGroups, Phase, TaskEdits } from '../../public/types/index.ts';

const plan = generatedWith({ phase: '3', recipes: 'all' });
const defaults = defaultFactoryGroups(plan);
const groups: FactoryGroups = {
  ...defaults,
  groups: defaults.groups.map(group =>
    group.id === 'fg-parts1' ? { ...group, name: evil } : group,
  ),
};
const rowId = (phase: '3' | '4' | '5', name: string) => {
  const row = plan.stages[phase].rows!.find(candidate => candidate.name === name);
  assert.ok(row, `${name} in Phase ${phase}`);
  return row.id;
};
const text = (element: Element | null) =>
  (element?.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// A paragraph of the notice as "<its bold lead>|<the rest>": a line break parts them on the page.
// The Water Extractors (#1024), on a line of their own after the rest, are left out (extractors).
const paragraph = (element: Element) => {
  const lead = text(element.querySelector('b'));
  const water = text(element.querySelector('[data-extractors]'));
  const rest = text(element).slice(lead.length);
  return lead + '|' + (water ? rest.slice(0, -water.length) : rest);
};
// A paragraph's Water Extractors line, with plain spaces.
const extractors = (element: Element | null | undefined) =>
  text(element?.querySelector('[data-extractors]') ?? null).replace(/ /g, ' ');
// Text with plain spaces for the no-break ones before a unit.
const plainText = (element: Element | null) => text(element).replace(/ /g, ' ');

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
beforeEach(() => {
  page();
  setQuery('');
});

function openPlan(phase: Phase, taskEdits?: Partial<TaskEdits>) {
  open({
    calculated: structuredClone(plan),
    phase,
    state: { factoryGroups: groups, ...(taskEdits ? { taskEdits: taskEdits as TaskEdits } : {}) },
  });
  render();
}

test("a making line's dialog says where each byproduct goes, with links to the lines named", () => {
  openPlan('4');
  openCalculatedFactory(rowId('4', 'Battery'));
  const notice = $('#detail [data-recycle-advice]');
  assert.ok(notice, 'the Byproducts notice');
  assert.ok(notice.classList.contains('notice') && notice.classList.contains('info'));
  assert.equal(text(notice.previousElementSibling), 'Byproducts');
  assert.equal(
    paragraph(notice.querySelector('p')!),
    'Byproduct · Water 16.5 m³/min|Send 9 m³ to Cooling System ↗ and 7.5 m³ back to Alumina Solution ↗ in Aluminum campus, which feeds this line.',
  );
  // It comes right after the flow, before Machine setup.
  assert.equal(text(notice.nextElementSibling), 'Machine setup');
  // Each named line is a button that opens its dialog in place of this one.
  const links = [...notice.querySelectorAll<HTMLButtonElement>('button.recycle-link')];
  assert.deepEqual(
    links.map(link => [link.type, link.dataset.calcFactory, text(link)]),
    [
      ['button', rowId('4', 'Cooling System'), 'Cooling System ↗'],
      ['button', rowId('4', 'Alumina Solution'), 'Alumina Solution ↗'],
    ],
  );
  links[1]!.click();
  assert.equal(text($('#detail-title')), 'Alumina Solution');
});

test("a receiving line's dialog says where the inputs a byproduct covers come from; a group's name stays text", () => {
  openPlan('4');
  openCalculatedFactory(rowId('4', 'Alumina Solution'));
  const paragraphs = $$('#detail [data-recycle-advice] p').map(paragraph);
  assert.deepEqual(paragraphs, [
    'Byproduct · Silica 105.99/min|Send 88.78 to Aluminum Ingot ↗, 10.21 to Alternate: Silicon Circuit Board ↗ in Electronics and 7 to Alternate: Silicon High-Speed Connector ↗ in Electronics.',
    `Input · Water 381.55 m³/min|116.18 m³ recycled from Aluminum Scrap ↗, 7.5 m³ recycled from Battery ↗ in ${evil}; extract the other 257.87 m³.`,
  ]);
  assert.equal(document.querySelector('x-evil'), null, 'the group name is text');
});

test("a receiving line's dialog counts the Water Extractors for the Water no byproduct covers (#1024)", () => {
  openPlan('4');
  openCalculatedFactory(rowId('4', 'Alumina Solution'));
  const notice = $('#detail [data-recycle-advice]')!;
  assert.equal(text(notice.previousElementSibling), 'Byproducts and water');
  const [silica, water] = [...notice.querySelectorAll('p')];
  assert.equal(extractors(silica), '', 'a byproduct has none');
  // For the 257.87 m³ extracted, not the 381.55 the line takes, on a line of its own.
  assert.equal(
    extractors(water),
    'Water Extractors at 100%: 2 at 100% + 1 at 14.89% (3 extractors, 41.61 MW). Or up to 250% with Power Shards: 1 at 214.89% (1 extractor, 3 Power Shards, 54.98 MW).',
  );
  assert.equal(water!.querySelector('[data-extractors]')!.previousElementSibling?.tagName, 'BR');
  assert.equal(document.querySelector('x-evil'), null);
});

test('a line taking Water no byproduct covers is told to extract all of it, with the extractors (#1024)', () => {
  openPlan('4');
  openCalculatedFactory(rowId('4', 'Alternate: Wet Concrete'));
  const notice = $('#detail [data-recycle-advice]')!;
  assert.ok(notice.classList.contains('notice') && notice.classList.contains('info'));
  assert.equal(text(notice.previousElementSibling), 'Water');
  const water = notice.querySelector('p')!;
  assert.equal(
    paragraph(water),
    'Input · Water 253.75 m³/min|No byproduct covers it: extract all of it.',
  );
  assert.equal(
    extractors(water),
    'Water Extractors at 100%: 2 at 100% + 1 at 11.46% (3 extractors, 41.14 MW). Or up to 250% with Power Shards: 1 at 211.46% (1 extractor, 3 Power Shards, 53.82 MW).',
  );
  assert.equal(notice.querySelectorAll('button.recycle-link').length, 0, 'no line to link to');
});

test('a line with neither a byproduct, a recycled input nor Water has no notice', () => {
  openPlan('4');
  openCalculatedFactory(rowId('4', 'Alclad Aluminum Sheet'));
  assert.ok($('#detail-title'));
  assert.equal($('#detail [data-recycle-advice]'), null);
  assert.doesNotMatch(text($('#detail')), /Byproducts|Water Extractors/);
});

test("a coal generator's dialog counts the Water Extractors for its Water (#1024)", () => {
  const coalPlan = generatedWith({ phase: '2' });
  open({
    calculated: coalPlan,
    phase: '2',
    state: { factoryGroups: defaultFactoryGroups(coalPlan) },
  });
  render();
  openCalculatedFactory('power-coal');
  const water = $('#detail [data-recycle-advice] p')!;
  assert.equal(
    paragraph(water),
    'Input · Water 232.31 m³/min|No byproduct covers it: extract all of it.',
  );
  assert.equal(
    extractors(water),
    'Water Extractors at 100%: 1 at 100% + 1 at 93.59% (2 extractors, 38.32 MW). Or up to 250% with Power Shards: 1 at 193.59% (1 extractor, 2 Power Shards, 47.89 MW).',
  );
});

test('a build-plan step carries the advice of the phase it is in, not of the phase saved', () => {
  openPlan('4');
  const stepOf = (phase: Phase, name: string) =>
    calcTasks(phase).find(step => step.id === `calc-${phase}-${rowId(phase as '3', name)}`)!.body;
  // Rubber is built in both phases, with other numbers in each.
  assert.match(
    stepOf('3', 'Rubber').replace(/ /g, ' '),
    / Byproduct Heavy Oil Residue 48\.03 m³\/min: send 36\.34 m³ to Petroleum Coke, 11\.47 m³ to Alternate: Turbo Heavy Fuel and 0\.22 m³ to Alternate: Coated Cable in Copper & caterium\.$/,
  );
  assert.match(
    stepOf('4', 'Rubber').replace(/ /g, ' '),
    / Byproduct Heavy Oil Residue 85\.42 m³\/min: send 53\.58 m³ to Alternate: Diluted Fuel, 31\.62 m³ to Petroleum Coke and 0\.22 m³ to Alternate: Coated Cable in Copper & caterium\.$/,
  );
  // Alumina Solution extracts more Water in Phase 5, and its step there says so (#1024).
  assert.match(
    stepOf('4', 'Alumina Solution').replace(/ /g, ' '),
    /; extract the other 257\.87 m³\. Water Extractors at 100%: 2 at 100% \+ 1 at 14\.89% \(3 extractors, 41\.61 MW\)\. Or up to 250% with Power Shards: 1 at 214\.89% \(1 extractor, 3 Power Shards, 54\.98 MW\)\.$/,
  );
  assert.match(
    stepOf('5', 'Alumina Solution').replace(/ /g, ' '),
    /; extract the other 587\.31 m³\. Water Extractors at 100%: 4 at 100% \+ 1 at 89\.42% \(5 extractors, [\d.]+ MW\)\. Or up to 250% with Power Shards: 1 at 250% \+ 1 at 239\.42% \(2 extractors, 6 Power Shards, [\d.]+ MW\)\.$/,
  );
  assert.match(
    stepOf('3', 'Fuel').replace(/ /g, ' '),
    /Outputs: Fuel [\d.]+ m³\/min, Polymer Resin 43\/min\. Byproduct Polymer Resin 43\/min: send 39\.52 to Residual Plastic and store or sink the other 3\.48\.$/,
  );
});

test('the build plan shows the advice in the step, and a step the user rewrote keeps their text', async () => {
  const scrap = rowId('4', 'Aluminum Scrap');
  openPlan('4');
  await nextTick();
  const step = $(`[data-check="calc-4-${scrap}"]`)!.closest('.task')!;
  assert.match(
    text(step.querySelector('p')),
    /Outputs: Aluminum Scrap [\d.,]+\/min, Water 116\.18 m³\/min\. Byproduct Water 116\.18 m³\/min: send all of it back to Alumina Solution, which feeds this line\.$/,
  );
  // A line taking Water no byproduct covers (#1024).
  const concrete = $(`[data-check="calc-4-${rowId('4', 'Alternate: Wet Concrete')}"]`)!.closest(
    '.task',
  )!;
  assert.match(
    plainText(concrete.querySelector('p')),
    /Outputs: Concrete [\d.,]+\/min\. Water 253\.75 m³\/min\. No byproduct covers it: extract all of it\. Water Extractors at 100%: 2 at 100% \+ 1 at 11\.46% \(3 extractors, 41\.14 MW\)\. Or up to 250% with Power Shards: 1 at 211\.46% \(1 extractor, 3 Power Shards, 53\.82 MW\)\.$/,
  );
  page();
  openPlan('4', { bodies: { [`calc-4-${scrap}`]: 'My own words.' } });
  assert.equal(planTasks().find(task => task.id === `calc-4-${scrap}`)?.body, 'My own words.');
});

async function showFlow(groupId: string, phase: Phase) {
  open({ calculated: structuredClone(plan), phase, state: { factoryGroups: groups } });
  location.hash = '#' + flowRoute(groupId);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
}

test("a group's flow page has the advice under the rows it concerns, and its lanes follow the same rule", async () => {
  await showFlow('fg-alumn1', '4');
  const card = (name: string) => $(`#main .gf-card[data-line="${rowId('4', name)}"]`)!;
  const scrapWater = card('Aluminum Scrap').querySelector('.gf-out[data-row$="|Water"]')!;
  // All of the scrap line's Water goes to the Alumina Solution line, and no other group.
  assert.match(
    text(scrapWater),
    /^→ Water to \d\d♻ Send all of it back to Alumina Solution, which feeds this line\./,
  );
  assert.equal(
    text(scrapWater.querySelector('.gf-advice')),
    '♻ Send all of it back to Alumina Solution, which feeds this line.',
  );
  const solutionWater = card('Alumina Solution').querySelector('.gf-in[data-row$="|Water"]')!;
  // The line's Water Extractors end its ♻ line (#1024).
  assert.equal(
    plainText(solutionWater.querySelector('.gf-advice')),
    `♻ 116.18 m³ recycled from Aluminum Scrap, 7.5 m³ recycled from Battery in ${evil}; extract the other 257.87 m³. Water Extractors at 100%: 2 at 100% + 1 at 14.89% (3 extractors, 41.61 MW). Or up to 250% with Power Shards: 1 at 214.89% (1 extractor, 3 Power Shards, 54.98 MW).`,
  );
  // A row the advice does not concern has no ♻ line: the line's main product.
  assert.equal(
    card('Aluminum Scrap').querySelector('.gf-out[data-row$="|Aluminum Scrap"] .gf-advice'),
    null,
  );
  // No Water leaves the group; it comes in from Battery's group and the well only.
  const ports = $$('#main [data-port]').map(text).join(' | ');
  assert.doesNotMatch(ports, /Water[^|]*Concrete & quartz/);
  assert.equal(document.querySelector('x-evil'), null);
});

test("a line card on a group's flow page counts its own Water Extractors, with no ♻ when no byproduct covers any (#1024)", async () => {
  // Concrete & quartz under a hostile name, which stays text on the page.
  const hostile: FactoryGroups = {
    ...groups,
    groups: groups.groups.map(group =>
      group.id === 'fg-stone1' ? { ...group, name: evil } : group,
    ),
  };
  open({ calculated: structuredClone(plan), phase: '4', state: { factoryGroups: hostile } });
  location.hash = '#' + flowRoute('fg-stone1');
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
  const concrete = rowId('4', 'Alternate: Wet Concrete');
  const water = $(`#main .gf-card[data-line="${concrete}"] .gf-in[data-row$="|Water"] .gf-advice`);
  assert.equal(
    plainText(water),
    'No byproduct covers it: extract all of it. Water Extractors at 100%: 2 at 100% + 1 at 11.46% (3 extractors, 41.14 MW). Or up to 250% with Power Shards: 1 at 211.46% (1 extractor, 3 Power Shards, 53.82 MW).',
  );
  assert.equal(water!.getAttribute('data-advice'), 'input');
  assert.ok(text($('#main')).includes(evil), 'the group is named, as text');
  assert.equal(document.querySelector('x-evil'), null);
});
