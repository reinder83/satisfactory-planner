// "Belts you already have" (#1068): with mining per phase (#1065) each phase plans with the belt its
// HUB tiers unlock, and a node gives no more than that belt carries, so a player who already runs
// Mk.4 belts in Phase 2 was planned with Mk.3 (270/min) under a pure node's Miner Mk.3 (480/min).
// settings.ownedBelt (3 to 6, for Mk.3 to Mk.6) raises every phase's belt to at least that mark.
// It belongs to the plan snapshot, like ownedMiner: a plan without it, every plan stored before
// it, calculates, loads, imports and exports exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, settings } from '../planner.ts';
import { ownedBeltsWords } from '../public/mining.ts';
import { phaseBelt, phaseMining, sourceYield } from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type { SaveExport, StoredCalculatedPlan } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('settings keep only Mk.3 to Mk.6 as the belt you already have', () => {
  for (const mark of [3, 4, 5, 6] as const)
    assert.equal(settings({ phase: '2', ownedBelt: mark }).ownedBelt, mark);
  for (const wrong of [1, 2, 7, '4', 'Mk.4', null, 4.5, undefined])
    assert.equal('ownedBelt' in settings({ phase: '2', ownedBelt: wrong }), false, String(wrong));
  assert.equal('ownedBelt' in settings({ phase: '2' }), false, 'absent unless chosen');
});

test('a belt you already have raises each phase to it, never lowers one', () => {
  assert.equal(phaseBelt(1).mark, 'Mk.2');
  assert.equal(phaseBelt(2).mark, 'Mk.3');
  assert.equal(phaseBelt(2, 4).mark, 'Mk.4');
  assert.equal(phaseBelt(1, 6).mark, 'Mk.6');
  assert.equal(phaseBelt(4, 4).mark, 'Mk.5', 'never lowers a phase');
  assert.equal(phaseBelt(2, 7), phaseBelt(2), 'an unknown mark is ignored');
  assert.equal(phaseBelt(2, 2), phaseBelt(2));
  assert.equal(
    ownedBeltsWords(2, 4),
    'Mk.4 belts in Phases 2 and 3, Mk.5 in Phase 4 and Mk.6 in Phase 5, at least the Mk.4 belts you already have',
  );
  assert.equal(ownedBeltsWords(2), '', 'none without one');
  assert.equal(ownedBeltsWords(4, 4), '', 'none where no phase is raised');
});

// A pure Iron Ore node under Phase 2's Miner Mk.3 (owned, at 100%) gives 480/min, but Phase 2's
// Mk.3 belts carry only 270/min of it; with Mk.4 belts (480/min) it gives all of it.
test('Phase 2: a pure node under an owned Miner Mk.3 gives all 480/min on owned Mk.4 belts', () => {
  const limits = settings({ phase: '2' }).limits;
  const plain = phaseMining({ limits, ownedMiner: 3 }, 2),
    own = phaseMining({ limits, ownedMiner: 3, ownedBelt: 4 }, 2);
  assert.deepEqual(plain.belt, { mark: 'Mk.3', cap: 270 });
  assert.deepEqual(own.belt, { mark: 'Mk.4', cap: 480 });
  const pure = (mining: typeof own) =>
    mining.sources['Iron Ore']!.find(source => source.kind === 'pure')!;
  assert.equal(sourceYield(pure(plain), plain.miner.clock), 270);
  assert.equal(sourceYield(pure(own), own.miner.clock), 480);
  assert.equal(plain.budgets['Iron Ore'], 27180);
  assert.equal(own.budgets['Iron Ore'], 36840);
  assert.equal(own.budgets['Water'], plain.budgets['Water'], 'Water keeps its allowance');
  // The belt alone changes nothing where the miner never fills the phase's belt (Mk.2 at 100%
  // gives a pure node 240/min), and nothing in Phase 5, which already has Mk.6.
  assert.deepEqual(
    phaseMining({ limits, ownedBelt: 4 }, 2).budgets,
    phaseMining({ limits }, 2).budgets,
  );
  assert.deepEqual(phaseMining({ limits, ownedBelt: 6 }, 5), phaseMining({ limits }, 5));
  // Phase 4's Miner Mk.3 at 250% gives a pure node 1,200/min: on its Mk.5 belts 780, on Mk.6 all.
  assert.ok(
    phaseMining({ limits, ownedBelt: 6 }, 4).budgets['Iron Ore']! >
      phaseMining({ limits }, 4).budgets['Iron Ore']!,
  );
});

test('a plan with a belt you already have mines Phase 2 with it; without one, as before', () => {
  const plain = calculate({ phase: '2', phaseMining: true, ownedMiner: 3 });
  const owned = calculate({ phase: '2', phaseMining: true, ownedMiner: 3, ownedBelt: 4 });
  assert.equal(owned.settings.ownedBelt, 4);
  assert.equal(plain.stages['2'].mining!.belt.mark, 'Mk.3');
  assert.equal(owned.stages['2'].mining!.belt.mark, 'Mk.4');
  assert.equal(owned.stages['3'].mining!.belt.mark, 'Mk.4');
  assert.equal(owned.stages['2'].mining!.budgets['Iron Ore'], 36840);
  assert.equal(plain.stages['2'].mining!.budgets['Iron Ore'], 27180);
  // The explanation names the belts, and the one the player has.
  const words = owned.warnings.find(warning => warning.startsWith("Each phase's resource budgets"));
  assert.match(
    words!,
    /\(Miner Mk\.3 at 100% in Phases 2 and 3 and Mk\.3 at 250% in Phases 4 and 5; Mk\.4 belts in Phases 2 and 3, Mk\.5 in Phase 4 and Mk\.6 in Phase 5, at least the Mk\.4 belts you already have\):/,
  );
  assert.doesNotMatch(plain.warnings.join(' '), /you already have/);
  // Phases 4 and 5 already have better belts: the same phases in both plans.
  assert.deepEqual(json(owned.stages['4'].mining), json(plain.stages['4'].mining));
  assert.deepEqual(json(owned.stages['5'].mining), json(plain.stages['5'].mining));
  // Absent means as before: the same plan as one calculated without the field.
  const again = calculate({ phase: '2', phaseMining: true, ownedMiner: 3, ownedBelt: undefined });
  assert.deepEqual(json(again.stages), json(plain.stages));
  assert.deepEqual(again.warnings, plain.warnings);
  assert.equal('ownedBelt' in plain.settings, false);
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-09T08:00:00.000Z',
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
const withBelt = (): StoredCalculatedPlan =>
  json(calculate({ phase: '2', phaseMining: true, ownedMiner: 3, ownedBelt: 4 }));

test('migration: plans with and without the belt load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, withBelt()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    assert.equal('ownedBelt' in settings(plan.settings), 'ownedBelt' in plan.settings);
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-owned-belt-'));
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
  // A stored plan recalculated with its own settings is the plan it was.
  assert.deepEqual(json(calculate(before.settings).stages), json(before.stages));
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
  const plans = [before, withBelt()];
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

test('the browser edition creates a plan with the belt from the wizard’s settings', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const created = (await open()('/api/profiles', {
    body: JSON.stringify({
      saveId: null,
      saveName: 'World',
      name: 'New',
      settings: { phase: '2', phaseMining: true, ownedBelt: 4 },
    }),
  })) as { saveId: string; profileId: string };
  // Read back after a reload.
  const file = (await open()('/api/export-saves')) as SaveExport;
  const plan = file.saves.find(save => save.id === created.saveId)!.profiles[0]!.plan!;
  assert.equal(plan.settings.ownedBelt, 4);
  assert.equal(plan.stages['2'].mining!.belt.mark, 'Mk.4');
});
