// "Where a somersloop pays off most" on the build plan (#1215, ui/plan/SloopPayoffPanel.vue): what
// one amplified machine saves on each line of the phase, best first by raw resources per
// somersloop, the first five until "Show all", each name opening its line's dialog. Nothing before
// Phase 3 or in New to Satisfactory mode, and nothing is stored or recalculated.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { setHideDone, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { sloopPayoffs } from '../../public/app/sloop-payoff.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { CalcRow, CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

const words = (element: Element | null | undefined) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  setBeginnerMode(false);
  page();
});
afterEach(() => setBeginnerMode(false));

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
    '1 somersloop on Iron Plate: −1 Constructor, −30 Iron Ore/min, +1 MW',
    '1 somersloop on Iron Ingot: −1 Smelter, −30 Iron Ore/min, +5 MW',
    '1 somersloop on Iron Rod: −1 Constructor, −15 Iron Ore/min, +4.5 MW',
    '2 somersloops on Reinforced Iron Plate (one Assembler): −22.5 Iron Ore/min, +6.75 MW · 11.3 raw resources/min per somersloop',
  ]);
  assert.equal(
    words($('[data-sloop-budget]')),
    'This plan commits none of the 106 somersloops you have to spend. To plan with somersloops, raise the amplification budget on step 2 of Edit settings; the plan is recalculated only when you press Recalculate in place. Change somersloops in Edit settings →',
  );
  assert.equal($('[data-sloop-more]'), null, 'four lines need no "Show all"');
  // A name opens its production line's dialog.
  const name = $<HTMLButtonElement>('[data-sloop-line="Iron Rod"] button')!;
  assert.equal(name.dataset.calcFactory, 'Iron Rod');
  name.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  assert.match(words($('#detail h2')), /Iron Rod/);
  assert.deepEqual(plan, before, 'the plan is not changed');
});

test('a real plan shows the first five until "Show all", in the ranking’s order', async () => {
  const plan = generated();
  const ranked = sloopPayoffs(plan.stages['4'], '4', plan.settings).map(entry => entry.id);
  assert.ok(ranked.length > 5, 'the default Phase 4 has more than five candidates');
  await show(plan, '4');
  const shown = () => $$<HTMLElement>('[data-sloop-line]').map(item => item.dataset.sloopLine);
  assert.deepEqual(shown(), ranked.slice(0, 5));
  const more = $<HTMLButtonElement>('[data-sloop-more]')!;
  assert.equal(words(more), `Show all ${ranked.length}`);
  more.click();
  await nextTick();
  assert.deepEqual(shown(), ranked);
  assert.equal(words($('[data-sloop-more]')), 'Show fewer');
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
  setBeginnerMode(true);
  await show(plan, '4');
  assert.equal($('[data-sloop-payoff]'), null, 'New to Satisfactory hides it');
  setBeginnerMode(false);
  await show(plan, '4');
  assert.ok($('[data-sloop-payoff]'));
});
