// What a production line and a factory grow to in the later phases of the plan (#1299): one muted
// line on the line's card, in its dialog over the expansion table (which also gives its clocks and
// power per phase) and in its build-plan step, "Phase 4: 89 · Phase 5: 225 Refineries", or "Not
// needed after Phase 3"; and under each factory's name its machines and rough foundations per
// phase, labelled as an estimate. Nothing is stored or recalculated: the plan's stages are read.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { machineFoundations } from '../../public/app/footprints.ts';
import {
  setFactoryEditing,
  setFactoryFilter,
  setHideDone,
  setQuery,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { buildingName } from '../../public/wording.ts';
import { $, $$, evil, generated, go, open, page } from './setup.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  StageKey,
} from '../../public/types/index.ts';

const ALPHA = 'fg-alpha';
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// The default plan with three Phase 3 lines set up: `grown` needs 89 machines in Phase 4 and 225
// in Phase 5, `dropped` is built in no later phase, and `steady` the same in every one.
function planned() {
  const plan: CurrentCalculatedPlan = generated();
  const rows = plan.stages['3']!.rows!;
  const later = (key: StageKey) => plan.stages[key]!.rows!;
  const inAll = rows.filter(
    row => later('4').some(r => r.id === row.id) && later('5').some(r => r.id === row.id),
  );
  const [grown, steady, dropped] = [inAll[0]!, inAll[1]!, inAll[2]!];
  const set = (key: StageKey, id: string, machines: number) => {
    const row = later(key).find(r => r.id === id)!;
    row.machines = machines;
  };
  set('4', grown.id, 89);
  set('5', grown.id, 225);
  set('4', steady.id, steady.machines);
  set('5', steady.id, steady.machines);
  for (const key of ['4', '5'] as const)
    plan.stages[key]!.rows = later(key).filter(row => row.id !== dropped.id);
  return { plan, grown, steady, dropped };
}

// Alpha holds the grown and the dropped line.
const groupsOf = (ids: string[]): FactoryGroups => ({
  groups: [{ id: ALPHA, name: evil }],
  assignments: Object.fromEntries(ids.map(id => [id, [{ group: ALPHA, rate: null }]])),
});

async function show(view: 'factories' | 'plan') {
  const setup = planned();
  open({
    calculated: setup.plan,
    phase: '3',
    state: { factoryGroups: groupsOf([setup.grown.id, setup.dropped.id]) },
  });
  go(view);
  render();
  await nextTick();
  return setup;
}

const card = (id: string) =>
  $(`#main [data-check="calc-3-${id}"]`)!.closest<HTMLElement>('.factory-card')!;
const step = (id: string) => $(`#main [data-check="calc-3-${id}"]`)!.closest<HTMLElement>('.task')!;
const growText = (row: CalcRow) => `Phase 4: 89 · Phase 5: 225 ${buildingName(row.machine, 225)}`;

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  setHideDone(false);
});

test('a line card says what the same line needs in the later phases (#1299)', async () => {
  const { grown, steady, dropped } = await show('factories');
  const later = (row: CalcRow) => card(row.id).querySelector('[data-later-growth]');
  assert.equal(text(later(grown)), 'Later phases: ' + growText(grown));
  // The prefix is for screen readers; the card shows the figures.
  assert.equal(text(later(grown)!.querySelector('.visually-hidden')), 'Later phases:');
  assert.ok(later(grown)!.classList.contains('muted'));
  assert.equal(text(later(dropped)), 'Later phases: Not needed after Phase 3');
  // The same machines in every later phase: nothing to say.
  assert.equal(later(steady), null);
  // Phase 5 has no later phase.
  open({ calculated: planned().plan, phase: '5', state: {} });
  render();
  await nextTick();
  assert.equal($('#main [data-later-growth]'), null);
});

test('the dialog says the same and gives the machines, clock and power per phase', async () => {
  const { grown } = await show('factories');
  openCalculatedFactory(grown.id);
  await nextTick();
  assert.equal(text($('#detail [data-later-growth]')), 'Later phases: ' + growText(grown));
  const head = $$('#detail .expansion-table thead th').map(th => text(th));
  assert.deepEqual(head, ['Phase', 'Machines', 'Add', 'Clock', 'Power']);
  const rows = $$('#detail .expansion-table tbody tr').map(tr =>
    [...tr.querySelectorAll('td')].map(td => text(td)),
  );
  const phase = (label: string) => rows.find(cells => cells[0]!.startsWith(label))!;
  assert.equal(phase('Phase 4')[1], '89');
  assert.equal(phase('Phase 5')[1], '225');
  assert.equal(phase('Phase 5')[2], '+136');
  for (const label of ['Phase 3', 'Phase 4', 'Phase 5']) {
    assert.match(phase(label)[3]!, /^[\d.,]+%(, last at [\d.,]+%)?$/, label + ' clock');
    assert.match(phase(label)[4]!, /^(generates )?[\d.,]+ (MW|GW)$/, label + ' power');
  }
  // A phase without the line has nothing in its cells.
  const before = rows.find(cells => cells[1] === '—');
  if (before) assert.deepEqual(before.slice(1), ['—', '—', '—', '—']);
});

test('a line’s build-plan step says it too, a dropped line that it is not needed', async () => {
  const { grown, steady, dropped } = await show('plan');
  const later = (row: CalcRow) => step(row.id).querySelector('[data-step-later]');
  assert.equal(text(later(grown)), 'Later phases: ' + growText(grown));
  assert.equal(text(later(dropped)), 'Later phases: Not needed after Phase 3');
  assert.equal(later(steady), null);
  // Only the line's own step: no other step says it.
  assert.equal($$('#main [data-step-later]').length >= 2, true);
  for (const note of $$('#main [data-step-later]'))
    assert.match(
      note.closest('.task')!.querySelector('[data-check]')!.getAttribute('data-check')!,
      /^calc-3-/,
    );
});

test('a factory heading gives its machines and rough foundations per phase', async () => {
  const { plan, grown, dropped } = await show('factories');
  const line = $(`#section-${ALPHA} [data-group-growth]`)!;
  assert.ok(line.classList.contains('muted'));
  const machines3 = grown.machines + dropped.machines;
  const room = (count: number, row: CalcRow) => machineFoundations(row.machine, count);
  const foundations3 = Math.ceil(room(grown.machines, grown) + room(dropped.machines, dropped));
  const grown4 = plan.stages['4']!.rows!.find(row => row.id === grown.id)!;
  assert.equal(
    text(line.querySelector('[data-group-growth-phases]')),
    `Phase 3: ${machines3.toLocaleString('en-US')} machines, ≈ ${foundations3.toLocaleString('en-US')} foundations` +
      ` · Phase 4: 89, ≈ ${Math.ceil(room(89, grown4)).toLocaleString('en-US')}` +
      ` · Phase 5: 225, ≈ ${Math.ceil(room(225, grown4)).toLocaleString('en-US')}`,
  );
  // It says what the estimate leaves out.
  assert.match(
    text(line),
    /rough estimate from machine footprints only, without belts, pipes or spacing\.$/,
  );
  // Not while the factories are edited.
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($(`#section-${ALPHA} [data-group-growth]`), null);
  // The hostile factory name stays text.
  assert.equal($('x-evil'), null);
});
