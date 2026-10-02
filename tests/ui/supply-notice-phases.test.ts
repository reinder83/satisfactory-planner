// The wizard Review's supply notice (ui/wizard/SupplyNotice.vue) lists the phases that could not
// keep the credit for existing production as a sentence lists them: "Phases 2, 3 and 4", not
// "Phases 2 and 3 and 4" (#735).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createApp, h } from 'vue';
import SupplyNotice from '../../public/app/ui/wizard/SupplyNotice.vue';
import { andList } from '../../public/app/views/calculated.ts';
import { generated } from './setup.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';

// The bold phase list of a notice for a plan whose phases `dropped` lost the credit.
const droppedText = (dropped: string[]) => {
  const plan: StoredCalculatedPlan = generated();
  plan.settings.phase = '1';
  plan.settings.existingSupply = { 'Iron Plate': 30 };
  for (const [phase, stage] of Object.entries(plan.stages))
    stage.supplyDropped = dropped.includes(phase);
  const el = document.createElement('div');
  const app = createApp({ render: () => h(SupplyNotice, { plan }) });
  app.mount(el);
  const text = (el.querySelector('.supply-notice p.small:last-child b')?.textContent || '').trim();
  app.unmount();
  return text;
};

test('the supply notice lists three dropped phases as "Phases 2, 3 and 4"', () => {
  assert.equal(droppedText(['2', '3', '4']), 'Phases 2, 3 and 4');
  assert.equal(droppedText(['2', '4']), 'Phases 2 and 4');
  assert.equal(droppedText(['3']), 'Phase 3');
});

test('andList joins names as a sentence lists them', () => {
  assert.equal(andList([]), '');
  assert.equal(andList(['Coal Generators']), 'Coal Generators');
  assert.equal(andList(['a', 'b']), 'a and b');
  assert.equal(andList(['a', 'b', 'c', 'd']), 'a, b, c and d');
});
