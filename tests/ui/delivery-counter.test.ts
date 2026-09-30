// The Space Elevator delivery counter's text (public/app/ui/plan/DeliveryCounter.vue) follows
// the saved count against the target, also for a delivery without a rate (#590). At the target it
// reads complete, with or without a rate (#596), and names no phase: the calculated plan draws
// the deliveries of every phase (#595). A count typed while another counter saves stays (#627):
// input-race.test.ts and input-race-browser.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { num, slug } from '../../public/app/format.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const id = '3-versatile-framework';
const text = (delivery = id) =>
  $(`#delivery-${delivery}`)!.closest('.delivery')!.querySelector('.muted')!.textContent;
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
  assert.equal(text(), 'Delivery complete');
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
  assert.equal(text(), 'Delivery complete');
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
  assert.equal(text(), 'Delivery complete');
});

test('a delivery with a rate reads complete at its target, not 0 minutes remaining', async () => {
  // The handbook's Modular Engine: 25,000 at 50/min.
  const engine = '3-modular-engine';
  open({ state: { deliveries: { [engine]: 24950 } } });
  render();
  assert.equal(text(engine), '50/min net · 1 minute left');
  open({ state: { deliveries: { [engine]: 25000 } } });
  render();
  await nextTick();
  assert.equal(text(engine), 'Delivery complete');
});

test('the time left reads as a plain duration with the right plural (#624)', async () => {
  // A calculated Versatile Framework delivery of 2,500 at 5.3/min, as in the issue.
  const plan = generated();
  Object.assign(plan.stages['3']!.delivery!['Versatile Framework']!, { target: 2500, rate: 5.3 });
  const cases: [number, string][] = [
    [0, 'about 7 h 52 min left'], // 471.7 minutes
    [2499, 'less than a minute left'], // 0.19 minutes
    [2500 - 5.3 * 12, '12 minutes left'],
    [2500 - 5.3 * 120, 'about 2 h left'],
  ];
  for (const [count, left] of cases) {
    open({ calculated: plan, state: { deliveries: { [id]: Math.round(count) } } });
    render();
    await nextTick();
    assert.equal(text(), `${num(5.3)}/min net · ${left}`);
  }
});

test('a complete delivery of a later phase does not read as Phase 3', async () => {
  const plan = generated(),
    [item, delivery] = Object.entries(plan.stages['4']!.delivery!)[0]!,
    later = '4-' + slug(item);
  Object.assign(delivery, { rate: 0 });
  open({ calculated: plan, phase: '4', state: { deliveries: { [later]: delivery.target } } });
  render();
  assert.equal(text(later), 'Delivery complete');
  open({ calculated: plan, phase: '4', state: { deliveries: { [later]: delivery.target - 1 } } });
  render();
  await nextTick();
  assert.equal(text(later), '1 remaining');
});
