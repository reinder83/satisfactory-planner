// "Where a somersloop pays off most" on the build plan (#1215, ui/plan/SloopPayoffPanel.vue): what
// one amplified machine saves on each line of the phase, best first by raw resources per
// somersloop, every line in the build plan's Somersloops tab (#1243), each name opening its line's
// dialog. Nothing before Phase 3 or in New to Satisfactory mode, and nothing is stored or
// recalculated. It is a sortable table (BP-8, #1340).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { setBrowserDetail } from '../../public/app/detail-level.ts';
import { setHideDone, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { sloopPayoffs } from '../../public/app/sloop-payoff.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { CalcRow, CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

const words = (element: Element | null | undefined) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  setBrowserDetail('standard');
  page();
});
afterEach(() => setBrowserDetail('standard'));

async function show(plan: CurrentCalculatedPlan, phase: Phase) {
  page();
  open({ calculated: plan, phase });
  setQuery('');
  setHideDone(false);
  go('plan');
  render();
  await nextTick();
}

// A line as the planner stores it, at `equivalent` machines at 100%.
const line = (
  id: string,
  machine: string,
  power: number,
  equivalent: number,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine,
  power,
  inputs,
  outputs,
  equivalent,
  machines: Math.ceil(equivalent),
  lastClock: 100,
  peakMW: Math.ceil(equivalent) * power,
  generationMW: 0,
});

// The default plan with Phase 3's lines replaced by a small iron chain (tests/sloop-payoff.test.ts
// works its figures out): 120 Iron Ore/min at 0.1 MW of extraction per ore into Iron Ingot, Iron
// Plate and Iron Rod, and one Assembler of Reinforced Iron Plate.
function ironPlan(): CurrentCalculatedPlan {
  const plan = generated();
  const phase3 = plan.stages['3'];
  phase3.rows = [
    line('Iron Ingot', 'Smelter', 4, 4, { 'Iron Ore': 120 }, { 'Iron Ingot': 120 }),
    line('Iron Plate', 'Constructor', 4, 2, { 'Iron Ingot': 60 }, { 'Iron Plate': 40 }),
    line('Iron Rod', 'Constructor', 4, 4, { 'Iron Ingot': 60 }, { 'Iron Rod': 60 }),
    line(
      'Reinforced Iron Plate',
      'Assembler',
      15,
      1,
      { 'Iron Plate': 30, Screw: 60 },
      { 'Reinforced Iron Plate': 5 },
    ),
  ];
  phase3.raw = { 'Iron Ore': 120 };
  phase3.supplied = {};
  // The default plan's Phase 3 fits, so it has its grid.
  phase3.grid!.extraction = { 'Iron Ore': 12 };
  plan.settings.powerFactor = 1;
  plan.settings.somersloops = 106;
  return plan;
}

test('each line says what one amplified machine saves, best first', async () => {
  const plan = ironPlan();
  const before = structuredClone(plan);
  await show(plan, '3');
  const panel = $('[data-sloop-payoff]');
  assert.ok(panel, 'the ranking shows in Phase 3');
  assert.equal(words(panel.querySelector('h2')), 'Where a somersloop pays off most');
  assert.deepEqual($$('[data-sloop-line]').map(words), [
    'Iron Plate −30 Iron Ore/min 1 −1 Constructor 30/min +1 MW Pin',
    'Iron Ingot −30 Iron Ore/min 1 −1 Smelter 30/min +5 MW Pin',
    'Iron Rod −15 Iron Ore/min 1 −1 Constructor 15/min +4.5 MW Pin',
    'Reinforced Iron Plate (one Assembler) −22.5 Iron Ore/min 2 none 11.25/min +6.75 MW Pin',
  ]);
  assert.equal(
    words($('[data-sloop-budget]')),
    'This plan commits none of the 106 somersloops you have to spend. To plan with somersloops, raise the amplification budget on step 2 of Edit settings; the plan is recalculated only when you press Recalculate in place. Change somersloops in Edit settings →',
  );
  assert.equal($('[data-sloop-more]'), null, 'four lines need no "Show all"');
  // A name opens its production line's dialog.
  const name = $<HTMLButtonElement>('[data-sloop-line="Iron Rod"] th button')!;
  assert.equal(name.dataset.calcFactory, 'Iron Rod');
  name.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  assert.match(words($('#detail h2')), /Iron Rod/);
  assert.deepEqual(plan, before, 'the plan is not changed');
});

test('a rate keeps its whole item name at 390 px (#1019)', async () => {
  await show(ironPlan(), '3');
  // Ordinary spaces and the template's line breaks collapse; the non-breaking ones stay.
  const raw = $('[data-sloop-line="Iron Plate"] [data-sloop-raw]')!
    .textContent!.replace(/[ \t\r\n]+/g, ' ')
    .trim();
  assert.equal(raw, '−30\u00a0Iron\u00a0Ore/min');
  assert.equal(words($('[data-sloop-line="Iron Plate"] [data-sloop-cell="power"]')), '+1 MW');
});

test('the table has its columns, sorts by a header and says so with aria-sort (BP-8)', async () => {
  await show(ironPlan(), '3');
  const headers = () => $$('[data-sloop-table] thead th');
  assert.deepEqual(headers().map(words), [
    'Line',
    'Somersloops',
    'Machines saved',
    'Raw resources saved per somersloop ▼',
    'Power change',
    'Action',
  ]);
  const sorts = () => headers().map(th => th.getAttribute('aria-sort'));
  const order = () => $$<HTMLElement>('[data-sloop-line]').map(row => row.dataset.sloopLine);
  // The ranking is the default order, and its column says so.
  assert.deepEqual(sorts(), ['none', 'none', 'none', 'descending', 'none', null]);
  assert.deepEqual(order(), ['Iron Plate', 'Iron Ingot', 'Iron Rod', 'Reinforced Iron Plate']);
  const sort = async (key: string) => {
    $<HTMLButtonElement>(`[data-sloop-sort="${key}"]`)!.click();
    await nextTick();
  };
  // The line's name sorts A to Z, and a second press reverses it.
  await sort('line');
  assert.deepEqual(order(), ['Iron Ingot', 'Iron Plate', 'Iron Rod', 'Reinforced Iron Plate']);
  assert.equal(sorts()[0], 'ascending');
  assert.equal(sorts()[3], 'none');
  await sort('line');
  assert.deepEqual(order(), ['Reinforced Iron Plate', 'Iron Rod', 'Iron Plate', 'Iron Ingot']);
  assert.equal(sorts()[0], 'descending');
  // Somersloops: the line that takes the most first.
  await sort('sloops');
  assert.equal(order()[0], 'Reinforced Iron Plate');
  assert.equal(sorts()[1], 'descending');
  // Power change: the biggest saving (the smallest increase) first.
  await sort('power');
  assert.deepEqual(order(), ['Iron Plate', 'Iron Rod', 'Iron Ingot', 'Reinforced Iron Plate']);
  assert.equal(sorts()[4], 'ascending');
  // Back to the ranking.
  await sort('perSloop');
  assert.deepEqual(order(), ['Iron Plate', 'Iron Ingot', 'Iron Rod', 'Reinforced Iron Plate']);
  assert.equal(sorts()[3], 'descending');
});

test('Pin on a row opens the line’s dialog with its pin field focused (BP-8)', async () => {
  const plan = ironPlan();
  plan.settings.amplifySloops = 8;
  const before = structuredClone(plan);
  await show(plan, '3');
  $<HTMLButtonElement>('[data-sloop-line="Iron Rod"] [data-sloop-pin-open]')!.click();
  await new Promise(resolve => setTimeout(resolve, 120));
  await nextTick();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  assert.ok($('#detail [data-sloop-pin-choice]'), 'the dialog has the pin control');
  assert.equal(document.activeElement?.id, 'sloop-pin-Iron Rod', 'focus is on its field');
  assert.deepEqual(plan, before, 'opening it changes nothing');
});

test('a real plan shows every line in the Somersloops tab, in the ranking’s order', async () => {
  const plan = generated();
  const ranked = sloopPayoffs(plan.stages['4'], '4', plan.settings).map(entry => entry.id);
  assert.ok(ranked.length > 5, 'the default Phase 4 has more than five candidates');
  await show(plan, '4');
  const shown = () => $$<HTMLElement>('[data-sloop-line]').map(item => item.dataset.sloopLine);
  assert.deepEqual(shown(), ranked, 'the tab has room for the whole list (#1243)');
  assert.equal($('[data-sloop-more]'), null, 'no "Show all"');
  assert.equal(
    $('[data-sloop-payoff]')!.closest('[role="tabpanel"]')!.id,
    'plan-panel-somersloops',
  );
  const tab = $<HTMLButtonElement>('[data-plan-tab="somersloops"]')!;
  assert.equal(tab.getAttribute('aria-selected'), 'false');
  tab.click();
  await nextTick();
  assert.equal(tab.getAttribute('aria-selected'), 'true');
  assert.equal($('#plan-panel-somersloops')!.hidden, false);
  // Amplified twins, generators and machines without slots are never listed.
  const rows = new Map((plan.stages['4'].rows || []).map(row => [row.id, row]));
  for (const id of shown()) {
    const row = rows.get(id!)!;
    assert.ok(!row.amplified && row.power > 0, id);
    assert.ok(!['Packager', 'Miner Mk.1', 'Water Extractor'].includes(row.machine), id);
  }
});

test('nothing before Phase 3, nor in New to Satisfactory mode', async () => {
  const plan = generated();
  await show(plan, '2');
  assert.equal($('[data-sloop-payoff]'), null, 'machines take no somersloops before Phase 3');
  assert.equal($('[data-plan-tab="somersloops"]'), null, 'and no tab for it');
  setBrowserDetail('beginner');
  await show(plan, '4');
  assert.equal($('[data-sloop-payoff]'), null, 'New to Satisfactory hides it');
  setBrowserDetail('standard');
  await show(plan, '4');
  assert.ok($('[data-sloop-payoff]'));
});
