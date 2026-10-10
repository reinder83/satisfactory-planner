// "Generators you already have" (#1068): settings.ownedGenerators ({ building: count }) counts the
// generators a player already runs as generators of the plan's own generator lines in that
// building, from the start phase on, the way a phase keeps the generators the phase before built
// (carryGenerators in public/power.ts). Their fuel stays in the budgets: generators burn fuel only
// for the power drawn, so the solve, its rows and its raw draw are the plan's own. They are not
// spare power (availablePowerGW), whose fuel is already off the budgets. Biomass Burners only
// shorten the build plan's burner bank. It belongs to the plan snapshot, like ownedMiner: a plan
// without it, every plan stored before it, calculates, loads, imports and exports exactly as
// before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, settings } from '../planner.ts';
import { carryGenerators, powerView } from '../public/power.ts';
import { ownedGeneratorCounts } from '../public/preferences.ts';
import { phaseSteps } from '../public/progression.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  CurrentCalculatedPlan,
  Phase,
  Progression,
  SaveExport,
  StageGrid,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const progression: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const step = (plan: CurrentCalculatedPlan | StoredCalculatedPlan, phase: Phase, id: string) =>
  phaseSteps(plan, initialState(), progression, phase).find(entry => entry.id === id)!.body;

test('settings keep the known generator kinds with whole counts, and leave the field out otherwise', () => {
  assert.deepEqual(
    settings({
      phase: '3',
      ownedGenerators: { 'Fuel Generator': 3, 'Coal Generator': 8, 'Biomass Burner': 12 },
    }).ownedGenerators,
    // In the order the kinds come, whatever order they were entered in.
    { 'Biomass Burner': 12, 'Coal Generator': 8, 'Fuel Generator': 3 },
  );
  assert.deepEqual(
    settings({
      ownedGenerators: {
        'Coal Generator': 8,
        'Geothermal Generator': 4,
        'Fuel Generator': 0,
        'Nuclear Power Plant': -1,
        'Biomass Burner': 2.5,
      },
    }).ownedGenerators,
    { 'Coal Generator': 8 },
    'only known kinds with a whole count of at least 1',
  );
  assert.deepEqual(settings({ ownedGenerators: { 'Coal Generator': 10000 } }).ownedGenerators, {
    'Coal Generator': 10000,
  });
  for (const wrong of [
    undefined,
    null,
    {},
    [],
    [8],
    'Coal Generator',
    8,
    { 'Coal Generator': '8' },
    { 'Coal Generator': 10001 },
    { 'Coal Generator': Number.NaN },
    { 'Coal Generator': Infinity },
    { 'Coal Generator': 0 },
  ])
    assert.equal(
      'ownedGenerators' in settings({ ownedGenerators: wrong }),
      false,
      JSON.stringify(wrong),
    );
  assert.equal('ownedGenerators' in settings({}), false, 'absent unless entered');
  assert.equal(ownedGeneratorCounts({ 'Coal Generator': 0 }), null);
});

// The default Phase 2 plan builds 6 Coal Generators (450 MW) for its 371.5 MW.
test('Phase 2: 4 Coal Generators you already have are 4 of its 6, and 8 are all it runs', () => {
  const plain = calculate({ phase: '2' }),
    four = calculate({ phase: '2', ownedGenerators: { 'Coal Generator': 4 } }),
    eight = calculate({ phase: '2', ownedGenerators: { 'Coal Generator': 8 } });
  const coal = (plan: CurrentCalculatedPlan) =>
    plan.stages['2'].grid!.generators.find(entry => entry.machine === 'Coal Generator')!;
  assert.deepEqual(json(coal(plain)), {
    machine: 'Coal Generator',
    machines: 6,
    own: 6,
    kept: 0,
    unitMW: 75,
  });
  assert.deepEqual(json(coal(four)), { ...json(coal(plain)), owned: 4 });
  assert.deepEqual(json(coal(eight)), { ...json(coal(plain)), machines: 8, owned: 8 });
  // The 8 run as the phase's generators: 600 MW where its own lines give 450, against the same
  // need, so 150 MW more headroom.
  const view = (plan: CurrentCalculatedPlan) => powerView(plan.stages['2'], plan.settings);
  assert.equal(view(plain).generationMW, 450);
  assert.equal(view(four).generationMW, 450);
  assert.equal(view(eight).generationMW, 600);
  assert.equal(view(eight).needMW, view(plain).needMW);
  assert.equal(view(eight).leftMW - view(plain).leftMW, 150);
  // Their fuel stays in the budgets: the same lines, coal and water as the plan without them,
  // and the spare power is the entered one.
  for (const plan of [four, eight]) {
    for (const phase of ['1', '2', '3', '4', '5'] as const) {
      assert.deepEqual(json(plan.stages[phase].rows), json(plain.stages[phase].rows), phase);
      assert.deepEqual(json(plan.stages[phase].raw), json(plain.stages[phase].raw), phase);
    }
    assert.equal(view(plan).spareMW, 0);
    assert.deepEqual(plan.warnings, plain.warnings);
  }
  // Phase 3 builds no Coal Generators: nothing to count there, and the phase is as before.
  assert.deepEqual(json(eight.stages['3'].grid), json(plain.stages['3'].grid));
  // The Resources page's bar names them.
  assert.equal(
    view(eight).supply.find(part => part.key === 'generation')!.caption,
    '8 Coal Generators, whole, at 100% · 8 Coal Generators you already have',
  );
  assert.equal(
    view(plain).supply.find(part => part.key === 'generation')!.caption,
    '6 Coal Generators, whole, at 100%',
  );
});

test('the power advice counts them, and says where a phase does not', () => {
  const four = calculate({
      phase: '2',
      ownedGenerators: { 'Coal Generator': 4, 'Biomass Burner': 5 },
    }),
    eight = calculate({ phase: '2', ownedGenerators: { 'Coal Generator': 8 } }),
    plain = calculate({ phase: '2' });
  assert.match(
    step(four, '2', 'startup-2-power-review'),
    / You already have 4 of the 6 Coal Generators this phase's lines need, so build 2 more\.$/,
  );
  assert.match(
    step(eight, '2', 'startup-2-power-review'),
    / You already have 8 Coal Generators, enough for the 6 this phase's lines need, so build none\.$/,
  );
  assert.doesNotMatch(step(plain, '2', 'startup-2-power-review'), /already have/);
  // Phase 3 burns no coal: the owned Coal Generators are not counted, and it says how to keep them.
  assert.match(
    step(eight, '3', 'startup-3-power-review'),
    / This phase builds no Coal Generators, so the 8 you already have are not counted: to keep them running, leave their fuel out of the budgets and enter their 600 MW as Spare existing power in Edit settings\.$/,
  );
  // The biomass burner bank counts the burners: 13 for Phase 2's 371.5 MW.
  assert.match(
    step(four, '2', 'startup-burner-bank-2'),
    /allow about 13 standalone burners .* Constructors\. You already have 5 of them: build 8 more\. At full load/,
  );
  assert.doesNotMatch(step(plain, '2', 'startup-burner-bank-2'), /already have/);
  // With spare power, the generation sentence names them and why power is left over.
  const spare = calculate({
    phase: '2',
    availablePowerGW: 0.1,
    installedPowerGW: 0.1,
    ownedGenerators: { 'Coal Generator': 8 },
  });
  assert.match(
    step(spare, '2', 'startup-2-power-review'),
    /4 × Coal power \(Coal Generator\) \(keep all 8 Coal Generators you already have\), which provides 600 MW, .* spare from keeping the 8 Coal Generators you already have\./,
  );
});

test('carryGenerators: owned generators count from the start phase on, where a phase fuels them', () => {
  const grid = (machines: number, machine = 'Coal Generator'): StageGrid =>
    ({
      generators: [{ machine, machines, own: machines, kept: 0, unitMW: 75 }],
      augmenterMW: 0,
      spareMW: 0,
    }) as StageGrid;
  const stages = {
    2: { feasible: true, grid: grid(1) },
    3: { feasible: true, grid: grid(5) },
    4: { feasible: true, grid: grid(2, 'Fuel Generator') },
    5: { feasible: true, grid: grid(1) },
  };
  carryGenerators(stages, 3, { 'Coal Generator': 4 });
  assert.deepEqual(stages[2].grid.generators[0], grid(1).generators[0], 'before the start phase');
  assert.deepEqual(stages[3].grid.generators[0], {
    ...grid(5).generators[0],
    owned: 4,
  });
  assert.equal(stages[4].grid.generators[0]!.owned, undefined, 'a phase without coal');
  assert.deepEqual(stages[5].grid.generators[0], {
    ...grid(1).generators[0],
    machines: 4,
    owned: 4,
  });
  assert.equal(stages[5].grid.generationMW, 300);
  // Without any, exactly as before.
  const before = json({
    3: { feasible: true, grid: grid(5) },
    4: { feasible: true, grid: grid(2) },
  });
  const same = json(before);
  carryGenerators(same, 3);
  const empty = json(before);
  carryGenerators(empty, 3, {});
  assert.deepEqual(empty, same);
  assert.equal(same[3].grid.generationMW, undefined, 'the start phase is left alone');
});

test('a plan without generators you already have is the plan it was', () => {
  const plain = calculate({ phase: '3' });
  for (const absent of [undefined, {}, { 'Coal Generator': 0 }, { Geothermal: 3 }]) {
    const again = calculate({ phase: '3', ownedGenerators: absent });
    assert.equal('ownedGenerators' in again.settings, false);
    assert.deepEqual(json(again.stages), json(plain.stages));
    assert.deepEqual(again.warnings, plain.warnings);
  }
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-10T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const fixture = (name: string): StoredCalculatedPlan => {
  const file = JSON.parse(
    fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'),
  ) as { plan?: StoredCalculatedPlan } & StoredCalculatedPlan;
  return file.plan ?? file;
};
const before = fixture('plan-before-1065.json');
const withGenerators = (): StoredCalculatedPlan =>
  json(calculate({ phase: '2', ownedGenerators: { 'Coal Generator': 8, 'Biomass Burner': 4 } }));

test('migration: stored plans recalculate unchanged and read their power as before', () => {
  // A stored plan recalculated with its own settings is the plan it was.
  assert.deepEqual(json(calculate(before.settings).stages), json(before.stages));
  // Its power figures, step texts and the bar read as before: nothing owned anywhere.
  for (const phase of ['3', '4', '5'] as const) {
    assert.doesNotMatch(step(before, phase, `startup-${phase}-power-review`), /already have/);
    assert.ok(
      (before.stages[phase].grid?.generators || []).every(entry => !('owned' in entry)),
      phase,
    );
  }
  // The first release's plan has no grid at all, and reads as before too.
  const first = fixture('calculated-plan-2026-09-12.json');
  assert.equal(first.settings.ownedGenerators, undefined);
  assert.doesNotMatch(step(first, '3', 'startup-3-power-review'), /already have/);
});

test('migration: plans with and without generators load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, withGenerators()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    assert.equal('ownedGenerators' in settings(plan.settings), 'ownedGenerators' in plan.settings);
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-owned-generators-'));
    try {
      const workspace = await loadWorkspace(dataDir, validateState);
      workspace.saves.push({
        id: 's1',
        name: 'World',
        userId: 'owner',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
      });
      await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
      const loaded = await loadWorkspace(dataDir, validateState);
      assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(plan));
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
});

// The browser edition over a fake IndexedDB that keeps `records` between opens.
const browserApi = (records: Map<string, unknown>) =>
  createBrowserApi(
    openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
      throw Error('not needed');
    }),
    calculate,
    catalog(),
  );

test('migration: the browser edition keeps both plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const plans = [before, withGenerators()];
  let api = browserApi(records);
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = browserApi(records);
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

test('the browser edition creates a plan with the generators from the wizard’s settings', async () => {
  const records = new Map<string, unknown>();
  const created = (await browserApi(records)('/api/profiles', {
    body: JSON.stringify({
      saveId: null,
      saveName: 'World',
      name: 'New',
      settings: { phase: '2', ownedGenerators: { 'Coal Generator': 8, Geothermal: 2 } },
    }),
  })) as { saveId: string; profileId: string };
  // Read back after a reload.
  const file = (await browserApi(records)('/api/export-saves')) as SaveExport;
  const plan = file.saves.find(save => save.id === created.saveId)!.profiles[0]!.plan!;
  assert.deepEqual(plan.settings.ownedGenerators, { 'Coal Generator': 8 });
  assert.equal(
    plan.stages['2'].grid!.generators.find(entry => entry.machine === 'Coal Generator')!.machines,
    8,
  );
});
