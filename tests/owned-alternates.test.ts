// "Alternates you already own" (#1068): settings.ownedAlternates lists the alternate recipes the
// player has already unlocked. recipePool adds each to every phase from the one it becomes
// available in, whatever the recipe setting, so a Standard plan can use an owned recipe where it is
// better. It belongs to the plan snapshot, like ownedMiner: a plan without it, every plan stored
// before it, calculates, loads, imports and exports exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, settings } from '../planner.ts';
import { recipePool } from '../planner/recipes.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type { SaveExport, StoredCalculatedPlan } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A hard-drive alternate available from Phase 2 that a Phase 3 plan uses when it may.
const SCREW = 'Recipe_Alternate_Screw_2_C';
const IRON = 'Recipe_Alternate_IngotIron_C';
const ids = (config: object, phase: number) =>
  recipePool(settings(config), phase, false).map(recipe => recipe.id);

test('settings keep the known alternates you own, sorted, and leave the field out otherwise', () => {
  assert.deepEqual(settings({ ownedAlternates: [SCREW, IRON, SCREW] }).ownedAlternates, [
    IRON,
    SCREW,
  ]);
  assert.deepEqual(
    settings({ ownedAlternates: ['Recipe_IronPlate_C', 'nonsense', 7, SCREW] }).ownedAlternates,
    [SCREW],
    'a standard recipe or an unknown id is not an owned alternate',
  );
  for (const none of [undefined, [], ['nonsense'], 'Recipe_Alternate_Screw_2_C', null, {}])
    assert.equal('ownedAlternates' in settings({ ownedAlternates: none }), false, String(none));
});

test('an owned alternate joins the pool from its phase on, under every recipe setting', () => {
  assert.equal(ids({}, 3).includes(SCREW), false, 'Standard alone has no hard-drive alternates');
  assert.ok(ids({ ownedAlternates: [SCREW] }, 3).includes(SCREW));
  assert.ok(ids({ ownedAlternates: [SCREW] }, 2).includes(SCREW), 'available from Phase 2');
  assert.equal(ids({ ownedAlternates: [SCREW] }, 1).includes(SCREW), false, 'not before');
  // Only the owned recipe joins: the rest of the Standard pool is as it was.
  assert.deepEqual(
    ids({ ownedAlternates: [SCREW] }, 3).filter(id => id !== SCREW),
    ids({}, 3),
  );
  const custom = { recipes: 'custom', alternateRecipes: [IRON] };
  assert.ok(ids({ ...custom, ownedAlternates: [SCREW] }, 3).includes(SCREW), 'custom adds it');
  assert.ok(ids({ ...custom, ownedAlternates: [SCREW] }, 3).includes(IRON), 'and keeps the picks');
  assert.deepEqual(
    ids({ recipes: 'all', ownedAlternates: [SCREW] }, 3),
    ids({ recipes: 'all' }, 3),
  );
});

test('a Standard plan uses an owned alternate where it is better; without one, as before', () => {
  const plain = calculate({ phase: '3' });
  const owned = calculate({ phase: '3', ownedAlternates: [SCREW] });
  assert.deepEqual(owned.settings.ownedAlternates, [SCREW]);
  assert.equal(owned.settings.recipes, 'standard');
  const alternates = (plan: typeof plain) =>
    Object.values(plan.stages).flatMap(stage =>
      (stage.rows || []).filter(row => row.alternate).map(row => row.id),
    );
  assert.deepEqual(alternates(plain), [], 'a Standard plan uses no hard-drive alternate');
  assert.ok(alternates(owned).includes(SCREW), 'the owned recipe is used');
  assert.deepEqual([...new Set(alternates(owned))], [SCREW], 'and no other alternate');
  // Absent or empty means as before: the same plan as one calculated without the field.
  for (const none of [undefined, []]) {
    const again = calculate({ phase: '3', ownedAlternates: none });
    assert.deepEqual(json(again.stages), json(plain.stages));
    assert.equal('ownedAlternates' in again.settings, false);
  }
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-07T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const before = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/plan-before-1065.json', import.meta.url), 'utf8'),
  ) as { plan: StoredCalculatedPlan }
).plan;
const withOwned = (): StoredCalculatedPlan =>
  json(calculate({ phase: '3', ownedAlternates: [SCREW] }));

test('migration: a stored plan without owned alternates calculates exactly as before', () => {
  assert.equal('ownedAlternates' in before.settings, false);
  assert.equal('ownedAlternates' in settings(before.settings), false);
  assert.deepEqual(json(calculate(before.settings).stages), json(before.stages));
});

test('migration: plans with and without owned alternates load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, withOwned()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    assert.deepEqual(settings(plan.settings).ownedAlternates, plan.settings.ownedAlternates);
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-owned-alternates-'));
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
  // A stored plan with owned alternates recalculated with its own settings is the plan it was.
  const plan = withOwned();
  assert.deepEqual(json(calculate(plan.settings).stages), json(plan.stages));
});

test('migration: the browser edition keeps both plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const plans = [before, withOwned()];
  let api = open();
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = open();
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});
