// Made on site (#1012, the decision on #1018): a recalculation gives a group its own line only of
// a recipe whose primary product (its first output) is an item the group marks; a recipe that
// makes the item only as a byproduct stays central (siteCopies in planner/on-site.ts). The picker
// follows the same rule (onSiteCopyable): from a marked part it offers only the ingredients of the
// lines that make the part as their product, and a mark the plan makes only as a byproduct gets
// no line, so the notice does not ask for one and the heading says it can't be made on site.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { onSiteChange, onSitePickerOffers, RAW_NOTE } from '../../public/app/on-site-picker.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { FactoryGroups, StageKey, StoredCalculatedPlan } from '../../public/types/index.ts';

const ALPHA = 'fg-alpha1';

// A group, Alpha, holding `rows` and marking `local`.
const alpha = (local: string[], rows: string[]): FactoryGroups => ({
  groups: [{ id: ALPHA, name: 'Alpha' }],
  assignments: Object.fromEntries(rows.map(row => [row, [{ group: ALPHA, rate: null }]])),
  local: { [ALPHA]: local },
});

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const show = async (
  plan: StoredCalculatedPlan,
  now: FactoryGroups,
  phase: StageKey,
  editing = false,
) => {
  open({ calculated: plan, phase, state: { factoryGroups: now } });
  setFactoryEditing(editing);
  render();
  await settle();
};
const words = (selector: string) => $(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const notice = () => words('[data-on-site-recalc]');
const made = (group: string) => words(`#section-${group} [data-on-site-made]`);
const marked = (group: string) => words(`#section-${group} [data-on-site-marked]`);
// The picker's boxes as "item note" lines, the note '' for none.
const noteOf = (input: HTMLInputElement) =>
  input.closest('label')?.querySelector('small')?.textContent?.trim() ?? '';
const boxes = (group: string) =>
  $$<HTMLInputElement>(`[data-on-site-picker="${group}"] [data-on-site-item]`).map(input =>
    `${input.dataset.onSiteItem} ${noteOf(input)}`.trim(),
  );

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test('#1012: Compacted Coal is followed only to the line that makes it as its product', () => {
  const plan = generated();
  // Alpha holds the Turbofuel line, which takes Compacted Coal. Phase 4 makes Compacted Coal on
  // its Coke line and as Rocket Fuel's byproduct: only the Coke line's ingredients (Coal and
  // Sulfur, raw resources) would be its own line's, so nothing is offered for it.
  const turbo = alpha(['Compacted Coal'], ['Recipe_Alternate_Turbofuel_C']);
  const offers = onSitePickerOffers(plan, turbo, ALPHA, '4', ['Compacted Coal']);
  assert.deepEqual(
    offers.here.filter(offer => offer.note),
    [],
    'no ingredient of the Rocket Fuel line is offered for Compacted Coal',
  );
  assert.deepEqual(onSiteSettings(plan, turbo)?.[ALPHA]?.items, ['Compacted Coal']);
});

test('#1012: Dark Matter Residue offers only the ingredients of the line that makes it', async () => {
  const plan = generated();
  const gamma = alpha(['Dark Matter Residue'], ['Recipe_DarkMatter_C']);
  await show(plan, gamma, '5', true);
  // Not the Space Elevator parts' and processors' ingredients, which make it as a byproduct.
  assert.deepEqual(boxes(ALPHA), [
    'Dark Matter Residue',
    'Diamonds',
    'Reanimated SAM (for Dark Matter Residue made on site)',
  ]);
  assert.deepEqual(onSiteSettings(plan, gamma)?.[ALPHA]?.items, ['Dark Matter Residue']);
});

test('#1012: a mark the plan makes only as a byproduct gets no line, and the page says so', async () => {
  const plan = generated();
  // Heavy Oil Residue: only the Plastic and Rubber lines make it, as a byproduct.
  assert.deepEqual(
    plan.stages['3']
      .rows!.filter(row => row.outputs['Heavy Oil Residue'])
      .map(row => Object.keys(row.outputs)[0]),
    ['Plastic', 'Rubber'],
  );
  const residual = alpha(['Heavy Oil Residue'], ['Recipe_ResidualFuel_C']);
  assert.equal(onSiteSettings(plan, residual), undefined);
  assert.equal(onSiteChange(plan, residual), null);
  await show(plan, residual, '3');
  assert.equal(notice(), null, 'no recalculation is offered for it');
  assert.equal(made(ALPHA), null);
  assert.equal(marked(ALPHA), `Marked, not made on site: Heavy Oil Residue ${RAW_NOTE}`);
});
