// The "Made on site" picker's layout (#963), on #941's case: a Phase 3 page where the group
// "Industrial parts" shows three cards, while its lines in Phases 4 and 5 use 15 more items. The
// items the cards use come first, then the ingredients of a ticked part and any mark no line uses,
// then the items only the other phases use, under a heading of their own naming those phases. So
// each of those notes names only its lines, not "in Phases 4 and 5" fifteen times over. The
// picker writes the marks no line uses in the heading's own words (#953).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { onSitePickerOffers, RAW_NOTE, UNUSED_NOTE } from '../../public/app/on-site-picker.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, FactoryGroups } from '../../public/types/index.ts';

const PARTS = 'fg-industrial1';
const PICKER = `[data-on-site-picker="${PARTS}"]`;
// The group's three Phase 3 lines, then the ones the plan builds from Phase 4 on.
const LINES = [
  'Recipe_Alternate_CopperRotor_C',
  'Recipe_Alternate_Stator_C',
  'Recipe_Alternate_Motor_1_C',
  'Recipe_Battery_C',
  'Recipe_Alternate_ElectromagneticControlRod_1_C',
  'Recipe_Alternate_HeatFusedFrame_C',
  'Recipe_PressureConversionCube_C',
  'Recipe_Alternate_TurboPressureMotor_C',
  'Recipe_Alternate_HeatSink_1_C',
  'Recipe_CoolingSystem_C',
];
// What the Phase 3 cards use, and what only the later lines use (tests/ui/on-site-offers.test.ts).
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
const HEADING = "Used only by this factory's lines in Phases 4 and 5";

const groups = (local: string[] = []): FactoryGroups => ({
  groups: [{ id: PARTS, name: 'Industrial parts' }],
  assignments: Object.fromEntries(LINES.map(id => [id, [{ group: PARTS, rate: null }]])),
  ...(local.length ? { local: { [PARTS]: local } } : {}),
});

// A plan made for Phase 3 with every alternate allowed, made once for the file.
let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({ phase: '3', recipes: 'all' })));

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const showPicker = async (local: string[] = []) => {
  open({ calculated: plan(), phase: '3', state: { factoryGroups: groups(local) } });
  setFactoryEditing(true);
  render();
  await settle();
};
const items = (selector: string) =>
  $$<HTMLInputElement>(selector).map(input => input.dataset.onSiteItem);
// A box's label as a screen reader names the box: the label wraps it, so its text.
const nameOf = (item: string) =>
  $(`${PICKER} [data-on-site-item="${item}"]`)!
    .closest('label')!
    .textContent!.replace(/\s+/g, ' ')
    .trim();
const box = (item: string) => $<HTMLInputElement>(`${PICKER} [data-on-site-item="${item}"]`)!;
const tick = (input: HTMLInputElement, on: boolean) => {
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test("the cards' items come first, then the other phases' items under a heading of their own", async () => {
  await showPicker();
  assert.equal($$(`#cards-${PARTS} .factory-card`).length, 3, 'three cards on the Phase 3 page');
  assert.deepEqual(items(`${PICKER} [data-on-site-item]`), [...USED_HERE, ...USED_LATER]);
  // One section for Phases 4 and 5, inside the picker's fieldset, holding exactly the later items.
  const sections = $$(`${PICKER} [data-on-site-elsewhere]`);
  assert.equal(sections.length, 1);
  const section = sections[0]!; // the one section, counted just above
  assert.equal(section.dataset.onSiteElsewhere, '4-5');
  assert.equal(section.closest('fieldset'), $(PICKER));
  assert.deepEqual(items(`${PICKER} [data-on-site-elsewhere] [data-on-site-item]`), USED_LATER);
  // Its heading: a small subheading inside the fieldset, which also names that group of boxes.
  const heading = section.querySelector('.on-site-sub')!;
  assert.equal(heading.textContent!.trim(), HEADING);
  assert.equal(section.getAttribute('role'), 'group');
  const label = section.getAttribute('aria-labelledby')!;
  assert.equal(document.getElementById(label), heading);
  // The cards' items sit before it, with no heading of their own.
  const first = $(`${PICKER} .on-site-items`)!;
  assert.equal(first.closest('[data-on-site-elsewhere]'), null);
  assert.deepEqual(
    [...first.querySelectorAll<HTMLInputElement>('[data-on-site-item]')].map(
      input => input.dataset.onSiteItem,
    ),
    USED_HERE,
  );
});

test('each box keeps a meaningful name, and the notes under the heading name only the lines', async () => {
  await showPicker();
  // A card's item: its name alone.
  assert.equal(nameOf('Stator'), 'Stator');
  // An item of the other phases: its name and the lines that use it, without the phases, which
  // the heading gives once.
  assert.equal(
    nameOf('Pressure Conversion Cube'),
    'Pressure Conversion Cube (used by Alternate: Turbo Pressure Motor)',
  );
  assert.equal(nameOf('Alumina Solution'), 'Alumina Solution (used by Battery)');
  assert.equal(nameOf('Rubber'), 'Rubber (used by Alternate: Heat Exchanger and Cooling System)');
  for (const item of USED_LATER) {
    assert.match(nameOf(item), /^.+ \(used by [^()]+\)$/, item);
    assert.doesNotMatch(nameOf(item), /Phase/, item);
    assert.equal(box(item).getAttribute('aria-label'), null, 'the label names the box');
  }
  // On the Phase 5 page every line is a card there: one list, no heading, no notes.
  const phase5 = onSitePickerOffers(plan(), groups(), PARTS, '5');
  assert.deepEqual(phase5.elsewhere, []);
  assert.ok(phase5.here.every(entry => entry.note === ''));
});

test("a ticked part's ingredients still show, after the cards' items and above the heading", async () => {
  // The plan's Quickwire line takes ingredients a plan line makes, which no card here uses.
  const expected = onSitePickerOffers(plan(), groups(), PARTS, '3', ['Quickwire']).here.filter(
    entry => entry.note,
  );
  assert.ok(expected.length, 'Quickwire has an ingredient the plan makes');
  assert.ok(expected.every(entry => entry.note === '(for Quickwire made on site)'));
  await showPicker();
  tick(box('Quickwire'), true);
  await settle();
  const ingredients = expected.map(entry => entry.item);
  assert.deepEqual(items(`${PICKER} [data-on-site-item]`), [
    ...USED_HERE,
    ...ingredients,
    ...USED_LATER,
  ]);
  for (const item of ingredients) {
    assert.equal(nameOf(item), item + ' (for Quickwire made on site)');
    assert.equal(box(item).closest('[data-on-site-elsewhere]'), null, item);
  }
});

test("a mark no line uses keeps the heading's own note, above the other phases (#953)", async () => {
  await showPicker(['Copper Ingot', 'Water']);
  assert.deepEqual(items(`${PICKER} [data-on-site-item]`), [
    ...USED_HERE,
    'Copper Ingot',
    'Water',
    ...USED_LATER,
  ]);
  assert.equal(nameOf('Copper Ingot'), 'Copper Ingot ' + UNUSED_NOTE);
  assert.equal(nameOf('Water'), 'Water ' + RAW_NOTE);
  assert.equal(box('Water').closest('[data-on-site-elsewhere]'), null);
  // One wording for the picker and the heading: the picker writes neither note itself, and its
  // boxes and the heading's entries are one type.
  const component = readFileSync('public/app/ui/factories/OnSitePicker.vue', 'utf8');
  assert.ok(!component.includes("can't be made on site"));
  assert.ok(!component.includes('no line here uses it now'));
  assert.doesNotMatch(readFileSync('public/app/on-site-picker.ts', 'utf8'), /OnSiteOffer\b/);
});

test('a box under the heading is a draft until Save, and Discard puts the saved choice back (#968)', async () => {
  await showPicker();
  tick(box('Rubber'), true);
  await settle();
  assert.ok($(`${PICKER} [data-on-site-unsaved]`), 'Not saved yet.');
  assert.equal($<HTMLButtonElement>(`[data-on-site-save="${PARTS}"]`)!.disabled, false);
  $<HTMLButtonElement>(`[data-on-site-discard="${PARTS}"]`)!.click();
  await settle();
  assert.equal(box('Rubber').checked, false);
  assert.equal(
    $(`${PICKER} [data-on-site-saved]`)!.textContent!.trim(),
    'Discarded. The saved choice is back.',
  );
  assert.equal($<HTMLButtonElement>(`[data-on-site-save="${PARTS}"]`)!.disabled, true);
});
