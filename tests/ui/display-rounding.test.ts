// X-2 (#1335): the factory card, the factory dialog and the Resources page show rounded figures
// and keep the exact value in a title (hover). The plan's own numbers are not touched.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { Catalog, StoredCalculatedPlan } from '../../public/types/index.ts';

beforeEach(() => page());

function openResources(plan: StoredCalculatedPlan) {
  open({
    calculated: plan,
    workspace: { catalog: { raw: Object.keys(plan.settings.limits) } as Catalog },
  });
  go('resources');
  render();
}

test('the Resources table rounds its rates and puts the exact ones in titles', () => {
  const plan = generated();
  plan.settings.limits = { 'Iron Ore': 3000, Coal: 0 };
  plan.stages['3'].raw = { 'Iron Ore': 2921.89, Coal: 0.004 };
  openResources(plan);
  const row = (name: string) =>
    $$('#main tbody tr').find(r => r.querySelector('.resource-name')!.textContent!.includes(name))!;
  const cells = (name: string) => [...row(name).querySelectorAll('td.number')];
  assert.deepEqual(
    cells('Iron Ore').map(c => [c.textContent!.trim(), c.getAttribute('title')]),
    [
      ['2,922/min', '2,921.89/min'],
      ['3,000/min', '3,000/min'],
      ['78.11/min', '78.11/min'],
    ],
  );
  // A shortfall that would round to 0 still shows, with its exact value.
  const over = row('Coal').querySelector('[data-over]')!;
  assert.match(over.textContent!, /Over by <0\.01\/min/);
  assert.equal(over.getAttribute('title'), '0.004/min');
});

test('the power headline rounds its figures and keeps the exact ones on hover', () => {
  openResources(generated());
  const titled = $$('[data-power-headline] span[title]');
  assert.equal(titled.length, 2);
  for (const span of titled) {
    assert.match(span.getAttribute('title')!, /^[\d,.]+ MW$/);
    assert.ok(!/\.\d{3,}/.test(span.textContent!), 'rounded text: ' + span.textContent);
  }
});

test('a factory card and its dialog round the headline and carry the exact value', () => {
  const plan = generated();
  const row = plan.stages['3'].rows!.find(r => {
    const names = Object.keys(r.outputs);
    return names.length === 1 && names[0] === r.name;
  })!;
  row.outputs = { [Object.keys(row.outputs)[0]!]: 2921.89 };
  open({ calculated: plan });
  go('factories');
  render();
  const card = $(`#main button.name[data-calc-factory="${row.id}"]`)!.closest('.factory-card')!;
  const output = card.querySelector('.output')!;
  assert.equal(output.textContent!.replace(/\s+/g, ''), '2,922/min');
  assert.equal(output.getAttribute('title'), '2,921.89/min');
  openCalculatedFactory(row.id);
  const summary = $('#detail [data-dialog-summary]')!;
  assert.equal(summary.textContent, '2,922/min');
  assert.equal(summary.getAttribute('title'), '2,921.89/min');
});
