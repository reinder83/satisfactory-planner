// The Logistics page's books count an item as made on site only where the plan was calculated to
// make it on site for the group (#1003): the items of that group in the plan's settings.onSite,
// as the planner routes them, not every item the group marks. Group 1 marks Aluminum Scrap,
// Compacted Coal and Water (a raw resource, which the recalculation leaves out, #921). Its own
// Aluminum Scrap line also makes Water, which is then ordinary supply, as a central Aluminum Scrap
// line's Water is, rather than Water "made on site for Group 1's lines". A plan calculated before
// the marks changed keeps the books it was calculated with, and a plan stored without the setting
// reads the marks as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import type { GroupFlow } from '../public/app/group-flow.ts';
import { groupLinks, itemBooks, OUTSIDE } from '../public/app/group-links.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  StoredSettings,
  StoredStage,
} from '../public/types/index.ts';

const BASE = { phase: '4', wholeMachines: true, limitsConfirmed: true };
const G1 = 'fg-rand1';
const OWN_SCRAP = `Recipe_AluminumScrap_C:${G1}`;
const MARKS = ['Aluminum Scrap', 'Compacted Coal', 'Water'];
const belts = (item: string, rate: number) => `${rate} ${item}`;

// Group 1 builds Pure Aluminum Ingot (Aluminum Scrap), Turbofuel (Compacted Coal) and Nitric Acid
// (Water) and marks all three items.
const marking = (local: string[]): FactoryGroups => ({
  groups: [{ id: G1, name: 'Group 1' }],
  assignments: {
    Recipe_PureAluminumIngot_C: [{ group: G1, rate: null }],
    Recipe_Alternate_Turbofuel_C: [{ group: G1, rate: null }],
    Recipe_NitricAcid_C: [{ group: G1, rate: null }],
  },
  local: { [G1]: local },
});
const groups = marking(MARKS);

let made: CurrentCalculatedPlan | undefined;
// The plan recalculated with Group 1's marks, as "Recalculate with items made on site" does.
const sitePlan = () =>
  (made ??= calculate({ ...BASE, onSite: onSiteSettings(calculate(BASE), groups) }));
const phase4 = (): StoredStage => sitePlan().stages['4'];
const planned = () => sitePlan().settings.onSite;

test('the plan makes Aluminum Scrap and Compacted Coal on site for Group 1, and its Aluminum Scrap line makes Water', () => {
  assert.deepEqual(planned()?.[G1]?.items, ['Aluminum Scrap', 'Compacted Coal']);
  const own = phase4().rows?.find(row => row.id === OWN_SCRAP);
  assert.deepEqual(own?.onSite, { group: G1, recipe: 'Recipe_AluminumScrap_C' });
  assert.equal(own.outputs.Water, 240);
  assert.equal(phase4().surplus?.Water, undefined, 'the plan sinks no Water');
});

test("a group line's Water byproduct is ordinary supply, not Water made on site (#1003)", () => {
  const books = itemBooks(phase4(), groups, planned());
  assert.equal(books.local.Water, undefined, 'no Water made on site');
  assert.equal(books.sunk.Water, undefined, 'none sunk as made on site');
  assert.equal(books.offered.Water, undefined, 'none offered as made on site');
  // The line's Water is supply at Group 1, shared with every place that asks for Water.
  assert.equal(books.supply.Water?.get(G1), 240);
  const fromGroup = groupLinks(phase4(), groups, planned())
    .filter(link => link.from === G1)
    .flatMap(link => link.items.filter(entry => entry.item === 'Water'));
  assert.ok(fromGroup.length > 0, 'Group 1 sends Water to the other places');
  // Group 1's flow sends none of it to the sink.
  const flow = groupFlow(phase4(), groups, G1, belts, undefined, planned()) as GroupFlow;
  const water = flow.lines
    .find(line => line.id === OWN_SCRAP)!
    .outputs.find(row => row.item === 'Water')!;
  assert.ok(water.links.length > 0);
  assert.ok(
    water.links.every(link => !(link.to.kind === 'place' && link.to.id === OUTSIDE.surplus)),
  );
});

test('an item the plan made on site for the group is still counted as made on site', () => {
  const books = itemBooks(phase4(), groups, planned());
  assert.equal(books.local['Aluminum Scrap']?.get(G1)?.made, 720);
  assert.ok(books.local['Compacted Coal']?.has(G1));
  assert.equal(books.supply['Aluminum Scrap']?.get(G1), undefined, 'it stays inside the group');
  // The books are those of the marks the plan was calculated with, without Water.
  assert.deepEqual(books, itemBooks(phase4(), marking(['Aluminum Scrap', 'Compacted Coal'])));
});

test('marks edited after the recalculation leave the books as the plan was calculated (#1003)', () => {
  // Group 1 clears Aluminum Scrap and marks Rocket Fuel, which the plan makes on a central line
  // (a group never copies Rocket Fuel for its Compacted Coal byproduct, #1012); no recalculation
  // yet.
  const rocket = phase4().rows?.find(row => row.id === 'Recipe_RocketFuel_C');
  assert.ok((rocket?.outputs['Rocket Fuel'] || 0) > 0);
  const edited = marking(['Compacted Coal', 'Rocket Fuel', 'Water']);
  const books = itemBooks(phase4(), edited, planned());
  assert.equal(books.local['Aluminum Scrap']?.get(G1)?.made, 720, 'Aluminum Scrap still on site');
  assert.equal(books.local['Rocket Fuel'], undefined, 'Rocket Fuel is ordinary supply');
  assert.deepEqual(books, itemBooks(phase4(), groups, planned()));
  assert.deepEqual(
    groupLinks(phase4(), edited, planned()),
    groupLinks(phase4(), groups, planned()),
  );
});

test('a plan stored without settings.onSite reads the marks, as before', () => {
  const { onSite: _left, ...rest } = sitePlan().settings;
  const settings: StoredSettings = rest;
  assert.equal('onSite' in settings, false);
  const books = itemBooks(phase4(), groups, settings.onSite);
  assert.deepEqual(books, itemBooks(phase4(), groups));
  assert.ok(books.local.Water?.has(G1), 'the marks decide');
  assert.ok(books.local['Aluminum Scrap']?.has(G1));
});
