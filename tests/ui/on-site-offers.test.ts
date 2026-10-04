// What a group's "Made on site" picker offers when the group holds lines in other phases than the
// one the Factories page shows (#941). The owner's group "Industrial parts" showed three cards in
// Phase 3 (Copper Rotor, Quickwire Stator and Rigor Motor) while its picker offered 22 items,
// such as Alumina Solution, Nitric Acid and Pressure Conversion Cube. Those were inputs of the
// group's lines in Phases 4 and 5, which the Phase 3 page does not show. A mark is the group's in
// every phase, so they stay offered, but after the items its lines in the phase shown use, under
// a heading naming those phases, each naming the lines that use it (onSitePickerOffers in
// app/on-site-picker.ts, OnSitePicker.vue; the layout is #963's, tests/ui/on-site-sections.test.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { rowPlaces } from '../../public/app/group-order.ts';
import { onSiteOffers, onSitePickerOffers } from '../../public/app/on-site-picker.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, FactoryGroups, StageKey } from '../../public/types/index.ts';

const PARTS = 'fg-industrial1';

// The three lines the owner's Phase 3 page showed in the group.
const SHOWN = [
  'Recipe_Alternate_CopperRotor_C',
  'Recipe_Alternate_Stator_C',
  'Recipe_Alternate_Motor_1_C',
];
// Lines the group also holds that the plan only builds from Phase 4 on.
const LATER = [
  'Recipe_Battery_C',
  'Recipe_Alternate_ElectromagneticControlRod_1_C',
  'Recipe_Alternate_HeatFusedFrame_C',
  'Recipe_PressureConversionCube_C',
  'Recipe_Alternate_TurboPressureMotor_C',
  'Recipe_Alternate_HeatSink_1_C',
  'Recipe_CoolingSystem_C',
];
// The items the Phase 3 cards use, and the ones only the later lines use: together the owner's 22.
const USED_HERE = [
  'Copper Sheet',
  'Crystal Oscillator',
  'Quickwire',
  'Rotor',
  'Screws',
  'Stator',
  'Steel Pipe',
];
const USED_LATER = [
  'Alumina Solution',
  'Aluminum Casing',
  'Aluminum Ingot',
  'Fuel',
  'Fused Modular Frame',
  'Heat Sink',
  'Heavy Modular Frame',
  'High-Speed Connector',
  'Motor',
  'Nitric Acid',
  'Packaged Nitrogen Gas',
  'Pressure Conversion Cube',
  'Radio Control Unit',
  'Rubber',
  'Sulfuric Acid',
];

const groups = (lines: string[]): FactoryGroups => ({
  groups: [{ id: PARTS, name: 'Industrial parts' }],
  assignments: Object.fromEntries(lines.map(id => [id, [{ group: PARTS, rate: null }]])),
});

// A plan made for Phase 3 with every alternate allowed, made once for the file.
let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({ phase: '3', recipes: 'all' })));

// The group's rows in `phase`, as the Factories page draws its cards.
const groupRows = (stagePlan: CurrentCalculatedPlan, held: FactoryGroups, phase: StageKey) =>
  (stagePlan.stages[phase].rows || [])
    .filter(row => (rowPlaces(row, held).get(PARTS) || 0) > 0)
    .map(row => row.id)
    .sort();

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test("the owner's shape: three cards in Phase 3, more lines of the group in Phases 4 and 5", () => {
  const held = groups([...SHOWN, ...LATER]);
  assert.deepEqual(groupRows(plan(), held, '3'), [...SHOWN].sort());
  for (const phase of ['4', '5'] as const)
    assert.deepEqual(groupRows(plan(), held, phase), [...SHOWN, ...LATER].sort());
  // Every phase counts: a mark is the group's in every phase, and a recalculation gives it a line
  // wherever its lines use the item.
  assert.deepEqual(onSiteOffers(plan(), held, PARTS), [...USED_HERE, ...USED_LATER].sort());
});

test('items only lines in other phases use come last and name those lines (#941)', () => {
  const offers = onSitePickerOffers(plan(), groups([...SHOWN, ...LATER]), PARTS, '3');
  // The items the Phase 3 cards use need no note: the cards are on the page.
  assert.deepEqual(
    offers.here,
    USED_HERE.map(item => ({ item, note: '' })),
  );
  assert.deepEqual(
    offers.elsewhere.map(group => [group.where, group.entries.map(entry => entry.item)]),
    [['Phases 4 and 5', USED_LATER]],
  );
  const later = offers.elsewhere.flatMap(group => group.entries);
  const noteOf = (item: string) => later.find(entry => entry.item === item)?.note;
  assert.equal(noteOf('Pressure Conversion Cube'), '(used by Alternate: Turbo Pressure Motor)');
  assert.equal(noteOf('Alumina Solution'), '(used by Battery)');
  assert.equal(noteOf('Rubber'), '(used by Alternate: Heat Exchanger and Cooling System)');
  assert.ok(later.every(entry => entry.note.startsWith('(used by ')));
  // On the Phase 5 page every line is a card there: no notes, all sorted.
  const phase5 = onSitePickerOffers(plan(), groups([...SHOWN, ...LATER]), PARTS, '5');
  assert.deepEqual(
    phase5.here,
    [...USED_HERE, ...USED_LATER].sort().map(item => ({ item, note: '' })),
  );
  assert.deepEqual(phase5.elsewhere, []);
});

test('a group whose lines are all on the page is offered only what its cards use', () => {
  const offers = onSitePickerOffers(plan(), groups(SHOWN), PARTS, '3');
  assert.deepEqual(offers, { here: USED_HERE.map(item => ({ item, note: '' })), elsewhere: [] });
  assert.deepEqual(onSiteOffers(plan(), groups(SHOWN), PARTS), USED_HERE);
});

test("the picker on the Phase 3 page lists the cards' items first, then the later ones with their lines", async () => {
  open({ calculated: plan(), phase: '3', state: { factoryGroups: groups([...SHOWN, ...LATER]) } });
  setFactoryEditing(true);
  render();
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  const cards = $$(`#cards-${PARTS} .factory-card`);
  assert.equal(cards.length, SHOWN.length, 'the group shows three cards in Phase 3');
  const boxes = $$<HTMLInputElement>(`[data-on-site-picker="${PARTS}"] [data-on-site-item]`);
  assert.deepEqual(
    boxes.map(input => input.dataset.onSiteItem),
    [...USED_HERE, ...USED_LATER],
  );
  // The note in its own element (the space before it is #934's).
  const noteOf = (item: string) =>
    $(`[data-on-site-picker="${PARTS}"] [data-on-site-item="${item}"]`)!
      .closest('label')!
      .querySelector('small')
      ?.textContent?.trim() ?? '';
  assert.equal(noteOf('Stator'), '');
  assert.equal(noteOf('Nitric Acid'), '(used by Alternate: Heat-Fused Frame)');
});
