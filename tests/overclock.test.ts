// Overclocking whenever the player can (#1137): with mining per phase, settings.overclock (the MAM's
// Overclock Production research, or "I can overclock" in "What you already have") runs every
// phase's miners and oil extractors up to 250%, never past a node's belt or pipe, the last machine
// underclocked to the remainder. Since #1169 Phases 2–5 plan that way in any case, after the Power
// Shards research the build plan schedules; without it only Phase 1 plans 100%, and a Phase 2 or 3
// stage stored at 100% says what it was calculated with and what overclocking would save (the
// recalculation offer from the ticks follows the stored stage). Water Extractors run at 100% unless
// settings.waterOverclock. Both fields are absent unless chosen, so every stored plan loads,
// imports, exports and recalculates as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, settings } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import {
  OVERCLOCK_ADVICE_FROM,
  miningStepBody,
  overclockSaving,
  stageMiningAdvice,
} from '../public/mining.ts';
import {
  OVERCLOCK_RESEARCH,
  miningMW,
  phaseMiner,
  phaseMining,
  resourceDefaults,
  waterClock,
} from '../public/preferences.ts';
import {
  foundSince,
  foundWords,
  ownedFromTicks,
  withOwnedFound,
} from '../public/app/owned-ticks.ts';
import { initialState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import type { SaveExport, StoredCalculatedPlan, StoredStage } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const limits = resourceDefaults('vanilla', 'original').limits;
// The owner's case: Phase 3 mines with Miner Mk.2 on Mk.4 belts (480/min) and draws 2,356.75 Iron
// Ore a minute, 240/min a pure node at 100%.
const IRON = 2356.75;
const stageAt = (phase: number, overclock: boolean, raw = { 'Iron Ore': IRON }) =>
  ({
    mining: phaseMining({ limits, ...(overclock ? { overclock } : {}) }, phase),
    raw,
  }) as Pick<StoredStage, 'mining' | 'raw'>;
// A Phase 2 or 3 stage as stored before #1169, without Power Shards: its miners at 100%.
const storedAt100 = (phase: number, raw = { 'Iron Ore': IRON }) => {
  const stage = stageAt(phase, false, raw);
  stage.mining!.miner = { ...stage.mining!.miner, clock: 1 };
  return stage;
};

test('settings keep only true for overclock and waterOverclock, absent otherwise', () => {
  assert.equal(settings({ overclock: true, waterOverclock: true }).overclock, true);
  assert.equal(settings({ overclock: true, waterOverclock: true }).waterOverclock, true);
  for (const wrong of [false, 'true', 1, null, undefined]) {
    const out = settings({ overclock: wrong, waterOverclock: wrong });
    assert.equal('overclock' in out, false, String(wrong));
    assert.equal('waterOverclock' in out, false, String(wrong));
  }
});

test("the owner's case: Phase 3, Miner Mk.2, Mk.4 belts: 5 miners overclocked, 10 at 100%", () => {
  // Since #1169 Phase 3 plans overclocked with or without "I can overclock".
  for (const over of [stageAt(3, true), stageAt(3, false)]) {
    assert.deepEqual(over.mining!.miner, { mark: 2, clock: 2.5 });
    assert.equal(stageMiningAdvice(over)[0]!.advice.nodes, 5);
  }
  const over = stageAt(3, false);
  assert.equal(over.mining!.belt.cap, 480);
  const [iron] = stageMiningAdvice(over);
  assert.equal(iron!.advice.nodes, 5);
  // Four at 200% (the belt caps a pure Mk.2 at 480/min) and one at the exact remainder.
  const run = iron!.advice.runs[0]!;
  assert.equal(run.full, 4);
  assert.equal(run.clock, 2);
  assert.ok(Math.abs(run.last! - (2 * (IRON - 4 * 480)) / 480) < 1e-9);
  assert.equal(iron!.advice.shards, 10);
  // Power at the overclock exponent: 15 MW a Mk.2, times clock^1.321929.
  const mw = 15 * (4 * 2 ** 1.321929 + run.last! ** 1.321929);
  assert.ok(Math.abs(iron!.advice.mw - mw) < 1e-6);
  for (const settingsOf of [{ limits, overclock: true }, { limits }]) {
    const body = miningStepBody(over, '3', settingsOf)!;
    assert.match(body, /Power Shards for the miners/);
    assert.doesNotMatch(body, /calculated with|100%\./);
  }

  // A stage stored at 100% before #1169 keeps its 10 miners and says what it was calculated with.
  const plain = storedAt100(3);
  assert.equal(stageMiningAdvice(plain)[0]!.advice.nodes, 10);
  assert.deepEqual(overclockSaving(plain, 3, { limits }), {
    now: 10,
    overclocked: 5,
  });
  assert.match(
    miningStepBody(plain, '3', { limits })!,
    /This plan was calculated with these miners and extractors at 100%\. Plans calculated now run them overclocked, up to what their belts and pipes carry, after researching Power Shards in the MAM \(Blue Power Slugs, then Overclock Production\): the same draw takes 5 machines instead of 10, 5 fewer\. To plan it that way, Edit settings and recalculate in place\./,
  );
});

test('no overclocking advice before the MAM is usable, nor where the phase overclocks anyway', () => {
  assert.equal(OVERCLOCK_ADVICE_FROM, 2);
  const settingsOf = { limits };
  // The very early game (#1137): Phase 1 plans 100% and says nothing about Power Shards.
  assert.equal(phaseMiner(1).clock, 1);
  assert.equal(overclockSaving(stageAt(1, false), 1, settingsOf), null);
  assert.doesNotMatch(miningStepBody(stageAt(1, false), '1', settingsOf)!, /Power Shards/);
  // Phases 2 and 3 plan overclocked now (#1169): only a stage stored at 100% has advice.
  assert.equal(overclockSaving(stageAt(2, false), 2, settingsOf), null);
  assert.notEqual(overclockSaving(storedAt100(2), 2, settingsOf), null);
  assert.equal(overclockSaving(stageAt(4, false), 4, settingsOf), null, 'Phase 4 is at 250%');
  // A survey that caps the clock at 100% has nothing to gain.
  const capped = { ...settingsOf, extraction: { mark: 2, clock: 1 } };
  assert.equal(phaseMiner(3, capped.extraction, undefined, true).clock, 1);
  assert.equal(phaseMiner(3, capped.extraction).clock, 1);
  assert.equal(overclockSaving(storedAt100(3), 3, capped), null);
});

test('Water Extractors run at 100% unless chosen; a stored stage keeps its miner clock', () => {
  assert.equal(phaseMining({ limits }, 4).water, 1);
  assert.equal(phaseMining({ limits, waterOverclock: true }, 4).water, 2.5);
  assert.equal(phaseMining({ limits }, 3).water, 1);
  assert.equal(phaseMining({ limits, waterOverclock: true }, 1).water, 1);
  assert.equal(phaseMining({ limits, waterOverclock: true }, 3).water, 2.5, 'from Phase 2 (#1169)');
  assert.equal(phaseMining({ limits, waterOverclock: true, overclock: true }, 1).water, 2.5);
  const stored = phaseMining({ limits }, 4);
  delete stored.water;
  assert.equal(waterClock(stored), 2.5, 'a stage stored before #1137 used the miner clock');
  assert.ok(
    miningMW({ Water: 100 }, stored).Water! >
      miningMW({ Water: 100 }, phaseMining({ limits }, 4)).Water!,
  );
});

test('a ticked Overclock Production offers the recalculation with overclock', () => {
  const ticked = { ['unlock-' + OVERCLOCK_RESEARCH]: true };
  // A Phase 1 plan: Phase 1 plans 100% without "I can overclock".
  const early = { settings: settings({ phase: '1', phaseMining: true }), stages: {} };
  const found = ownedFromTicks(early as never, ticked, 1)!;
  assert.equal(found.overclock, true);
  assert.deepEqual(foundWords(found).unlocked, ['Power Shards (Overclock Production)']);
  assert.equal(withOwnedFound(early.settings, found).overclock, true);
  assert.equal(foundSince(found, { alternates: [], generators: {} }), true);
  assert.equal(foundSince(found, found), false);
  // A Phase 3 plan stored at 100% before #1169: the recalculation would overclock it.
  const stored = {
    settings: settings({ phase: '3', phaseMining: true }),
    stages: { '3': storedAt100(3) },
  };
  assert.equal(ownedFromTicks(stored as never, ticked, 3)?.overclock, true);
  // Nothing to offer where the plan already overclocks (Phases 2–5 since #1169), with overclock
  // set, or without mining per phase.
  const plan = { settings: settings({ phase: '3', phaseMining: true }), stages: {} };
  assert.equal(ownedFromTicks(plan as never, ticked, 3), null);
  assert.equal(
    ownedFromTicks({ ...plan, stages: { '3': stageAt(3, false) } } as never, ticked, 3),
    null,
  );
  assert.equal(ownedFromTicks(plan as never, ticked, 4), null);
  const owning = { ...early, settings: { ...early.settings, overclock: true as const } };
  assert.equal(ownedFromTicks(owning as never, ticked, 1), null);
  const flat = { settings: settings({ phase: '1' }), stages: {} };
  assert.equal(ownedFromTicks(flat as never, ticked, 1), null);
  assert.equal(ownedFromTicks(early as never, {}, 1), null);
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

test('migration: plans before and with overclock load, import and export unchanged', async () => {
  const before = (
    JSON.parse(
      fs.readFileSync(new URL('./fixtures/plan-before-1065.json', import.meta.url), 'utf8'),
    ) as { plan: StoredCalculatedPlan }
  ).plan;
  const owned = json(
    calculate({ phase: '3', phaseMining: true, overclock: true, waterOverclock: true }),
  );
  assert.equal(owned.settings.overclock, true);
  assert.equal(owned.stages['3'].mining!.miner.clock, 2.5);
  for (const plan of [before, owned]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    assert.equal('overclock' in settings(plan.settings), 'overclock' in plan.settings);
  }
  // A stage stored before #1137 (no `water`) still gives its step: the build plan reads it as is.
  const old = json(owned.stages['3']);
  delete old.mining!.water;
  assert.ok(miningStepBody(old, '3', owned.settings));
});

test('migration: the browser edition keeps plans before and with overclock across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const before = (
    JSON.parse(
      fs.readFileSync(new URL('./fixtures/plan-before-1065.json', import.meta.url), 'utf8'),
    ) as { plan: StoredCalculatedPlan }
  ).plan;
  const plans = [before, json(calculate({ phase: '3', phaseMining: true, overclock: true }))];
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
