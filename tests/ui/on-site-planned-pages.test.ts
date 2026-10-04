// The Logistics page and a group's flow page read the books of the plan as it was calculated
// (#1003): an item counts as made on site for a group where the plan's settings.onSite says so,
// not where the group's marks say so now. Group 1 builds Pure Aluminum Ingot, Turbofuel and
// Nitric Acid in Phase 4 and marks Aluminum Scrap and Compacted Coal, so the recalculation gives
// it its own Aluminum Scrap line. Then it clears the Aluminum Scrap mark without recalculating:
// the line's scrap still serves Group 1 alone, and only what the plan sinks of it leaves the group,
// to the AWESOME Sink. The plans are the planner's own, calculated in Node (generatedWith).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { flowRoute, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';
import { STANDARD_BEFORE_1040 } from '../helpers/standard-before-1040.ts';

// The standard recipes as they were before #1040, with Pure Aluminum Ingot allowed: Group 1's
// Aluminum Scrap consumer is that line.
const BASE = { phase: '4', wholeMachines: true, limitsConfirmed: true, ...STANDARD_BEFORE_1040 };
const G1 = 'fg-rand1';
const OWN_SCRAP = `Recipe_AluminumScrap_C:${G1}`;
const marking = (local: string[]): FactoryGroups => ({
  groups: [{ id: G1, name: 'Group 1' }],
  assignments: {
    Recipe_PureAluminumIngot_C: [{ group: G1, rate: null }],
    Recipe_Alternate_Turbofuel_C: [{ group: G1, rate: null }],
    Recipe_NitricAcid_C: [{ group: G1, rate: null }],
  },
  local: { [G1]: local },
});
const plan = generatedWith({
  ...BASE,
  onSite: onSiteSettings(generatedWith(BASE), marking(['Aluminum Scrap', 'Compacted Coal'])),
});
// The marks after the recalculation: Aluminum Scrap cleared.
const edited = marking(['Compacted Coal']);

// Opens Phase 4 of the plan with the edited marks, on `hash`.
async function show(hash: string) {
  open({ calculated: structuredClone(plan), phase: '4', state: { factoryGroups: edited } });
  location.hash = '#' + hash;
  go(viewOf(hash));
  render();
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  page();
  setQuery('');
});

test('the plan has an Aluminum Scrap line of its own for Group 1', () => {
  assert.deepEqual(plan.settings.onSite?.[G1]?.items, ['Aluminum Scrap', 'Compacted Coal']);
  assert.ok(plan.stages['4'].rows!.some(row => row.id === OWN_SCRAP));
});

test('Logistics: after the mark is cleared Group 1 still sends its Aluminum Scrap only to the sink (#1003)', async () => {
  await show('logistics');
  const scrapOut = $$(`[data-group="${G1}"] [data-link-out]`)
    .filter(row =>
      [...row.querySelectorAll('.flow-item-name')].some(name =>
        name.textContent?.startsWith('Aluminum Scrap'),
      ),
    )
    .map(row => row.dataset.linkOut);
  assert.deepEqual(scrapOut, [`${G1}:sink`]);
});

test("Group 1's flow page: its own line's Aluminum Scrap still feeds its own line and the sink alone (#1003)", async () => {
  await show(flowRoute(G1));
  const scrap = $(`#main .gf-card[data-line="${OWN_SCRAP}"] .gf-out`);
  assert.ok(scrap, 'the own line has an output row');
  const text = (scrap.textContent || '').replace(/\s+/g, ' ');
  // To Group 1's Pure Aluminum Ingot line (named by its number) and the AWESOME Sink, nowhere else.
  assert.match(text, /^→ Aluminum Scrap to \d\d, AWESOME Sink\d/);
});
