// The build plan's step search and the Factories page's production line search filter once
// typing pauses (#1060, searchField in ui/search-field.ts): each key used to redraw the whole page,
// a second per key on a phone with a large plan. The box shows what is typed at once and keeps it
// through a redraw meanwhile; the page's query changes once, after the pause.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { query } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { SEARCH_PAUSE_MS } from '../../public/app/ui/search-field.ts';
import { $, $$, go, open, page } from './setup.ts';

beforeEach(() => {
  vi.useFakeTimers();
  page();
  open();
});
afterEach(() => {
  vi.useRealTimers();
});

const steps = () => $$('#main .checklist [data-check]').map(e => e.dataset.check);
// Types `text` into `box` one key at a time, `gap` ms apart, as a person types.
async function type(box: HTMLInputElement, text: string, gap: number) {
  for (const key of text) {
    box.value += key;
    box.dispatchEvent(new Event('input'));
    await nextTick();
    vi.advanceTimersByTime(gap);
  }
}

test('the step search filters once typing pauses, with the typed text shown meanwhile', async () => {
  render();
  await nextTick();
  const all = steps();
  const box = $<HTMLInputElement>('#plan-search')!;
  await type(box, 'steel', SEARCH_PAUSE_MS - 50);
  assert.equal(query, '', 'no query handed over while typing goes on');
  assert.deepEqual(steps(), all, 'the list is not filtered yet');
  assert.equal(box.value, 'steel');
  // A redraw while typing pauses (a save landing) keeps the typed text in the box.
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('#plan-search')!.value, 'steel');
  vi.advanceTimersByTime(50);
  await nextTick();
  assert.equal(query, 'steel', 'handed over once typing paused');
  assert.deepEqual(steps(), ['phase-3-steel']);
  assert.equal($('.checklist-tools .muted')!.textContent, '1 of 9 steps');
});

test('a query cleared by the page shows in the box', async () => {
  render();
  await nextTick();
  const box = $<HTMLInputElement>('#plan-search')!;
  await type(box, 'iron', 0);
  vi.advanceTimersByTime(SEARCH_PAUSE_MS);
  await nextTick();
  assert.equal(query, 'iron');
  // Opening a profile clears the search (setContext in session.ts); the box follows.
  open();
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('#plan-search')!.value, '');
  assert.equal(steps().length, 9);
});

test('the production line search waits for the pause too', async () => {
  go('factories');
  render();
  await nextTick();
  const cards = () => $$('#main .factory-card').length;
  const all = cards();
  const box = $<HTMLInputElement>('#factory-search')!;
  await type(box, 'plastic', 20);
  assert.equal(cards(), all, 'not filtered while typing goes on');
  assert.equal(box.value, 'plastic');
  vi.advanceTimersByTime(SEARCH_PAUSE_MS);
  await nextTick();
  assert.equal(query, 'plastic');
  assert.ok(cards() < all, 'filtered once typing paused');
});
