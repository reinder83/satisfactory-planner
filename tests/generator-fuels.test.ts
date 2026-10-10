// The generator fuels of the game (#1055): Coal Generators also burn Compacted Coal (630 MJ) and
// Petroleum Coke (180 MJ), and Fuel Generators burn Ionized Fuel (5,000 MJ/m³) in Phase 5
// (generators() in planner/recipes.ts). A plan on coal power that makes Petroleum Coke to use up
// the Heavy Oil Residue of its Plastic and Rubber lines burns it instead of sinking it while it
// mines coal for its generators (#1063, direction 1). A plan stored before keeps its lines, its
// sink and its ticks until the user recalculates, in both editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, DATA, settings } from '../planner.ts';
import { generators } from '../planner/recipes.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { phaseSteps } from '../public/progression.ts';
import { sinkCause } from '../public/app/sink-cause.ts';
import { initialState, validateState } from '../public/state.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  CalcRow,
  ContextReply,
  Progression,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fluid = (item: string) => !!DATA.items[item]?.fluid;
const progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
) as Progression;

// The generator lines a phase may build under a main power choice, by row id: [machine, fuel,
// fuel per generator per minute, water per minute].
const offered = (mainPower: string, phase: number) =>
  Object.fromEntries(
    generators(settings({ mainPower, nuclear: 'none' }), phase).map(recipe => {
      const fuel = Object.keys(recipe.inputs).find(item => item !== 'Water')!;
      return [
        recipe.id,
        [recipe.machine, fuel, +recipe.inputs[fuel]!.toFixed(6), recipe.inputs.Water ?? 0],
      ];
    }),
  );
const generatorRows = (stage: StoredStage) =>
  (stage.rows || []).filter(row => (row.generationMW || 0) > 0);
const rowOf = (stage: StoredStage, id: string) => (stage.rows || []).find(row => row.id === id);

test('Coal Generators burn Coal, Compacted Coal and Petroleum Coke; Fuel Generators Ionized Fuel in Phase 5', () => {
  // The energy the game gives each fuel, as recipes.json holds it.
  assert.deepEqual(
    ['Coal', 'Compacted Coal', 'Petroleum Coke', 'Ionized Fuel'].map(
      item => DATA.items[item]!.energy,
    ),
    [300, 630, 180, 5000],
  );
  // 75 MW is 4,500 MJ per minute, 250 MW 15,000 MJ; every Coal Generator takes 45 m³ of water.
  const coal = {
    'power-coal': ['Coal Generator', 'Coal', 15, 45],
    'power-compacted-coal': ['Coal Generator', 'Compacted Coal', 7.142857, 45],
  };
  const coke = { 'power-petroleum-coke': ['Coal Generator', 'Petroleum Coke', 25, 45] };
  const fuel = {
    'power-fuel': ['Fuel Generator', 'Fuel', 20, 0],
    'power-turbofuel': ['Fuel Generator', 'Turbofuel', 7.5, 0],
  };
  const rocket = { 'power-rocket-fuel': ['Fuel Generator', 'Rocket Fuel', 4.166667, 0] };
  const ionized = { 'power-ionized-fuel': ['Fuel Generator', 'Ionized Fuel', 3, 0] };
  // By phase: Coal Generators from Phase 2, Petroleum Coke with oil from Phase 3, Rocket Fuel
  // from 4 and Ionized Fuel in Phase 5. Phase 1 plans none.
  assert.deepEqual(offered('auto', 1), {});
  assert.deepEqual(offered('auto', 2), coal);
  assert.deepEqual(offered('auto', 3), { ...coal, ...fuel, ...coke });
  assert.deepEqual(offered('auto', 4), { ...coal, ...fuel, ...rocket, ...coke });
  assert.deepEqual(offered('auto', 5), { ...coal, ...fuel, ...rocket, ...coke, ...ionized });
  // Each line's row id is its fuel's, as before: the existing ids and their order are unchanged.
  assert.deepEqual(Object.keys(offered('auto', 5)).slice(0, 4), [
    'power-coal',
    'power-fuel',
    'power-turbofuel',
    'power-rocket-fuel',
  ]);
  // The main power choice: coal keeps every Coal Generator fuel, 'fuel' Fuel and Ionized Fuel.
  assert.deepEqual(offered('coal', 3), { ...coal, ...coke });
  assert.deepEqual(offered('coal', 5), { ...coal, ...coke });
  assert.deepEqual(offered('fuel', 4), { 'power-fuel': fuel['power-fuel'] });
  assert.deepEqual(offered('fuel', 5), { 'power-fuel': fuel['power-fuel'], ...ionized });
  // The others keep their one fuel.
  assert.deepEqual(offered('turbofuel', 5), { 'power-turbofuel': fuel['power-turbofuel'] });
  assert.deepEqual(offered('rocket', 5), rocket);
  // The building's phase, as Rocket Fuel's line has the Fuel Generator's.
  for (const recipe of generators(settings({}), 5))
    assert.equal(recipe.phase, recipe.machine === 'Coal Generator' ? 2 : 3, recipe.id);
});

// The plan of #1063: a whole-machine Phase 3 on coal power, recorded on main (f292a25d) before
// #1055. It makes 480 Petroleum Coke/min only to use up the Heavy Oil Residue of its Plastic and
// Rubber lines and sinks all of it, while 57 Coal Generators burn 842 Coal/min of the 1,427 it mines.
const stored: StoredCalculatedPlan = JSON.parse(
  fs.readFileSync(new URL('./fixtures/coal-power-plan-2026-10-10.json', import.meta.url), 'utf8'),
);
const ISSUE_SETTINGS = {
  phase: '3',
  wholeMachines: true,
  mainPower: 'coal',
  limitsConfirmed: true,
};

test("the issue's plan burns its Petroleum Coke in Coal Generators and mines less coal", () => {
  const before = stored.stages['3'];
  assert.equal(before.surplus!['Petroleum Coke'], 480);
  assert.deepEqual(
    generatorRows(before).map(row => [row.id, row.machines]),
    [['power-coal', 57]],
  );
  const plan = calculate(ISSUE_SETTINGS);
  const stage = plan.stages['3'];
  const made = rowOf(stage, 'Recipe_PetroleumCoke_C')!.outputs['Petroleum Coke']!;
  assert.equal(made, 480, 'the same Petroleum Coke line');
  const coke = rowOf(stage, 'power-petroleum-coke')!;
  assert.equal(coke.machine, 'Coal Generator');
  assert.equal(coke.name, 'Petroleum Coke power');
  assert.ok(Math.abs(coke.inputs['Petroleum Coke']! - made) < 1e-6, 'burns all of it');
  assert.equal(coke.inputs.Water, (made / 25) * 45);
  assert.equal(coke.generationMW, (made / 25) * 75);
  assert.equal(stage.surplus?.['Petroleum Coke'] ?? 0, 0, 'none to the sink');
  // Every Coal Generator's 75 MW stays: the coke takes the place of mined coal.
  const coal = rowOf(stage, 'power-coal')!;
  assert.ok(coal.machines < 57, `${coal.machines} Coal Generators on coal`);
  assert.ok(stage.raw!.Coal! < before.raw!.Coal! - 250, `${stage.raw!.Coal} Coal/min mined`);
  assert.ok(stage.grid!.generationMW >= stage.grid!.needMW - stage.grid!.spareMW);
  // The build plan's power step names the coke line and what it needs.
  const step = phaseSteps(plan, { checks: {}, settings: { phase: '3' } }, progression, '3').find(
    task => task.id === 'preferred-power-3',
  )!;
  assert.equal(step.title, 'Build coal power before the next production block');
  assert.match(
    step.body!,
    / × Petroleum Coke power \(Coal Generator\), new in this phase, burning 480 Petroleum Coke\/min from the Petroleum Coke step/,
  );
  assert.ok(
    step.body!.includes(
      ' Coal power needs Coal Power unlocked, coal extraction, Oil Processing for the Petroleum Coke and water.',
    ),
    step.body,
  );
  // The later phases burn theirs too.
  for (const phase of ['4', '5'] as const) {
    const later = plan.stages[phase];
    const cokeMade = (later.rows || []).reduce(
      (sum, row) => sum + (row.outputs['Petroleum Coke'] || 0),
      0,
    );
    assert.ok(cokeMade > 0, `Phase ${phase} makes Petroleum Coke`);
    assert.equal(later.surplus?.['Petroleum Coke'] ?? 0, 0, `Phase ${phase} sinks none`);
  }
});

test('Ionized Fuel is burnt in Fuel Generators in Phase 5 under the fuel choice', () => {
  // Ionized Fuel the player already makes is the cheapest fuel there is: 10 generators burn the
  // 30 m³/min at 3 m³ each, at exact clocks, never rounded up.
  const plan = calculate({ phase: '4', mainPower: 'fuel', existingSupply: { 'Ionized Fuel': 30 } });
  const ionized = rowOf(plan.stages['5'], 'power-ionized-fuel')!;
  assert.equal(ionized.machine, 'Fuel Generator');
  assert.equal(ionized.name, 'Ionized Fuel power');
  assert.ok(Math.abs(ionized.inputs['Ionized Fuel']! - 30) < 1e-6);
  assert.ok(Math.abs(ionized.equivalent - 10) < 1e-6);
  assert.equal(plan.stages['5'].supplied?.['Ionized Fuel'], 30);
  // Not before Phase 5, whatever the supply.
  assert.equal(rowOf(plan.stages['4'], 'power-ionized-fuel'), undefined);
  // The fluid is never rounded up: 31 m³/min need 11 whole generators, which burn the 31 only.
  const odd = calculate({ phase: '5', mainPower: 'fuel', existingSupply: { 'Ionized Fuel': 31 } });
  const line = rowOf(odd.stages['5'], 'power-ionized-fuel')!;
  assert.ok(Math.abs(line.inputs['Ionized Fuel']! - 31) < 1e-6, `${line.inputs['Ionized Fuel']}`);
  assert.equal(line.machines, 11);
  // Its step names the fuel and its research.
  const fuelStep = phaseSteps(odd, { checks: {}, settings: { phase: '5' } }, progression, '5').find(
    step => step.id === 'startup-fuel-5',
  )!;
  for (const text of [
    "This phase's Fuel Generators burn Fuel and Ionized Fuel.",
    ' Ionized fuel needs its own Sulfur MAM node, a Rocket Fuel supply and Power Shards.',
  ])
    assert.ok(fuelStep.body!.includes(text), fuelStep.body);
  const power = phaseSteps(odd, { checks: {}, settings: { phase: '5' } }, progression, '5').find(
    step => step.id === 'preferred-power-5',
  )!;
  assert.equal(power.title, 'Build fuel and ionized fuel power before the next production block');
  for (const text of [
    ' × Ionized Fuel power (Fuel Generator), new in this phase, burning 31 Ionized Fuel/min',
    ' Ionized fuel power needs Petroleum Power, its own Sulfur MAM node, a running Rocket Fuel chain and Power Shards.',
  ])
    assert.ok(power.body!.includes(text), power.body);
});

test('Compacted Coal is burnt in Coal Generators from Phase 2', () => {
  const plan = calculate({ phase: '2', existingSupply: { 'Compacted Coal': 70 } });
  const line = rowOf(plan.stages['2'], 'power-compacted-coal')!;
  assert.equal(line.machine, 'Coal Generator');
  assert.equal(line.name, 'Compacted Coal power');
  const burnt = line.inputs['Compacted Coal']!;
  assert.ok(burnt > 0 && burnt <= 70 + 1e-6, `${burnt}`);
  assert.ok(Math.abs(line.generationMW - (burnt * 630) / 60) < 1e-6, 'its 630 MJ each');
});

// The stored plan with the ticks a player made on it: the coal generators and the coke line.
const TICKS = ['calc-3-power-coal', 'calc-3-Recipe_PetroleumCoke_C', 'calc-3-Recipe_Plastic_C'];
const storedState = () => ({
  ...initialState(),
  settings: { phase: '3' as const },
  checks: Object.fromEntries(TICKS.map(key => [key, true])),
});
const stepIds = (plan: StoredCalculatedPlan) =>
  new Set(
    phaseSteps(plan, { checks: {}, settings: { phase: '3' } }, progression, '3').map(
      step => step.id,
    ),
  );
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-10T12:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Coal', kind: 'calculated', plan, state: storedState() }],
    },
  ],
});

// What both editions show for the stored profile before and after a recalculation in place.
function assertStored(context: ContextReply) {
  assert.equal(JSON.stringify(context.plan), JSON.stringify(stored), 'the stored plan, unchanged');
  for (const key of TICKS) assert.equal(context.state.checks[key], true, key);
  const steps = stepIds(context.plan!);
  for (const key of TICKS) assert.ok(steps.has(key), key + ' is still a step');
  // Its sink keeps its caption (#1063), since its plan still sinks the coke.
  const stage = context.plan!.stages['3'];
  const line = rowOf(stage, 'Recipe_PetroleumCoke_C') as CalcRow;
  assert.deepEqual(sinkCause(line, 'Petroleum Coke', 480, stage, true, fluid), {
    kind: 'uses-up',
    item: 'Heavy Oil Residue',
  });
}
function assertRecalculated(context: ContextReply) {
  const stage = context.plan!.stages['3'];
  assert.ok(rowOf(stage, 'power-petroleum-coke'), 'the recalculation burns the coke');
  assert.equal(stage.surplus?.['Petroleum Coke'] ?? 0, 0);
  // Fewer coal generators and the same coke line: their ticks stay; the new line starts unticked.
  for (const key of TICKS) assert.equal(context.state.checks[key], true, key + ' stays ticked');
  assert.equal(context.state.checks['calc-3-power-petroleum-coke'], undefined);
  assert.ok(stepIds(context.plan!).has('calc-3-power-petroleum-coke'));
}
const recalculation = (createdAt: string | undefined) => ({
  name: 'Coal',
  backupName: 'Coal (before edit)',
  settings: stored.settings,
  planCreatedAt: createdAt,
});

test('a plan stored before #1055 loads unchanged and burns its coke only when the user recalculates: Docker server', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-1055-'));
  const workspace = await loadWorkspace(dir, validateState);
  workspace.saves.push({ ...exported(stored).saves[0]!, userId: 'owner' });
  await fsp.writeFile(path.join(dir, 'workspace.json'), JSON.stringify(workspace));
  const loaded = await loadWorkspace(dir, validateState);
  assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(stored));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const headers = { 'X-Save-Id': 's1', 'X-Profile-Id': 'p1' };
  const context = async () =>
    (await (await fetch(url + '/api/context', { headers })).json()) as ContextReply;
  try {
    assertStored(await context());
    // Reading it again changes nothing either.
    assertStored(await context());
    const response = await fetch(url + '/api/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(recalculation(stored.createdAt)),
    });
    assert.ok(response.ok, await response.clone().text());
    assertRecalculated(await context());
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a plan stored before #1055 loads unchanged and burns its coke only when the user recalculates: browser edition', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
      undefined,
      undefined,
      progression,
    );
  let api = open();
  await api('/api/import-saves', { body: JSON.stringify(exported(stored)) });
  // The import is the only save, so it is the active one; its ids are the import's own.
  const active = (await api('/api/context')) as ContextReply;
  const headers = { 'X-Save-Id': active.save.id, 'X-Profile-Id': active.profile.id };
  const context = async () => (await api('/api/context', { headers })) as ContextReply;
  assertStored(await context());
  // Across a reload too.
  api = open();
  assertStored(await context());
  await api('/api/recalculate', {
    headers,
    body: JSON.stringify(recalculation(stored.createdAt)),
  });
  assertRecalculated(await context());
});
