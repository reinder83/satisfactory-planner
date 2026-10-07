// Protected storage fed from surplus first (#1061, the owner's rule there). Under whole machines a
// storage demand was part of each phase's solve, so every stored item no other line made got a
// whole machine at 100% for its 1/min and sank the rest: a Concrete line making 15/min for 1/min of
// storage, a Packager filling 60 Packaged Water/min to store 1, the lines behind them at full speed
// too. "My building materials" more than doubled Phases 1 and 2 (39 and 126 buildings against 17
// and 61 without storage). With `storageFromSurplus` (which the wizard and Round up production
// set), storage takes the plan's surplus first, and only an item with no surplus gets storage-only
// lines (`<recipe>:stock`), at exact clocks, after every other line. A plan without the setting,
// and every plan stored before it, plans storage exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, settings } from '../planner.ts';
import { DATA } from '../planner/data.ts';
import { phaseSteps, recipeIdOf, rowStepTitle } from '../public/progression.ts';
import { roundUpSettings } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { saveExport } from './types/fixtures.ts';
import { storageSources } from '../public/app/storage-source.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  CurrentStage,
  ItemRates,
  Progression,
  StageKey,
} from '../public/types/index.ts';

const STAGES: StageKey[] = ['1', '2', '3', '4', '5'];
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const fluid = (item: string) => !!DATA.items[item]?.fluid;
const buildings = (stage: CurrentStage) =>
  (stage.rows || []).reduce((total, row) => total + row.machines, 0);
const isStock = (row: CalcRow) => !!row.stock;
// Per minute, what `rows` make of each item beyond what they use themselves.
function net(rows: CalcRow[]): ItemRates {
  const left: ItemRates = {};
  for (const row of rows) {
    for (const [item, rate] of Object.entries(row.outputs)) left[item] = (left[item] || 0) + rate;
    for (const [item, rate] of Object.entries(row.inputs)) left[item] = (left[item] || 0) - rate;
  }
  return left;
}

const plans = new Map<string, CurrentCalculatedPlan>();
const planOf = (storage: string, fromSurplus = true) => {
  const key = storage + fromSurplus;
  if (!plans.has(key))
    plans.set(
      key,
      calculate({
        wholeMachines: true,
        storage,
        collectables: storage === 'all',
        ...(fromSurplus ? { storageFromSurplus: true } : {}),
      }),
    );
  return plans.get(key)!;
};

test('no whole line sinks almost all it makes of a stored item (#1061)', () => {
  for (const storage of ['construction', 'all']) {
    const plan = planOf(storage);
    for (const phase of STAGES) {
      const stage = plan.stages[phase];
      assert.ok(stage.feasible, `${storage}, Phase ${phase} fits`);
      // Whole lines only: a storage-only line runs at exact clocks, and what it sinks is the
      // solid that comes with a fluid it must use up (Rubber beside Plastic's Heavy Oil Residue).
      for (const row of (stage.rows || []).filter(row => !isStock(row))) {
        const main = Object.keys(row.outputs)[0];
        if (!main) continue;
        const made = row.outputs[main]!,
          sunk = stage.surplus?.[main] || 0;
        if (!(stage.storageAsked?.[main] ?? stage.storage?.[main])) continue;
        assert.ok(
          sunk < 0.75 * made,
          `${storage}, Phase ${phase}: ${row.id} sinks ${sunk} of the ${made} ${main} it makes`,
        );
      }
    }
  }
});

test('a storage-only line exists only for items with no surplus, at exact clocks, last (#1061)', () => {
  const plan = planOf('construction');
  assert.ok(
    (plan.stages['1'].rows || []).some(isStock),
    'Phase 1 has storage-only lines for the materials it makes no surplus of',
  );
  for (const phase of STAGES) {
    const stage = plan.stages[phase];
    const rows = stage.rows || [];
    const main = rows.filter(row => !isStock(row)),
      stock = rows.filter(isStock);
    // Every storage-only line comes after every other line.
    assert.deepEqual(rows, [...main, ...stock], `Phase ${phase}: storage-only lines come last`);
    const asked = stage.storageAsked!;
    assert.ok(asked, `Phase ${phase} records what storage asks`);
    // What the plan's own lines have spare of each item, beyond their own use and the deliveries
    // (which take all the lines make of a part, #1062).
    const spare = net(main);
    const stockNet = net(stock);
    for (const [item, rate] of Object.entries(asked)) {
      const filled = stage.storage![item] || 0;
      assert.ok(filled <= rate + 1e-6, `Phase ${phase}: ${item} gets at most its rate`);
      const surplus = (spare[item] || 0) - (stage.delivery?.[item]?.rate || 0);
      if (surplus > 0.002)
        assert.ok(
          (stockNet[item] || 0) < 1e-6,
          `Phase ${phase}: ${item} has a surplus of ${surplus}, so no storage-only line makes it for storage`,
        );
    }
    for (const row of stock) {
      assert.equal(row.id, row.stock!.recipe + ':stock', 'the id is <recipe>:stock');
      assert.equal(recipeIdOf(row), row.stock!.recipe, "its unlock is its recipe's");
      // A generator line is whole generators at 100% (#1064), burning fuel only for the load.
      if (row.power < 0) continue;
      assert.ok(
        Math.abs(row.equivalent - (row.machines - 1) - row.lastClock / 100) < 1e-6,
        `${row.id} runs its last machine at the exact remainder`,
      );
    }
  }
});

test('no fluid is overproduced for storage (#1061, the never-overproduce-fluids rule)', () => {
  const plan = planOf('packaged');
  let packaged = 0;
  for (const phase of STAGES) {
    const stage = plan.stages[phase];
    const rows = stage.rows || [];
    for (const row of rows) {
      const main = Object.keys(row.outputs)[0];
      if (!main?.startsWith('Packaged ') || !(stage.storage?.[main] ?? 0)) continue;
      packaged++;
      // A packaged fluid only storage takes is made at exactly the rate storage takes, so the
      // fluid behind it is made at exactly the rate the Packager needs.
      const usedElsewhere = rows.some(other => (other.inputs[main] || 0) > 0);
      if (usedElsewhere) continue;
      assert.ok(
        (stage.surplus?.[main] || 0) < 0.002,
        `Phase ${phase}: ${row.id} sends ${stage.surplus?.[main]} ${main} to the sink`,
      );
      for (const [item, rate] of Object.entries(row.inputs))
        if (fluid(item))
          assert.ok(
            rate <= ((stage.storage![main] || 0) / row.outputs[main]!) * rate + 1e-6 &&
              Math.abs(row.outputs[main]! - stage.storage![main]!) < 1e-6,
            `Phase ${phase}: ${row.id} takes ${rate} ${item} for ${stage.storage![main]} ${main} stored`,
          );
    }
    // Every fluid still balances exactly.
    const left = net(rows);
    for (const [item, rate] of Object.entries(left))
      if (fluid(item) && rate > 1e-6 && !(stage.raw?.[item] ?? 0))
        assert.ok(rate < 1e-4, `Phase ${phase}: ${rate} ${item}/min is made beyond its use`);
  }
  assert.ok(packaged > 0, 'the plan stores packaged fluids');
});

test('My building materials no longer more than doubles the early phases (#1061)', () => {
  const stocked = planOf('construction'),
    bare = planOf('none');
  for (const phase of ['1', '2', '3'] as StageKey[]) {
    const with_ = buildings(stocked.stages[phase]),
      without = buildings(bare.stages[phase]);
    assert.ok(
      with_ <= without * 1.5,
      `Phase ${phase}: ${with_} buildings with storage against ${without} without`,
    );
  }
});

test('a plan without storageFromSurplus plans storage as a demand, exactly as before (#1061)', () => {
  assert.equal(settings({}).storageFromSurplus, undefined);
  assert.equal(settings({ storageFromSurplus: 'yes' }).storageFromSurplus, undefined);
  assert.equal(settings({ storageFromSurplus: true }).storageFromSurplus, true);
  const before = planOf('construction', false);
  for (const phase of STAGES) {
    const stage = before.stages[phase];
    assert.equal(stage.storageAsked, undefined, `Phase ${phase} records no storageAsked`);
    assert.ok(!(stage.rows || []).some(isStock), `Phase ${phase} has no storage-only lines`);
    // The storage rates are reserved in full, as they always were.
    for (const [item, rate] of Object.entries(stage.storage || {}))
      assert.ok(rate === 0 || rate === 1, `Phase ${phase}: ${item} keeps its ${rate}/min`);
  }
  // Without whole machines the setting changes nothing: the lines are exact anyway.
  const exact = calculate({ storage: 'construction', storageFromSurplus: true });
  const plain = calculate({ storage: 'construction' });
  for (const phase of STAGES)
    assert.deepEqual(
      exact.stages[phase].rows!.map(row => [row.id, row.equivalent]),
      plain.stages[phase].rows!.map(row => [row.id, row.equivalent]),
    );
});

test('Round up production fills storage from surplus; the wizard asks for it too (#1061)', () => {
  const rounded = roundUpSettings({ phase: '3', wholeMachines: false });
  assert.equal(rounded.wholeMachines, true);
  assert.equal(rounded.storageFromSurplus, true);
  const source = fs.readFileSync(
    new URL('../public/app/wizard/wizard.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /settings: \{ \.\.\.settings, storageFromSurplus: true \}/);
});

test('the build plan lists storage-only lines after the storage step, marked optional (#1061)', () => {
  const plan = planOf('construction');
  const steps = phaseSteps(plan, { checks: {} }, data, '3');
  const storage = steps.findIndex(step => step.id === 'calc-3-storage');
  const stock = steps.filter(step => step.row?.stock);
  assert.ok(stock.length > 0);
  for (const step of stock) {
    assert.ok(steps.indexOf(step) > storage, `${step.id} comes after the storage step`);
    assert.match(step.title, / for storage \(optional\)$/);
  }
  assert.ok(
    steps.slice(0, storage).every(step => !step.row?.stock),
    'every other production step comes before it',
  );
  assert.equal(steps[storage]!.title, 'Fill protected storage from surplus, overflow to the sink');
  assert.match(steps[storage]!.body, /Priority Merger or an overflow splitter/);
  assert.match(steps[storage]!.body, /storage-only lines after this step are optional/);
  // The Resources page says where each container's rate comes from.
  const sources = storageSources(plan.stages['1'])!;
  assert.ok(sources.some(entry => entry.source === 'surplus'));
  assert.ok(sources.some(entry => entry.source === 'line'));
});

test('a plan stored before #1061 keeps its storage step, rates and line names (#1061)', () => {
  const stored = JSON.parse(
    fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
  );
  const phase: string = stored.settings.phase;
  const steps = phaseSteps(stored, { checks: {} }, data, phase);
  const storage = steps.find(step => step.id === `calc-${phase}-storage`)!;
  assert.equal(storage.title, 'Connect protected storage and overflow');
  assert.match(storage.body, /^Reserve the listed storage refill rates/);
  for (const step of steps.filter(step => step.row))
    assert.equal(step.title, rowStepTitle(stored, { checks: {} }, step.row!));
  assert.ok(steps.filter(step => step.row).every(step => !/for storage/.test(step.title)));
  // Its rates are listed as they are, without a source.
  assert.equal(storageSources(stored.stages[phase]), null);
});

test('storage-only lines burn fuel for their power: the fuel covers the need (#1061, #1086)', () => {
  let checked = 0;
  for (const storage of ['construction', 'all']) {
    const plan = planOf(storage);
    for (const phase of ['2', '3', '4', '5'] as StageKey[]) {
      const stage = plan.stages[phase];
      const grid = stage.grid!;
      const generatorRows = (stage.rows || []).filter(row => row.power < 0);
      const boost = 1 + (stage.boost || 0);
      const fuelMW =
        generatorRows.reduce((sum, row) => sum - row.power * row.equivalent, 0) * boost;
      const drawMW = Math.max(0, grid.needMW - grid.spareMW - grid.augmenterMW);
      const unitMW = Math.max(0, ...generatorRows.map(row => -row.power)) * boost;
      const where = `${storage}, Phase ${phase}`;
      assert.ok(fuelMW >= drawMW - 0.01, `${where}: ${fuelMW} covers ${drawMW}`);
      assert.ok(fuelMW <= drawMW + unitMW + 0.01, `${where}: ${fuelMW} for ${drawMW}`);
      for (const row of generatorRows)
        assert.equal(row.machines, Math.ceil(row.equivalent - 1e-6), `${where}: ${row.id}`);
      assert.ok(grid.availableMW >= grid.needMW - 0.01, `${where}: the grid has what it needs`);
      checked++;
    }
  }
  assert.equal(checked, 8);
});

test('a rate set for the item itself is topped up beyond its surplus (#1061)', () => {
  // The guided start's default: 20 Concrete/min guaranteed on top of the construction rate.
  const plan = calculate({
    wholeMachines: true,
    storage: 'construction',
    storageOverrides: { Concrete: 20 },
    storageFromSurplus: true,
  });
  for (const phase of STAGES) {
    const stage = plan.stages[phase];
    assert.equal(stage.storageAsked!.Concrete, 20);
    assert.ok(
      Math.abs(stage.storage!.Concrete! - 20) < 1e-6,
      `Phase ${phase}: storage gets its 20 Concrete/min, not ${stage.storage!.Concrete}`,
    );
    const source = storageSources(stage)!.find(entry => entry.item === 'Concrete')!.source;
    assert.ok(['surplus', 'line', 'both'].includes(source), `Phase ${phase}: ${source}`);
  }
});

test('a plan with storage-only lines exports and imports unchanged (#1061)', () => {
  const plan = planOf('construction');
  const exported = structuredClone(saveExport);
  exported.saves[0]!.profiles[0]!.plan = JSON.parse(JSON.stringify(plan));
  const imported = validateTransfer(JSON.parse(JSON.stringify(exported)));
  const back = imported.saves[0]!.profiles[0]!.plan!;
  assert.equal(back.settings.storageFromSurplus, true);
  for (const phase of STAGES) {
    assert.deepEqual(back.stages[phase].storageAsked, plan.stages[phase].storageAsked);
    assert.deepEqual(
      (back.stages[phase].rows || []).filter(row => row.stock).map(row => [row.id, row.stock]),
      (plan.stages[phase].rows || []).filter(isStock).map(row => [row.id, row.stock]),
    );
  }
});

test('with mining per phase, storage-only lines stay within the phase’s budgets and its miner’s power (#1061, #1065)', () => {
  const plan = calculate({
    wholeMachines: true,
    storage: 'all',
    collectables: true,
    storageFromSurplus: true,
    phaseMining: true,
    goal: 'maximum',
    limitsConfirmed: true,
  });
  let stocked = 0;
  for (const phase of STAGES) {
    const stage = plan.stages[phase];
    if (!stage.feasible || !stage.mining) continue;
    stocked += (stage.rows || []).filter(isStock).length;
    for (const [item, rate] of Object.entries(stage.raw || {}))
      assert.ok(
        rate <= (stage.mining.budgets[item] ?? 0) + 0.01,
        `Phase ${phase}: ${item} draws ${rate}/min of a ${stage.mining.budgets[item]}/min budget`,
      );
    assert.deepEqual(stage.grid?.extractionAt, { ...stage.mining.miner }, `Phase ${phase} miner`);
  }
  assert.ok(stocked > 0, 'the plan has storage-only lines');
});

// #1100: the exact steps of a whole-machine plan (the two-step fit's exact LP and the draft's
// diagnostics) solve a copy of the settings without whole machines, so they put the full storage
// rates back in, and a phase whose budgets could not hold them failed entirely.
const tightLimestone = (extra: object) =>
  calculate({
    wholeMachines: true,
    storage: 'construction',
    storageOverrides: { Concrete: 20 }, // the guided start's default
    limitsConfirmed: true,
    ...extra,
  });
// Phase 1 under a Limestone budget of 40/min: it fits, and storage gets what the budget leaves.
function fitsWithLimestone(extra: object) {
  const stage = tightLimestone({ storageFromSurplus: true, ...extra }).stages['1'];
  const budget = stage.mining?.budgets.Limestone ?? 40;
  assert.equal(budget, 40);
  assert.equal(stage.feasible, true, stage.reason);
  // 40 Limestone/min makes 13.3 Concrete/min of the 20 asked.
  assert.equal(stage.storageAsked?.Concrete, 20);
  assert.ok(stage.storage!.Concrete! > 13 && stage.storage!.Concrete! < 20);
  assert.ok((stage.raw!.Limestone ?? 0) <= budget + 0.01, `Limestone ${stage.raw!.Limestone}`);
}
test('a phase fits when its budgets cannot hold the full storage rates (#1100)', () => {
  fitsWithLimestone({ limits: { ...settings({}).limits, Limestone: 40 } });
});
test('with mining per phase, a phase fits when its budgets cannot hold storage (#1100, #1065)', () => {
  // Phase 1 gets a tenth of the survey's 400 Limestone/min.
  fitsWithLimestone({ limits: { ...settings({}).limits, Limestone: 400 }, phaseMining: true });
});

test('a draft under storageFromSurplus does not name protected storage (#1100)', () => {
  const limits = { ...settings({}).limits, 'Iron Ore': 0 };
  const fed = tightLimestone({ storageFromSurplus: true, limits }).stages['1'];
  assert.equal(fed.feasible, false);
  assert.match(fed.reason!, /More time alone will not fit/);
  assert.doesNotMatch(fed.reason!, /protected storage/);
  // The draft's diagnostic leaves storage out, as the solve does (its fixes: tests/ui/draft-fixes).
  assert.equal(fed.raw!.Limestone ?? 0, 0);
  assert.deepEqual(fed.storage, {});
  assert.match(tightLimestone({ limits }).stages['1'].reason!, /protected storage/);
});

test('without storageFromSurplus, the exact steps plan storage as a demand, as before (#1100)', () => {
  // Plans stored before #1061 have no storageFromSurplus, so this is how they recalculate.
  const stage = tightLimestone({ limits: { ...settings({}).limits, Limestone: 40 } }).stages['1'];
  assert.equal(stage.feasible, false);
  assert.deepEqual(stage.shortfalls, [{ name: 'Limestone', needed: 60, budget: 40 }]);
  assert.match(stage.reason!, /continuous demands \(protected storage, drone fuel/);
  assert.equal(stage.storage!.Concrete, 20);
  // The rounding cost's exact plan (#1066) is the plan with exact clocks, storage included, with
  // and without the setting: what the plan's pages set beside the whole-machine figures, whose
  // storage is filled too.
  for (const fromSurplus of [false, true]) {
    const exact = calculate({ storage: 'construction', storageFromSurplus: fromSurplus });
    const whole = planOf('construction', fromSurplus);
    for (const phase of ['1', '2'] as StageKey[])
      assert.deepEqual(
        whole.stages[phase].exactPlan?.raw,
        Object.fromEntries(
          Object.entries(exact.stages[phase].raw!).filter(([, rate]) => rate > 0.001),
        ),
        `Phase ${phase}, storageFromSurplus ${fromSurplus}`,
      );
  }
});
