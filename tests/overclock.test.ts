// Overclocking whenever the player can (#1137): with mining per phase, settings.overclock (the MAM's
// Overclock Production research, or "I can overclock" in "What you already have") runs every
// phase's miners and oil extractors up to 250%, never past a node's belt or pipe, the last machine
// underclocked to the remainder; without it Phases 1–3 plan 100% and, from Phase 2, the mining step
// advises the research with the machines it saves. Water Extractors run at 100% unless
// settings.waterOverclock. Both fields are absent unless chosen, so every stored plan loads,
// imports, exports and recalculates as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, settings } from '../planner.ts';
import {
  OVERCLOCK_ADVICE_FROM,
  miningStepBody,
  overclockSaving,
  stageMiningAdvice,
} from '../public/mining.ts';
import {
  miningMW,
  phaseMiner,
  phaseMining,
  resourceDefaults,
  waterClock,
} from '../public/preferences.ts';
import {
  OVERCLOCK_RESEARCH,
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
  const over = stageAt(3, true);
  assert.deepEqual(over.mining!.miner, { mark: 2, clock: 2.5 });
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
  const body = miningStepBody(over, '3', { limits, overclock: true })!;
  assert.match(body, /Power Shards for the miners/);
  assert.doesNotMatch(body, /Research Power Shards/);

  const plain = stageAt(3, false);
  assert.equal(stageMiningAdvice(plain)[0]!.advice.nodes, 10);
  assert.deepEqual(overclockSaving(plain, 3, { limits }), {
    now: 10,
    overclocked: 5,
  });
  assert.match(
    miningStepBody(plain, '3', { limits })!,
    /Research Power Shards in the MAM \(Blue Power Slugs, then Overclock Production\) to halve the miners on these nodes: .* 5 machines instead of 10, 5 fewer\./,
  );
});

test('no overclocking advice before the MAM is usable, nor where the phase overclocks anyway', () => {
  assert.equal(OVERCLOCK_ADVICE_FROM, 2);
  const settingsOf = { limits };
  assert.equal(overclockSaving(stageAt(1, false), 1, settingsOf), null);
  assert.doesNotMatch(miningStepBody(stageAt(1, false), '1', settingsOf)!, /Power Shards/);
  assert.notEqual(overclockSaving(stageAt(2, false), 2, settingsOf), null);
  assert.equal(overclockSaving(stageAt(4, false), 4, settingsOf), null, 'Phase 4 is at 250%');
  // A survey that caps the clock at 100% has nothing to gain.
  const capped = { ...settingsOf, extraction: { mark: 2, clock: 1 } };
  assert.equal(phaseMiner(3, capped.extraction, undefined, true).clock, 1);
  assert.equal(overclockSaving(stageAt(3, false), 3, capped), null);
});

test('Water Extractors run at 100% unless chosen; a stored stage keeps its miner clock', () => {
  assert.equal(phaseMining({ limits }, 4).water, 1);
  assert.equal(phaseMining({ limits, waterOverclock: true }, 4).water, 2.5);
  assert.equal(phaseMining({ limits, waterOverclock: true }, 3).water, 1);
  assert.equal(phaseMining({ limits, waterOverclock: true, overclock: true }, 3).water, 2.5);
  const stored = phaseMining({ limits }, 4);
  delete stored.water;
  assert.equal(waterClock(stored), 2.5, 'a stage stored before #1137 used the miner clock');
  assert.ok(
    miningMW({ Water: 100 }, stored).Water! >
      miningMW({ Water: 100 }, phaseMining({ limits }, 4)).Water!,
  );
});

test('a ticked Overclock Production offers the recalculation with overclock', () => {
  const plan = { settings: settings({ phase: '3', phaseMining: true }), stages: {} };
  const ticked = { ['unlock-' + OVERCLOCK_RESEARCH]: true };
  const found = ownedFromTicks(plan as never, ticked, 3)!;
  assert.equal(found.overclock, true);
  assert.deepEqual(foundWords(found).unlocked, ['Power Shards (Overclock Production)']);
  assert.equal(withOwnedFound(plan.settings, found).overclock, true);
  assert.equal(foundSince(found, { alternates: [], generators: {} }), true);
  assert.equal(foundSince(found, found), false);
  // Nothing to offer from Phase 4 (already 250%), with overclock set, or without mining per phase.
  assert.equal(ownedFromTicks(plan as never, ticked, 4), null);
  const owning = { ...plan, settings: { ...plan.settings, overclock: true as const } };
  assert.equal(ownedFromTicks(owning as never, ticked, 3), null);
  const flat = { settings: settings({ phase: '3' }), stages: {} };
  assert.equal(ownedFromTicks(flat as never, ticked, 3), null);
  assert.equal(ownedFromTicks(plan as never, {}, 3), null);
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
