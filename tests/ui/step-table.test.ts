// "Tap the resource nodes" as a table (#1136, StepTable.vue): one row per resource with its rate,
// nodes, machines, Power Shards and power, a total row, the intro line above it; the step's plain
// body stays for the search, which also finds the table's own words; an edited body replaces the
// table; the step id, and so its tick, is the one it always had.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const toLocale = Number.prototype.toLocaleString;
beforeAll(() => {
  Number.prototype.toLocaleString = function (
    this: number,
    _locale?: unknown,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocale.call(this, 'en-US', options);
  };
});
afterAll(() => {
  Number.prototype.toLocaleString = toLocale;
  setQuery('');
});

let mined: CurrentCalculatedPlan;
beforeEach(() => {
  mined ??= generatedWith({ phase: '3', wholeMachines: true, phaseMining: true });
  page();
  setQuery('');
});
const plain = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();

test('the mining step shows a table: a row per resource, a total row, the intro above', () => {
  open({ calculated: structuredClone(mined), phase: '3' });
  go('plan');
  render();
  const step = $('[data-task="mining-3"]')!;
  const table = step.querySelector('[data-step-table]')!;
  assert.ok(table, 'the table is drawn');
  assert.match(plain(table.querySelector('p')?.textContent), /^Phase 3 mines with Miner Mk\.2/);
  assert.deepEqual(
    [...table.querySelectorAll('thead th')].map(cell => plain(cell.textContent)),
    ['Resource', 'Rate', 'Nodes', 'Machines', 'Shards', 'Power'],
  );
  const rows = [...table.querySelectorAll('[data-step-table-row]')];
  assert.ok(rows.length >= 2);
  const iron = rows.find(row => plain(row.querySelector('th')?.textContent) === 'Iron Ore')!;
  assert.ok(iron, 'Iron Ore has a row');
  const cells = [...iron.querySelectorAll('td')];
  assert.match(plain(cells[0]!.textContent), /^[\d,.]+\/min$/);
  assert.match(plain(cells[1]!.textContent), /pure/);
  assert.match(plain(cells[2]!.textContent), /^Miner Mk\.2: \d+ at /);
  assert.equal(cells[2]!.dataset.label, 'Machines', 'a phone shows each cell under its column');
  assert.match(plain(cells[4]!.textContent), /MW$/);
  const total = table.querySelector('[data-step-table-total]')!;
  assert.equal(plain(total.querySelector('th')?.textContent), 'Total');
  // Without Power Shards in Phase 3 the step advises the research, under the table.
  assert.match(
    plain(table.querySelector('[data-step-table-after]')?.textContent),
    /^Research Power Shards in the MAM/,
  );
});

test('the search finds the mining step by its body and by the table’s own words', async () => {
  open({ calculated: structuredClone(mined), phase: '3' });
  go('plan');
  for (const words of ['iron ore', 'rate', 'shards']) {
    setQuery(words);
    render();
    await nextTick();
    assert.ok($('[data-task="mining-3"]'), words);
  }
  setQuery('no such step anywhere');
  render();
  await nextTick();
  assert.equal($('[data-task="mining-3"]'), null);
});

test('an edited mining step shows the edited words instead of the table, and keeps its tick', () => {
  open({
    calculated: structuredClone(mined),
    phase: '3',
    state: {
      checks: { 'mining-3': true },
      taskEdits: {
        order: {},
        removed: [],
        titles: {},
        links: {},
        bodies: { 'mining-3': 'My own mining notes.' },
      },
    },
  });
  go('plan');
  render();
  const step = $('[data-task="mining-3"]')!;
  assert.equal(step.querySelector('[data-step-table]'), null);
  assert.equal(plain(step.querySelector('p')?.textContent), 'My own mining notes.');
  assert.equal($$<HTMLInputElement>('[data-check="mining-3"]')[0]!.checked, true);
});
