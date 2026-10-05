// Whole machines and their cost on the pages (#1066): the plan's "What whole machines cost" panel
// and ADA's line, a production line's "Exact clocks for this line" in its dialog, the build-plan
// step and card that say what a recalculation would change, the notice that offers it, and the
// wizard's whole-machine choice with its measured cost.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { roundingCost } from '../../public/app/exact-clocks.ts';
import { num } from '../../public/app/format.ts';
import { calculated, setWizard, state, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { cancelEstimate, setEstimatePaused } from '../../public/app/wizard/estimate.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { carryOptions } from '../../public/state.ts';
import { $, applyUpdate, catalog, generatedWith, go, open, page, stubFetch } from './setup.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  StoredCalculatedPlan,
  UpdateOp,
} from '../../public/types/index.ts';

// The wizard's fresh settings: whole machines from Phase 1, with the guided Concrete top-up.
const WHOLE = { phase: '1', wholeMachines: true, storageOverrides: { Concrete: 20 } };
let wholeCache: CurrentCalculatedPlan | undefined;
const wholePlan = () => structuredClone((wholeCache ??= generatedWith(WHOLE)));
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
// A Phase 3 line that rounds and sends some of its product to storage or the sink.
function overflowing(plan: CurrentCalculatedPlan): CalcRow {
  const stage = plan.stages['3'];
  return stage.rows!.find(row => {
    const [main] = Object.keys(row.outputs);
    return (
      row.machine === 'Constructor' &&
      !!main &&
      stage.rows!.filter(other => other.outputs[main]).length === 1 &&
      (stage.surplus?.[main] || 0) > 0.5
    );
  })!;
}
// A Phase 3 line that makes only fluids (a Refinery's Fuel line also makes Polymer Resin, a
// solid, so it rounds like any solid line).
const fluidLine = (plan: CurrentCalculatedPlan) => {
  const solid = new Set(catalog().storageItems.map(item => item.name));
  return plan.stages['3'].rows!.find(
    row =>
      row.generationMW === 0 &&
      Object.keys(row.outputs).length > 0 &&
      Object.keys(row.outputs).every(item => !solid.has(item)),
  )!;
};
function adaSays(id: string): string {
  adaClearFault();
  for (let i = 0; i < 60; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === id) return line.text;
  }
  return '';
}
function openWhole(plan: StoredCalculatedPlan = wholePlan(), progress = {}) {
  page();
  open({
    calculated: plan,
    phase: '3',
    workspace: { catalog: catalog() },
    state: progress,
  });
  go('plan');
  render();
}

beforeEach(() => {
  setWizard(null);
});

test('the build plan shows what whole machines cost in the phase, beside exact clocks', async () => {
  const plan = wholePlan();
  openWhole(plan);
  await settle();
  const panel = $('[data-rounding-cost]');
  assert.ok(panel, 'the panel is there');
  const cost = roundingCost(plan.stages['3'])!;
  assert.match(
    text('[data-rounding-cost]'),
    new RegExp(`Buildings ${num(cost.buildings[0])} exact clocks: ${num(cost.buildings[1])}`),
  );
  assert.match(text('[data-rounding-cost]'), /Power needed .* exact clocks: /);
  assert.match(text('[data-rounding-cost]'), /More raw resources .*\+/);
  assert.match(
    adaSays('rounding-cost'),
    new RegExp(
      `^Whole machines at 100% cost this phase ${num(cost.buildings[0] - cost.buildings[1])} buildings`,
    ),
  );
  // A plan without whole machines, or one calculated before the record, shows none.
  const older = wholePlan();
  for (const stage of Object.values(older.stages)) delete stage.exactPlan;
  openWhole(older);
  await settle();
  assert.equal($('[data-rounding-cost]'), null);
  assert.equal(adaSays('rounding-cost'), '');
});

test('a line’s dialog saves exact clocks without recalculating; the plan asks for one', async () => {
  const plan = wholePlan(),
    line = overflowing(plan);
  openWhole(plan);
  const sent: UpdateOp[] = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  openCalculatedFactory(line.id);
  await settle();
  const box = $<HTMLInputElement>(`[data-exact-clock="${line.id}"]`)!;
  assert.ok(box, 'the dialog offers the choice');
  assert.equal(box.checked, false);
  assert.match(
    text('[data-exact-clock-note]'),
    /on whole machines at 100%\. This phase makes .* more/,
  );
  const before = JSON.stringify(calculated);
  box.click();
  await settle();
  assert.deepEqual(sent, [{ type: 'exactClocks', value: { '3': [line.id] } }]);
  assert.deepEqual(state.exactClocks, { '3': [line.id] });
  assert.equal(state.version, 16);
  assert.equal(JSON.stringify(calculated), before, 'the plan is not recalculated');
  assert.match(text('[data-exact-clock-note]'), /^Saved\. The plan keeps running this line/);
  // The build plan says what a recalculation would change, on the notice, the step and ADA.
  assert.match(
    text('[data-exact-clocks-recalc]'),
    new RegExp(
      `Exact clocks asked for: ${line.name} \\(Phase 3\\)\\. Nothing changes until you start it\\.`,
    ),
  );
  assert.equal(text('[data-step-clocks]'), 'Exact clocks after a recalculation');
  assert.match(adaSays('exact-clocks-pending'), /^You changed the clocks of 1 production line/);
  // The card on the Factories page says it too.
  go('factories');
  render();
  await settle();
  assert.equal(text('[data-exact-clocks]'), 'Exact clocks after a recalculation');
  assert.ok($('[data-exact-clocks-recalc]'), 'and so does the notice there');
  // Taking it back forgets the choice: nothing to recalculate, the state's version as before.
  openCalculatedFactory(line.id);
  await settle();
  $<HTMLInputElement>(`[data-exact-clock="${line.id}"]`)!.click();
  await settle();
  assert.deepEqual(sent.at(-1), { type: 'exactClocks', value: null });
  assert.equal('exactClocks' in state, false);
  assert.equal($('[data-exact-clocks-recalc]'), null);
});

test('a line that uses up a fluid says exact clocks would not remove its sink (#1063)', async () => {
  // Phase 3 on coal power: the Petroleum Coke line uses up the Heavy Oil Residue of the Plastic
  // and Rubber lines, and all its coke goes to the sink.
  const plan = generatedWith({ ...WHOLE, phase: '3', mainPower: 'coal', limitsConfirmed: true });
  const coke = plan.stages['3'].rows!.find(row => row.id === 'Recipe_PetroleumCoke_C')!;
  assert.ok(coke, 'a Petroleum Coke line');
  openWhole(plan);
  openCalculatedFactory(coke.id);
  await settle();
  assert.ok($(`[data-exact-clock="${coke.id}"]`), 'the dialog still offers the choice');
  assert.match(
    text('[data-exact-clock-note]'),
    /more Petroleum Coke than it uses, which goes to storage or the sink\. It is left over from using up Heavy Oil Residue, so exact clocks would not remove it: they only underclock the last machine to the exact remainder\.$/,
  );
  // A line whose overflow is rounding keeps the sentence that exact clocks remove it.
  const rounding = overflowing(wholePlan());
  openWhole();
  openCalculatedFactory(rounding.id);
  await settle();
  assert.match(
    text('[data-exact-clock-note]'),
    /Exact clocks underclock the last machine to the exact remainder instead, and the lines feeding it shrink with it\.$/,
  );
});

test('“Recalculate with exact clocks” makes a new profile that plans the lines asked for', async () => {
  const plan = wholePlan(),
    line = overflowing(plan);
  openWhole(plan, { version: 16, exactClocks: { '3': [line.id] } });
  await settle();
  let sent: { settings: StoredCalculatedPlan['settings']; carryFrom: string; name: string };
  let next: StoredCalculatedPlan | undefined;
  stubFetch({
    '/api/profiles': (body: typeof sent) => {
      sent = body;
      next = generatedWith(body.settings);
      return { saveId: 's', profileId: 'p2', reviewCount: 0, workspace };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p2', kind: 'calculated', name: 'Whole · exact clocks' },
      state: { ...state, exactClocks: undefined, version: 1 },
      plan: next,
    }),
  });
  $<HTMLButtonElement>('[data-recalc-exact-clocks]')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent!.settings.exactClocks, { '3': [line.id] });
  assert.equal(sent!.carryFrom, 'p');
  assert.match(sent!.name, / · exact clocks$/);
  assert.deepEqual(calculated?.settings.exactClocks, { '3': [line.id] }, 'the new profile is open');
  assert.equal($('[data-exact-clocks-recalc]'), null, 'and needs no recalculation');
  const row = calculated!.stages['3']!.rows!.find(candidate => candidate.id === line.id)!;
  assert.ok(row.equivalent < line.equivalent);
  const [main] = Object.keys(line.outputs) as [string];
  assert.ok((calculated!.stages['3']!.surplus?.[main] || 0) < 0.01, 'nothing of it overflows');
});

test('a fluid line always runs at exact clocks; an exact plan offers no choice and no cost', async () => {
  const plan = wholePlan();
  openWhole(plan);
  const fluid = fluidLine(plan);
  assert.ok(fluid, 'Phase 3 has a fluid line');
  openCalculatedFactory(fluid.id);
  await settle();
  assert.equal($('[data-exact-clock-choice]'), null);
  assert.match(text('[data-exact-clock-fixed]'), /^A fluid line always runs at exact clocks/);
  const exact = generatedWith({ ...WHOLE, wholeMachines: false });
  openWhole(exact);
  await settle();
  assert.equal($('[data-rounding-cost]'), null);
  openCalculatedFactory(overflowing(plan).id);
  await settle();
  assert.equal($('[data-exact-clock-choice]'), null);
  assert.equal($('[data-exact-clock-fixed]'), null);
});

// The wizard: the whole-machine box says what it costs once the live estimate measured it, the
// estimate shows what whole machines add, and Review has a table of every phase.
function wizardAt(step: number, preview: StoredCalculatedPlan | null) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(wholePlan().settings) },
    preview,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

test('the wizard measures what whole machines cost, on Goals and in Review', async () => {
  cancelEstimate(true);
  setEstimatePaused(false, null);
  const plan = wholePlan(),
    cost = roundingCost(plan.stages['5'])!;
  stubFetch({ '/api/preview': plan });
  wizardAt(3, null);
  await settle();
  await settle();
  assert.equal(
    text('[data-whole-machines-cost]'),
    `Measured on these settings: Phase 5 takes ${num(cost.buildings[0])} buildings and ${power(cost.needMW[0])} of power with whole machines, against ${num(cost.buildings[1])} buildings and ${power(cost.needMW[1])} with exact clocks.`,
  );
  assert.equal(
    text('[data-estimate-rounding]'),
    `+${num(cost.buildings[0] - cost.buildings[1])} buildings, +${power(cost.needMW[0] - cost.needMW[1])} against exact clocks`,
  );
  cancelEstimate(true);
  wizardAt(5, plan);
  await settle();
  assert.ok($('[data-rounding-cost] table'), 'Review lists every phase in a table');
  assert.ok($('[data-rounding-phase="5"]'));
  setWizard(null);
});
