// The Space Elevator delivery counter's text (public/app/ui/plan/DeliveryCounter.vue) follows
// the saved count against the target, also for a delivery without a rate (#590).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const id = '3-versatile-framework';
const text = () => $(`#delivery-${id}`)!.closest('.delivery')!.querySelector('.muted')!.textContent;
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

beforeEach(() => {
  page();
  go('plan');
});

test('a delivery without a rate reads complete only at its target', async () => {
  // The handbook's Versatile Framework: rate 0, handed in when the handbook was written.
  open();
  render();
  assert.equal($<HTMLInputElement>(`#delivery-${id}`)!.value, '125000');
  assert.equal(text(), 'Phase 3 delivery already complete');
  open({ state: { deliveries: { [id]: 3 } } });
  render();
  await nextTick();
  assert.match(text(), /^124.997 remaining$/);
  open({ state: { deliveries: { [id]: 0 } } });
  render();
  await nextTick();
  assert.match(text(), /^125.000 remaining$/);
});

test('lowering the count on a migrated calculated profile drops the complete text', async () => {
  // A legacy progress.json migrates into a calculated profile with its 125,000 delivered.
  // Its stage 3 hands in no more Versatile Frameworks: the delivery has no rate.
  const plan = generated();
  Object.assign(plan.stages['3']!.delivery!['Versatile Framework']!, { target: 125000, rate: 0 });
  open({ calculated: plan, state: { deliveries: { [id]: 125000 } } });
  render();
  assert.equal(text(), 'Phase 3 delivery already complete');
  stubFetch({ '/api/update': (update: UpdateOp) => applyUpdate(update) });
  const input = $<HTMLInputElement>(`#delivery-${id}`)!;
  input.value = '3';
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(state.deliveries[id], 3);
  assert.match(text(), /^124.997 remaining$/);
  input.value = '125000';
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(text(), 'Phase 3 delivery already complete');
});
