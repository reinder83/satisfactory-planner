// Every node at its belt cap, the Power Shards research first (#1169). From Phase 2 a plan with
// mining per phase taps each node overclocked, up to what its belt or pipe carries (PHASE_CLOCK),
// and the build plan schedules the MAM's Blue Power Slugs and Overclock Production before the
// first nodes it taps that way: in a profile made for Phase 1 they are Phase 1's own required
// steps; a profile made for a later phase gets "Research Power Shards before tapping the nodes"
// (`power-shards-<stage>`) right before that phase's "Tap the resource nodes". Phase 1 stays at
// 100% (#1137's very-early-game rule). A plan stored before #1169 (tests/fixtures/plan-before-1169.json,
// calculated by origin/main, with the step ids its build plan listed then) keeps its numbers and
// every step id; recalculated in place it plans overclocked and keeps its ticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog } from '../planner.ts';
import { phaseSteps } from '../public/progression.ts';
import { miningStep, shardNeeds, stageMiningAdvice } from '../public/mining.ts';
import { OVERCLOCK_RESEARCH, SHARD_RECIPE_RESEARCH } from '../public/preferences.ts';
import { initialState, newProfileState, recalculatedProfile } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  Phase,
  Progression,
  SaveExport,
  StoredCalculatedPlan,
  StoredProfile,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/plan-before-1169.json', import.meta.url), 'utf8'),
) as { plan: StoredCalculatedPlan; stepIds: Record<string, string[]> };
const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];
// A Phase 3 profile like the owner's: Miner Mk.2, Mk.4 belts, Mk.2 pipes, Power Shards not
// researched; the same settings as the stored fixture, calculated now.
const SETTINGS = fixture.plan.settings;
let fresh: StoredCalculatedPlan | undefined;
const owner = () => (fresh ??= json(calculate(SETTINGS)) as StoredCalculatedPlan);
const stepsOf = (
  plan: StoredCalculatedPlan,
  phase: Phase,
  checks: Record<string, boolean> = {},
  working?: Phase,
) =>
  phaseSteps(plan, { checks, ...(working ? { settings: { phase: working } } : {}) }, data, phase);
const researchOf = (plan: StoredCalculatedPlan, phase: Phase, ...rest: [object?, Phase?]) =>
  stepsOf(plan, phase, ...(rest as [Record<string, boolean>?, Phase?])).find(step =>
    step.id.startsWith('power-shards-'),
  );

test("the owner's case: Iron Ore at 2,263.7/min is 5 Miner Mk.2, 4 at 200% and 1 at the remainder", () => {
  const plan = owner();
  const stage = plan.stages['3'];
  assert.deepEqual(stage.mining!.miner, { mark: 2, clock: 2.5 });
  assert.equal(stage.mining!.belt.cap, 480);
  const iron = stageMiningAdvice(stage).find(entry => entry.resource === 'Iron Ore')!;
  assert.ok(iron.rate > 1920 && iron.rate <= 2400, `${iron.rate}/min fits 5 nodes`);
  assert.equal(iron.advice.nodes, 5);
  const run = iron.advice.runs[0]!;
  assert.equal(run.kind, 'pure');
  assert.equal(run.full, 4);
  assert.equal(run.clock, 2, '480/min, a full Mk.4 belt');
  assert.ok(Math.abs(run.last! - (2 * (iron.rate - 4 * 480)) / 480) < 1e-9);
  // Shards: 2 for each 200% miner, one per 50% started above 100% for the last.
  assert.equal(iron.advice.shards, 4 * 2 + Math.ceil((run.last! - 1) / 0.5 - 1e-9));
  // Power at the overclock exponent: 15 MW a Mk.2, times clock^1.321929.
  const mw = 15 * (4 * 2 ** 1.321929 + run.last! ** 1.321929);
  assert.ok(Math.abs(iron.advice.mw - mw) < 1e-6);
  // The table's Iron Ore row: nodes, machines, shards and power follow from it.
  const table = miningStep(stage, '3', plan.settings)!.table;
  const row = table.rows.find(cells => cells[0] === 'Iron Ore')!;
  assert.equal(row[2], '5 pure');
  assert.match(row[3]!, /^Miner Mk\.2: 4 at 200% and 1 at \d+[.,]\d+%$/);
  assert.equal(row[4], String(iron.advice.shards));
  assert.match(row[5]!, /MW$/);
  // The stored plan, calculated before, has 10 nodes at 100% for the same draw.
  const before = stageMiningAdvice(fixture.plan.stages['3']).find(
    entry => entry.resource === 'Iron Ore',
  )!;
  assert.equal(fixture.plan.stages['3'].mining!.miner.clock, 1);
  assert.equal(before.advice.nodes, 10);
  assert.equal(before.advice.shards, 0);
});

test('the research step comes right before Tap the resource nodes, once', () => {
  const plan = owner();
  const ids = stepsOf(plan, '3').map(step => step.id);
  const at = ids.indexOf('power-shards-3');
  assert.ok(at > 0, ids.join(' '));
  assert.equal(ids[at + 1], 'mining-3');
  assert.ok(ids.findIndex(id => id.startsWith('unlock-')) < at, 'after the phase’s milestones');
  // Only in the first phase that taps overclocked; the research steps themselves stay in Phase 1.
  for (const phase of PHASES.filter(phase => phase !== '3'))
    assert.equal(researchOf(plan, phase), undefined, `Phase ${phase}`);
  const phaseOne = stepsOf(plan, '1').map(step => step.id);
  for (const id of [SHARD_RECIPE_RESEARCH, OVERCLOCK_RESEARCH])
    assert.ok(phaseOne.includes('unlock-' + id), id);

  const step = researchOf(plan, '3')!;
  assert.equal(step.title, 'Research Power Shards before tapping the nodes');
  assert.equal(step.optional, undefined, 'a required step');
  assert.equal(step.satisfied, undefined);
  const needs = shardNeeds(plan.stages['3'], '3', plan.settings)!;
  assert.ok(needs.shards > 0 && needs.at100! > needs.machines);
  assert.ok(
    step.body.startsWith(
      `Phase 3 taps its nodes overclocked, each up to what its belt or pipe carries, so fewer nodes give the same ore: its miners and extractors take ${needs.machines} machines and ${needs.shards} Power Shards, where 100% would take ${needs.at100} machines. Research Power Shards in the MAM first: find a Blue Power Slug and research Blue Power Slugs, which unlocks the Power Shard recipe; make a Power Shard from the slug in a Constructor; then research Overclock Production (1 Power Shard, 50 Iron Plate, 50 Wire), which lets machines take them.`,
    ),
    step.body,
  );
  // The mining step counts the same Power Shards, and no longer advises the research.
  const mining = miningStep(plan.stages['3'], '3', plan.settings)!;
  assert.match(mining.table.intro, new RegExp(` and ${needs.shards} Power Shards for the miners`));
  assert.doesNotMatch(mining.body, /calculated with|Research Power Shards/);
});

test('the research step shows as done once Overclock Production is ticked, with “I can overclock”, or in a later phase', () => {
  const plan = owner();
  assert.equal(
    researchOf(plan, '3', { ['unlock-' + OVERCLOCK_RESEARCH]: true })!.satisfied,
    'Done: Overclock Production is ticked.',
  );
  assert.equal(
    researchOf(plan, '3', { ['unlock-' + SHARD_RECIPE_RESEARCH]: true })!.satisfied,
    undefined,
    'the Power Shard recipe alone does not let machines take them',
  );
  const owning = { ...plan, settings: { ...plan.settings, overclock: true as const } };
  assert.equal(
    researchOf(owning, '3')!.satisfied,
    'Done: you can overclock (“I can overclock” in your settings).',
  );
  assert.equal(
    researchOf(plan, '3', {}, '4')!.satisfied,
    'Done: you are working in a later phase.',
  );
  assert.equal(researchOf(plan, '3', {}, '3')!.satisfied, undefined);
});

test('the very early game: Phase 1 plans 100% with no shards; a Phase 1 profile lists the research in Phase 1', () => {
  const plan = json(calculate({ phase: '1', phaseMining: true })) as StoredCalculatedPlan;
  assert.deepEqual(plan.stages['1'].mining!.miner, { mark: 1, clock: 1 });
  assert.equal(shardNeeds(plan.stages['1'], '1', plan.settings), null);
  assert.doesNotMatch(miningStep(plan.stages['1'], '1', plan.settings)!.body, /Power Shard/);
  assert.equal(plan.stages['2'].mining!.miner.clock, 2.5, 'Phase 2 overclocks');
  // The research is Phase 1's own required steps, so it comes before Phase 2's nodes: no extra
  // step in any phase.
  const first = stepsOf(plan, '1');
  for (const id of [SHARD_RECIPE_RESEARCH, OVERCLOCK_RESEARCH]) {
    const step = first.find(each => each.id === 'unlock-' + id);
    assert.ok(step && !step.optional, id);
  }
  for (const phase of PHASES) assert.equal(researchOf(plan, phase), undefined, `Phase ${phase}`);
});

test('a plan stored before #1169 keeps its numbers and every step id; only the research and upgrade steps are added', () => {
  const stored = json(fixture.plan);
  for (const phase of PHASES) {
    const ids = stepsOf(stored, phase).map(step => step.id);
    // Its Phase 3 was stored at 100%: no research there. Phase 4 runs 250% and is the first phase
    // that needs Power Shards, so the step comes right before its mining step.
    const expected = [...fixture.stepIds[phase]!];
    if (phase === '4') expected.splice(expected.indexOf('mining-4'), 0, 'power-shards-4');
    // Its Phases 4 and 5 draw more than the nodes before them give at their cap, so each gets the
    // upgrade of those nodes before its mining step too (#1169, tests/upgrade-first.test.ts).
    if (phase === '4' || phase === '5')
      expected.splice(expected.indexOf('mining-' + phase), 0, 'upgrade-nodes-' + phase);
    assert.deepEqual(ids, expected, `Phase ${phase}`);
  }
  // Its mining step keeps its 100% numbers and says what it was calculated with.
  const body = miningStep(stored.stages['3'], '3', stored.settings)!.body;
  assert.match(body, /Miner Mk\.2: 9 at 100%|tap 10 pure nodes with Miner Mk\.2/);
  assert.match(body, /This plan was calculated with these miners and extractors at 100%\./);
  assert.match(body, /the same draw takes \d+ machines instead of \d+, \d+ fewer/);
  // Nothing about the stored plan changed.
  assert.deepEqual(stored, fixture.plan);
});

// `plan` as a stored profile with `checks` ticked, working on Phase 3.
const profileWith = (
  plan: StoredCalculatedPlan,
  checks: Record<string, boolean>,
): StoredProfile => {
  const state = newProfileState(plan, null, null, undefined, undefined).state;
  return {
    id: 'p',
    name: 'P',
    kind: 'calculated',
    plan,
    state: { ...state, checks: { ...state.checks, ...checks }, settings: { phase: '3' } },
  };
};
const recalculated = (previous: StoredProfile, plan: StoredCalculatedPlan) =>
  recalculatedProfile(previous, plan, 'P', undefined, undefined, 'b', 'B', data).profile.state
    .checks;

test('recalculated in place, the stored plan taps overclocked and keeps its ticks; a ticked research step carries', () => {
  // Every step of the stored plan ticked, Phase 1's Overclock Production among them.
  const ticks = Object.fromEntries(
    PHASES.flatMap(phase => fixture.stepIds[phase]!)
      .filter(id => !id.startsWith('calc-'))
      .map(id => [id, true]),
  );
  const checks = recalculated(profileWith(json(fixture.plan), ticks), owner());
  // Every ticked step the new plan still lists keeps its tick.
  const listed = new Set(PHASES.flatMap(phase => stepsOf(owner(), phase).map(step => step.id)));
  const lost = Object.keys(ticks).filter(id => listed.has(id) && checks[id] !== true);
  assert.deepEqual(lost, []);
  assert.equal(checks['mining-3'], true);
  assert.equal(checks['unlock-' + OVERCLOCK_RESEARCH], true);
  // The new plan's research step reads that tick.
  assert.equal(
    researchOf(owner(), '3', checks)!.satisfied,
    'Done: Overclock Production is ticked.',
  );
  // A tick on the research step itself carries over a recalculation that still lists it.
  const again = recalculated(profileWith(owner(), { 'power-shards-3': true }), owner());
  assert.equal(again['power-shards-3'], true);
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-14T10:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});

test('migration: the stored plan and a new one load, import and export unchanged (Docker edition)', async () => {
  for (const plan of [fixture.plan, owner()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
  }
});

test('migration: the browser edition keeps the stored plan and a new one across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const plans = [fixture.plan, owner()];
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
