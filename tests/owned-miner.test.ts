// "Miners you already have" (#1068): with mining per phase (#1065) each phase plans with the miner
// its HUB tiers unlock, so a player who already runs Miner Mk.3 in Phase 3 was planned with Mk.2.
// settings.ownedMiner (2 or 3) raises every phase's miner to at least that mark, still capped by a
// node survey's. It belongs to the plan snapshot, like phaseMining: a plan without it, every plan
// stored before it, calculates, loads, imports and exports exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, settings } from '../planner.ts';
import { phaseMinersWords } from '../public/mining.ts';
import { phaseMiner, phaseMining } from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type { SaveExport, StoredCalculatedPlan } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('settings keep only Miner Mk.2 or Mk.3 as the miner you already have', () => {
  assert.equal(settings({ phase: '3', ownedMiner: 2 }).ownedMiner, 2);
  assert.equal(settings({ phase: '3', ownedMiner: 3 }).ownedMiner, 3);
  for (const wrong of [1, 4, '3', null, 2.5, undefined])
    assert.equal('ownedMiner' in settings({ phase: '3', ownedMiner: wrong }), false, String(wrong));
  assert.equal('ownedMiner' in settings({ phase: '3' }), false, 'absent unless chosen');
});

test('a miner you already have raises each phase to it, and a survey still caps it', () => {
  assert.deepEqual(phaseMiner(1, null), { mark: 1, clock: 1 });
  assert.deepEqual(phaseMiner(1, null, 2), { mark: 2, clock: 1 });
  assert.deepEqual(phaseMiner(3, null, 3), { mark: 3, clock: 1 }, 'the clock stays the phase’s');
  assert.deepEqual(phaseMiner(4, null, 2), { mark: 3, clock: 2.5 }, 'never lowers a phase');
  assert.deepEqual(phaseMiner(3, { mark: 2 }, 3), { mark: 2, clock: 1 }, 'the survey caps it');
  assert.deepEqual(phaseMiner(3, null, 7), phaseMiner(3, null), 'an unknown mark is ignored');
  assert.equal(
    phaseMinersWords(null, 3, 3),
    'Miner Mk.3 at 100% in Phase 3 and Mk.3 at 250% in Phases 4 and 5',
  );
  assert.equal(
    phaseMinersWords(null, 3),
    'Miner Mk.2 at 100% in Phase 3 and Mk.3 at 250% in Phases 4 and 5',
  );
  const limits = settings({ phase: '3' }).limits;
  const own = phaseMining({ limits, ownedMiner: 3 }, 3),
    plain = phaseMining({ limits }, 3);
  assert.equal(own.miner.mark, 3);
  assert.equal(plain.miner.mark, 2);
  assert.ok(own.budgets['Iron Ore']! > plain.budgets['Iron Ore']!, 'Mk.3 gets more from the nodes');
  assert.deepEqual(phaseMining({ limits, ownedMiner: 3 }, 4), phaseMining({ limits }, 4));
});

test('a plan with a miner you already have mines Phase 3 with it; without one, as before', () => {
  const plain = calculate({ phase: '3', phaseMining: true });
  const owned = calculate({ phase: '3', phaseMining: true, ownedMiner: 3 });
  assert.equal(owned.settings.ownedMiner, 3);
  assert.equal(plain.stages['3'].mining!.miner.mark, 2);
  assert.equal(owned.stages['3'].mining!.miner.mark, 3);
  assert.ok(
    owned.stages['3'].mining!.budgets['Iron Ore']! > plain.stages['3'].mining!.budgets['Iron Ore']!,
  );
  assert.match(owned.warnings.join(' '), /Miner Mk\.3 at 100% in Phase 3/);
  // Phase 4 already has Mk.3: the same phase in both plans.
  assert.deepEqual(json(owned.stages['4'].mining), json(plain.stages['4'].mining));
  // Absent means as before: the same plan as one calculated without the field.
  const again = calculate({ phase: '3', phaseMining: true, ownedMiner: undefined });
  assert.deepEqual(json(again.stages), json(plain.stages));
  assert.equal('ownedMiner' in plain.settings, false);
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-06T08:00:00.000Z',
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
const withMiner = (): StoredCalculatedPlan =>
  json(calculate({ phase: '3', phaseMining: true, ownedMiner: 3 }));

test('migration: plans with and without the miner load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, withMiner()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    assert.equal('ownedMiner' in settings(plan.settings), 'ownedMiner' in plan.settings);
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-owned-miner-'));
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
  const plans = [before, withMiner()];
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
