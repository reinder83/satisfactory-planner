// Made on site polish (#1019):
// - #1007: the picker offers no item a recalculation could never give a line (a radioactive item
//   such as Encased Uranium Cell, or Heavy Oil Residue, which the plan makes only as a
//   byproduct); one still marked stays listed with the heading's note, "(can't be made on site)",
//   or for Heavy Oil Residue "(a byproduct of central lines covers it)" (#1027 review);
// - #979: with several unsaved pickers, Done editing focuses the first one's Save on the page,
//   also after that group was folded and unfolded (which mounts its picker again, last);
// - #978: a note after two or more marks in a group's heading reads plural.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import {
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  setSectionCollapsed,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  BYPRODUCT_NOTE,
  onSiteEntriesText,
  onSiteOffers,
  RAW_NOTE,
  UNUSED_NOTE,
} from '../../public/app/on-site-picker.ts';
import { $, generated, go, open, page } from './setup.ts';
import type { CalcRow, FactoryGroups, StoredCalculatedPlan } from '../../public/types/index.ts';

const ALPHA = 'fg-alpha1';
const MOTORS = 'fg-motors1';
const PLATES = 'fg-plates1';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const show = async (plan: StoredCalculatedPlan, groups: FactoryGroups, editing: boolean) => {
  open({ calculated: plan, phase: '3', state: { factoryGroups: groups } });
  setFactoryEditing(editing);
  render();
  await settle();
};
const words = (selector: string) => $(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const box = (group: string, item: string) =>
  $<HTMLInputElement>(`[data-on-site-picker="${group}"] [data-on-site-item="${item}"]`);
const noteOf = (group: string, item: string) =>
  box(group, item)?.closest('label')?.querySelector('small')?.textContent?.trim() ?? '';
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
afterEach(() => {
  setFactoryEditing(false);
  setSectionCollapsed(MOTORS, false);
  setSectionCollapsed(PLATES, false);
  vi.restoreAllMocks();
});

// The generated plan with Phase 3's Uranium Fuel Rod and Encased Uranium Cell lines (a nuclear
// recipe, which the planner never copies for a group), as #933 checked it.
function withNuclear(): StoredCalculatedPlan {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  // The generated Phase 3 plan has a Stator line (checked by the find).
  const stator = rows.find(row => row.id === 'Recipe_Stator_C')!;
  const line = (
    id: string,
    name: string,
    inputs: CalcRow['inputs'],
    outputs: CalcRow['outputs'],
  ): CalcRow => ({ ...stator, id, name, inputs, outputs });
  rows.push(
    line(
      'Recipe_NuclearFuelRod_C',
      'Uranium Fuel Rod',
      { 'Encased Uranium Cell': 10, Stator: 1 },
      { 'Uranium Fuel Rod': 0.4 },
    ),
    line(
      'Recipe_UraniumCell_C',
      'Encased Uranium Cell',
      { Uranium: 50, Concrete: 15, 'Sulfuric Acid': 40 },
      { 'Encased Uranium Cell': 25, 'Sulfuric Acid': 10 },
    ),
  );
  return plan;
}
const fuelRods = (local?: string[]): FactoryGroups => ({
  groups: [{ id: ALPHA, name: 'Alpha' }],
  assignments: { Recipe_NuclearFuelRod_C: [{ group: ALPHA, rate: null }] },
  ...(local ? { local: { [ALPHA]: local } } : {}),
});

test('#1007: a radioactive item is not offered, and a mark of it keeps the heading’s note', async () => {
  const plan = withNuclear();
  assert.deepEqual(onSiteOffers(plan, fuelRods(), ALPHA), ['Stator']);
  await show(plan, fuelRods(), true);
  assert.equal(box(ALPHA, 'Encased Uranium Cell'), null, 'not offered');
  assert.ok(box(ALPHA, 'Stator'), 'the part a plan line makes is');
  // Marked in a save from before: listed so it can be cleared, with the heading's own note.
  await show(plan, fuelRods(['Encased Uranium Cell']), true);
  assert.equal(noteOf(ALPHA, 'Encased Uranium Cell'), RAW_NOTE);
  await show(plan, fuelRods(['Encased Uranium Cell']), false);
  assert.equal(
    words(`#section-${ALPHA} [data-on-site-marked]`),
    `Marked, not made on site: Encased Uranium Cell ${RAW_NOTE}`,
  );
});

test('#1007: an item the plan makes only as a byproduct is not offered either', async () => {
  // Heavy Oil Residue: only the Plastic and Rubber lines make it, as a byproduct (#1012).
  const residual: FactoryGroups = {
    groups: [{ id: ALPHA, name: 'Alpha' }],
    assignments: { Recipe_ResidualFuel_C: [{ group: ALPHA, rate: null }] },
  };
  assert.ok(generated().stages['3'].rows!.some(row => row.id === 'Recipe_ResidualFuel_C'));
  assert.ok(!onSiteOffers(generated(), residual, ALPHA).includes('Heavy Oil Residue'));
  await show(generated(), { ...residual, local: { [ALPHA]: ['Heavy Oil Residue'] } }, true);
  assert.equal(noteOf(ALPHA, 'Heavy Oil Residue'), BYPRODUCT_NOTE);
});

test('#979: Done editing focuses the first unsaved picker on the page, also after a fold', async () => {
  // Motors holds the Stator line (Wire in), Plates the Iron Plate line (Iron Ingot in).
  const groups: FactoryGroups = {
    groups: [
      { id: MOTORS, name: 'Motors' },
      { id: PLATES, name: 'Plates' },
    ],
    assignments: {
      Recipe_Stator_C: [{ group: MOTORS, rate: null }],
      Recipe_IronPlate_C: [{ group: PLATES, rate: null }],
    },
  };
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  await show(generated(), groups, true);
  // Folding Motors and unfolding it mounts its picker again, after Plates'.
  $<HTMLButtonElement>(`[data-collapse="${MOTORS}"]`)!.click();
  await settle();
  assert.equal(box(MOTORS, 'Wire'), null, 'folded');
  $<HTMLButtonElement>(`[data-collapse="${MOTORS}"]`)!.click();
  await settle();
  tick(box(MOTORS, 'Wire')!, true);
  tick(box(PLATES, 'Iron Ingot')!, true);
  await settle();
  $<HTMLButtonElement>('#main [data-toggle-factory-edit]')!.click();
  await settle();
  for (const group of [MOTORS, PLATES])
    assert.equal(
      words(`[data-on-site-picker="${group}"] [data-on-site-held]`),
      'This choice is not saved yet. Save it or discard it first.',
      group,
    );
  assert.equal(document.activeElement, $(`[data-on-site-save="${MOTORS}"]`), 'Motors comes first');
});

test('#978: a note after two or more marks in a heading reads plural, after one singular', () => {
  const unused = (item: string) => ({ item, note: UNUSED_NOTE });
  assert.equal(
    onSiteEntriesText([unused('Cable'), unused('Quickwire'), { item: 'Water', note: RAW_NOTE }]),
    "Cable and Quickwire (no line here uses them now); Water (can't be made on site)",
  );
  assert.equal(onSiteEntriesText([unused('Cable')]), 'Cable (no line here uses it now)');
  // The other notes read as notes after any number of items.
  assert.equal(
    onSiteEntriesText([
      { item: 'Iron Rod', note: '(needs a recalculation)' },
      { item: 'Screws', note: '(needs a recalculation)' },
    ]),
    'Iron Rod and Screws (needs a recalculation)',
  );
});
