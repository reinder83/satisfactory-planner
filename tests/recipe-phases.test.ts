// The phase a recipe is available from (#1057). recipes.json comes from the SatisfactoryTools
// revision it records (THIRD_PARTY.md, no import script in the repository), and the phases it
// carried for alternates followed only their inputs: Iron Pipe (Iron Ingot) and Automated Miner
// were Phase 1 though their hard drives need Basic Steel Production (Tier 3), Coated Iron and
// Steel Canister Phase 1 and 2 though theirs need Fluid Packaging (Tier 5), and the four Diamond
// alternates Phase 4 though theirs need Matter Conversion (Tier 9). So a recipe's phase is at
// least the latest of
// - its inputs' first phase (`availability`),
// - the phase its machine's unlock is available in (`buildings` in public/progression.json),
// - the phase its own unlock is available in: a HUB milestone its tier's phase (phaseForTier),
//   a MAM node the latest phase of its cost items (milestonePhase in public/progression.ts),
//   a hard drive (or any unlock) also no earlier than every unlock it requires,
// and an item's `availability` is the first phase any recipe making it is available in. A data
// update applies the same mapping, which this file checks over every recipe; the phases of the
// recipes below are the ones the mapping raised. A stored plan keeps its lines and steps until the
// user recalculates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, recipePool, settings } from '../planner.ts';
import { RAW } from '../planner/data.ts';
import {
  alternateHunts,
  milestonePhase,
  ownedAlternateKeys,
  phaseSteps,
} from '../public/progression.ts';
import { validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { recipes } from './helpers/data.ts';
import type { AlternateHunt } from '../public/progression.ts';
import type {
  Progression,
  ProgressionEntry,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const readJson = (fromRepo: string): unknown =>
  JSON.parse(fs.readFileSync(new URL('../' + fromRepo, import.meta.url), 'utf8'));
const data = readJson('public/progression.json') as Progression;
const recipeData = readJson('recipes.json') as { availability: Record<string, number> };
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const IRON_PIPE = 'Recipe_Alternate_SteelPipe_Iron_C';
const AUTOMATED_MINER = 'Recipe_Alternate_AutomatedMiner_C';
const COATED_CANISTER = 'Recipe_Alternate_CoatedIronCanister_C';
const STEEL_CANISTER = 'Recipe_Alternate_SteelCanister_C';
// The phases the mapping gave the recipes whose phase it raised.
const RAISED: Record<string, [name: string, before: number, phase: number]> = {
  [IRON_PIPE]: ['Alternate: Iron Pipe', 1, 2],
  [AUTOMATED_MINER]: ['Alternate: Automated Miner', 1, 2],
  [COATED_CANISTER]: ['Alternate: Coated Iron Canister', 1, 3],
  [STEEL_CANISTER]: ['Alternate: Steel Canister', 2, 3],
  Recipe_Alternate_Diamond_Turbo_C: ['Alternate: Turbo Diamonds', 4, 5],
  Recipe_Alternate_Diamond_Petroleum_C: ['Alternate: Petroleum Diamonds', 4, 5],
  Recipe_Alternate_Diamond_OilBased_C: ['Alternate: Oil-Based Diamonds', 4, 5],
  Recipe_Alternate_Diamond_Cloudy_C: ['Alternate: Cloudy Diamonds', 4, 5],
};

const byId = new Map(data.entries.map(entry => [entry.id, entry]));
// The phase an unlock is available in: its own (a hard drive has none of its own) and no earlier
// than every unlock it requires.
function unlockPhase(entry: ProgressionEntry, seen = new Set<string>()): number {
  if (seen.has(entry.id)) return 1;
  seen.add(entry.id);
  const own = entry.alternate ? 1 : milestonePhase(entry, data);
  const required = (entry.requires ?? []).flatMap(id => {
    const needed = byId.get(id);
    return needed ? [unlockPhase(needed, seen)] : [];
  });
  return Math.max(own, ...required);
}
// The first phase any unlock of `recipeId` is available in; 1 for a recipe nothing unlocks (the
// HUB's own: Iron Plate, the Constructor, the Smelter).
const recipeUnlockPhase = (recipeId: string): number => {
  const unlocks = data.entries.filter(entry => entry.recipes.includes(recipeId));
  return unlocks.length ? Math.min(...unlocks.map(entry => unlockPhase(entry))) : 1;
};
// What the mapping asks of each recipe's phase, with the reason.
const floors = (recipe: (typeof recipes)[number]) => {
  const building = data.buildings[recipe.machine];
  return {
    inputs: Math.max(1, ...Object.keys(recipe.inputs).map(i => data.availability[i] ?? 1)),
    machine: building ? recipeUnlockPhase(building) : 1,
    unlock: recipeUnlockPhase(recipe.id),
  };
};

test('#1057: every recipe is available no earlier than its inputs, machine and unlock', () => {
  const early = recipes.flatMap(recipe => {
    const floor = floors(recipe);
    const lowest = Math.max(floor.inputs, floor.machine, floor.unlock);
    return recipe.phase! < lowest
      ? [`${recipe.name}: Phase ${recipe.phase}, needs ${lowest} (${JSON.stringify(floor)})`]
      : [];
  });
  assert.deepEqual(early, []);
  // The check has teeth: each recipe the mapping raised sits exactly at its unlock's phase.
  for (const [id, [, , phase]] of Object.entries(RAISED)) {
    const recipe = recipes.find(candidate => candidate.id === id)!;
    const floor = floors(recipe);
    assert.equal(Math.max(floor.inputs, floor.machine, floor.unlock), phase, recipe.name);
    assert.equal(floor.unlock, phase, `${recipe.name}: its unlock`);
  }
});

test('#1057: Iron Pipe and Automated Miner are Phase 2, the canisters 3, the Diamonds 5', () => {
  for (const [id, [name, , phase]] of Object.entries(RAISED)) {
    const recipe = recipes.find(candidate => candidate.id === id);
    assert.deepEqual([recipe?.name, recipe?.phase], [name, phase], id);
    // The wizard's alternate pickers read the catalog's phase.
    assert.equal(catalog().alternates.find(entry => entry.id === id)?.phase, phase, name);
    // The planner's pool has it from that phase on, not before, also when it is owned.
    for (const config of [{ recipes: 'all' }, { ownedAlternates: [id] }]) {
      const pool = (stage: number) =>
        recipePool(settings(config), stage, false).some(candidate => candidate.id === id);
      assert.equal(pool(phase - 1), false, `${name} before Phase ${phase}`);
      assert.equal(pool(phase), true, `${name} in Phase ${phase}`);
    }
  }
});

test("#1057: an item's availability is the first phase a recipe making it is", () => {
  assert.deepEqual(recipeData.availability, data.availability, 'both data files agree');
  const first = new Map<string, number>();
  for (const recipe of recipes)
    for (const item of Object.keys(recipe.outputs))
      first.set(item, Math.min(first.get(item) ?? Infinity, recipe.phase!));
  const wrong = Object.entries(data.availability).flatMap(([item, phase]) =>
    !RAW.includes(item) && first.has(item) && first.get(item) !== phase
      ? [`${item}: ${phase}, first made in Phase ${first.get(item)}`]
      : [],
  );
  assert.deepEqual(wrong, []);
  assert.deepEqual(
    ['Steel Pipe', 'Portable Miner', 'Empty Canister', 'Diamonds'].map(
      item => data.availability[item],
    ),
    [2, 2, 3, 5],
  );
});

// A Phase 1 profile stored before #1057 (tests/fixtures/plan-before-1057.json, calculated on
// origin/main at be203150): every alternate allowed and Iron Pipe, Automated Miner and Coated Iron
// Canister owned, so its Phase 1 has an Iron Pipe line for storage, with that recipe's unlock step
// and the hunt for it, and the ticks a player made on it. `steps` are its build plan's step ids
// per phase as that release listed them, `hunts` its hard-drive hunts (alternateHunts) and
// `ownedKeys` the steps its owned alternates ticked on a new profile (ownedAlternateKeys).
const fixture = readJson('tests/fixtures/plan-before-1057.json') as {
  plan: StoredCalculatedPlan;
  state: ProgressState;
  steps: Record<string, string[]>;
  hunts: AlternateHunt[];
  ownedKeys: string[];
};
const stored = fixture.plan;
const exported = (plan: StoredCalculatedPlan, state: ProgressState): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-12T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state }],
    },
  ],
});
const ironPipeRows = (plan: StoredCalculatedPlan, phase: '1' | '2') =>
  (plan.stages[phase]?.rows ?? []).filter(row => row.id.split(':')[0] === IRON_PIPE);

test('migration: a plan stored before #1057 keeps its lines, steps and ticks', () => {
  assert.ok(ironPipeRows(stored, '1').length, 'the fixture builds Iron Pipe in Phase 1');
  assert.ok(fixture.state.checks['recipe-unlock-' + IRON_PIPE], 'and its unlock is ticked');
  // Its build plan lists what it listed: the Iron Pipe unlock and the Phase 1 hunt included.
  for (const phase of ['1', '2', '3', '4', '5', 'post'])
    assert.deepEqual(
      phaseSteps(stored, fixture.state, data, phase).map(step => step.id),
      fixture.steps[phase],
      `Phase ${phase}`,
    );
  // The hard-drive hunts are those it had, Phase 1's asking for Iron Pipe, and a new profile
  // carried from it that owns those alternates starts with the same unlock steps ticked.
  const hunts = alternateHunts(stored, data);
  assert.deepEqual(hunts, fixture.hunts);
  assert.ok(
    hunts
      .find(hunt => hunt.phase === '1')
      ?.recipes.some(recipe => recipe.key === 'recipe-unlock-' + IRON_PIPE),
  );
  const owned = new Set(stored.settings.ownedAlternates!.map(id => 'recipe-unlock-' + id));
  assert.deepEqual(ownedAlternateKeys(hunts, owned), fixture.ownedKeys);
  assert.deepEqual(settings(stored.settings).ownedAlternates, stored.settings.ownedAlternates);
});

test('#1057: recalculating the stored plan, which only the user starts, uses Iron Pipe from Phase 2', () => {
  const again = calculate(json(stored.settings));
  assert.deepEqual(again.settings.ownedAlternates, stored.settings.ownedAlternates);
  assert.deepEqual(ironPipeRows(again, '1'), []);
  assert.equal(again.stages['1'].storage?.['Steel Pipe'], undefined, 'no Steel Pipe in Phase 1');
  assert.equal(stored.stages['1'].storage?.['Steel Pipe'], 1, 'which the stored plan stocks');
});

test('migration: the stored plan and its ticks load, import and export unchanged (Docker)', async () => {
  const file = exported(stored, fixture.state);
  const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!;
  assert.equal(JSON.stringify(checked.plan), JSON.stringify(stored));
  assert.deepEqual(checked.state!.checks, fixture.state.checks);
  const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!;
  assert.equal(JSON.stringify(imported.plan), JSON.stringify(stored));
  assert.deepEqual(imported.state!.checks, fixture.state.checks);
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-recipe-phases-'));
  try {
    const workspace = await loadWorkspace(dataDir, validateState);
    workspace.saves.push({
      id: 's1',
      name: 'World',
      userId: 'owner',
      activeProfile: 'p1',
      profiles: [
        { id: 'p1', name: 'Stored', kind: 'calculated', plan: stored, state: fixture.state },
      ],
    });
    await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
    const loaded = (await loadWorkspace(dataDir, validateState)).saves[0]!.profiles[0]!;
    assert.equal(JSON.stringify(loaded.plan), JSON.stringify(stored));
    assert.deepEqual(loaded.state!.checks, fixture.state.checks);
  } finally {
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
});

test('migration: the browser edition keeps the stored plan and its ticks across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  await open()('/api/import-saves', { body: JSON.stringify(exported(stored, fixture.state)) });
  const out = (await open()('/api/export-saves')) as SaveExport;
  const profile = out.saves[0]!.profiles[0]!;
  assert.equal(JSON.stringify(profile.plan), JSON.stringify(stored));
  assert.deepEqual(profile.state!.checks, fixture.state.checks);
});
