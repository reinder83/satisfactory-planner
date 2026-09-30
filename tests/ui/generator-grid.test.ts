// A generator's factory dialog (#560): the Power grid destination takes no item, so its row has
// no icon and no empty icon frame, and a grid-only plant gets no "Demand for the item" note. A
// nuclear plant, whose waste goes on to other rows, keeps the note for those.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generated, open, page } from './setup.ts';
import type { CalcRow } from '../../public/types/index.ts';

beforeEach(() => page());

// The dialog's destination rows, and the note under them (null when there is none).
const destinations = () => {
  const rows = $$('#detail .rail-row').map(row => ({
    label: row.querySelector('.rail-main b, .rail-main .rail-link')!.textContent!.trim(),
    icon: !!row.querySelector('.item-icon'),
    frame: !!row.querySelector('.rail-noicon, .item-icon-missing'),
  }));
  const note = $('#detail .rail-rows + p');
  return { rows, note: note ? note.textContent!.replace(/\s+/g, ' ').trim() : null };
};

test('a fuel or coal plant delivers to the grid alone: no icon frame, no demand note', () => {
  const plan = generated();
  const plants = plan.stages['3'].rows!.filter(
    r => r.generationMW > 0 && !Object.keys(r.outputs).length,
  );
  assert.ok(plants.length, 'the default plan has a grid-only generator in Phase 3');
  open({ calculated: plan, state: { settings: { phase: '3' } } });
  render();
  for (const plant of plants) {
    openCalculatedFactory(plant.id);
    assert.deepEqual(destinations(), {
      rows: [{ label: 'Power grid', icon: false, frame: false }],
      note: null,
    });
  }
});

test('a nuclear plant keeps the demand note for its waste, and the grid row stays bare', () => {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const line = rows.find(r => Object.keys(r.outputs).length === 1 && !r.generationMW)!;
  const uranium: CalcRow = {
    ...line,
    id: 'test-uranium-power',
    name: 'Uranium power',
    machine: 'Nuclear Power Plant',
    inputs: { 'Uranium Fuel Rod': 1 },
    outputs: { 'Uranium Waste': 50 },
    generationMW: 2500,
  };
  rows.push(uranium, {
    ...line,
    id: 'test-waste-recycle',
    name: 'Non-Fissile Uranium',
    inputs: { 'Uranium Waste': 50 },
    outputs: { 'Non-Fissile Uranium': 75 },
  });
  open({ calculated: plan, state: { settings: { phase: '3' } } });
  render();
  openCalculatedFactory(uranium.id);
  const { rows: drawn, note } = destinations();
  assert.deepEqual(drawn[0], { label: 'Power grid', icon: false, frame: false });
  assert.deepEqual(drawn.slice(1), [{ label: 'Non-Fissile Uranium ↗', icon: true, frame: false }]);
  assert.equal(note, "Demand for the item across this phase's whole plan.");
});
