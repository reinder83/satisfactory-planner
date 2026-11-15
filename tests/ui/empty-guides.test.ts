// X-7 (#1355): a page with nothing to list says what will appear there and links to the step that
// fills it (ui/EmptyGuide.vue): Factories and Logistics in a phase that builds no production lines,
// the Trains tab with no stations or lines, and the storage room with no container planned. The
// guide is only there while the page is empty, and the page's own notice and controls stay.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setLogisticsTab, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generated, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
async function show(view: string, phase: Phase, plan: CurrentCalculatedPlan = generated()) {
  open({ calculated: plan, phase });
  go(view as never);
  render();
  await settle();
}
const guide = (name: string) => $(`#main [data-empty-guide="${name}"]`);

beforeEach(() => {
  page();
  setQuery('');
  setLogisticsTab('links');
});

test('X-7: an empty Factories page says what appears and links to the build plan', async () => {
  await show('factories', '1');
  assert.ok($('[data-milestone-only]'), 'the existing notice and its button stay');
  const empty = guide('factories')!;
  assert.ok(empty, 'the guide is there');
  assert.equal(empty.querySelector('h2')!.textContent, 'What will appear here');
  assert.match(empty.textContent!, /production line the plan builds/);
  const link = empty.querySelector<HTMLAnchorElement>('a[data-empty-link]')!;
  assert.equal(link.getAttribute('href'), '#plan');
  assert.equal(empty.getAttribute('aria-label'), 'What will appear here');
  // A phase with lines has none.
  await show('factories', '3');
  assert.equal(guide('factories'), null);
});

test('X-7: an empty Logistics page says the same and links to Factories', async () => {
  await show('logistics', '1');
  const empty = guide('logistics')!;
  assert.ok(empty);
  assert.equal(empty.querySelector('a[data-empty-link]')!.getAttribute('href'), '#factories');
  assert.ok($('[data-milestone-only]'), 'the notice stays');
  await show('logistics', '3');
  assert.equal(guide('logistics'), null, 'a phase with lines has the links, not the guide');
});

test('X-7: the Trains tab with no station and no line explains them and opens Between factories', async () => {
  setLogisticsTab('trains');
  await show('logistics', '3');
  const empty = guide('trains')!;
  assert.ok(empty, 'no stations, no lines');
  assert.match(empty.textContent!, /train stations with their platforms/);
  const button = empty.querySelector<HTMLButtonElement>('button[data-empty-link]')!;
  assert.ok($('[data-station-add]'), 'the page keeps its own controls under the guide');
  button.click();
  await settle();
  assert.equal(
    $('[data-logistics-tab="links"]')!.getAttribute('aria-selected'),
    'true',
    'the other tab opens',
  );
  assert.equal(document.activeElement, $('[data-logistics-tab="links"]'), 'and takes focus');
});

test('X-7: the empty storage room says what fills it, and the guide goes with a container', async () => {
  const bare = generated();
  for (const stage of Object.values(bare.stages)) stage.storage = {};
  await show('storage', '3', bare);
  const empty = guide('storage')!;
  assert.ok(empty, 'no container planned');
  assert.match(empty.textContent!, /storage supply/);
  assert.equal(empty.querySelectorAll('button[data-empty-link]').length, 1);
  assert.ok($('#main .bay-letter, #main [data-storage-key], #main .floor-grid'), 'the room stays');
  await show('storage', '3');
  assert.equal(guide('storage'), null, 'a plan with storage has no guide');
});
