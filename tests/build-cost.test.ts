// Feasibility counts what a setup costs to build (#1229, slice 5 of #1078): settings.buildCost,
// "Count what buildings cost to build" on All settings step 1. A phase whose plan fits is checked
// once more on its exact LP with the parts its production lines, generators, miners and extractors
// cost to build (BUILD_COSTS, #1073) spread over its time (addBuildCosts in planner/build-cost.ts);
// one that still fits keeps its plan byte for byte, one that does not is a draft whose reason names
// the build cost (buildCostDraft in planner/build-cost-draft.ts). It belongs to the plan snapshot,
// like recipeCost: absent unless chosen, so every plan without it calculates, loads, imports and
// exports exactly as before, in both editions, with no progress state version.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, settings } from '../planner.ts';
import { run } from '../planner/model.ts';
import { BUILD_COSTS } from '../public/preferences.ts';
import { draftAdvice } from '../public/app/draft-advice.ts';
import { profileSummary, settingsChanges } from '../public/app/profile-edit.ts';
import { initialState } from '../public/state.ts';
import { buildingName } from '../public/wording.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import {
  browserProfile,
  createdProfile,
  dockerProfile,
  newSaveRequest,
} from './helpers/editions.ts';
import type {
  CurrentCalculatedPlan,
  SaveExport,
  StageBuildCost,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stagesOf = (plan: CurrentCalculatedPlan | StoredCalculatedPlan) =>
  JSON.stringify(plan.stages);
const fixture = (name: string): StoredCalculatedPlan => {
  const file = JSON.parse(
    fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'),
  ) as { plan?: StoredCalculatedPlan } & StoredCalculatedPlan;
  return file.plan ?? file;
};
const before = fixture('plan-before-1065.json');
// A Phase 3 profile with one hour per phase: it fits without the build costs, and from Phase 4 on
// its buildings cost more than it can make in that hour.
const SHORT = { phase: '3', goal: 'timed', hours: 1 } as const;
// The same with two hours, where the build costs fit too.
const ROOMY = { phase: '3', goal: 'timed', hours: 2 } as const;

test('settings keep only a true buildCost, and none under maximum output', () => {
  assert.equal(settings({ buildCost: true }).buildCost, true);
  for (const goal of ['minimal', 'balanced', 'timed'])
    assert.equal(settings({ goal, buildCost: true }).buildCost, true, goal);
  assert.equal('buildCost' in settings({}), false, 'absent unless chosen');
  for (const other of [false, 'true', 1, null, {}])
    assert.equal('buildCost' in settings({ buildCost: other }), false, JSON.stringify(other));
  // Maximum output has no time to count the parts in.
  assert.equal(
    'buildCost' in settings({ goal: 'maximum', limitsConfirmed: true, buildCost: true }),
    false,
  );
});

test('without the setting a plan is the plan it was, byte for byte (a recorded plan)', () => {
  assert.equal('buildCost' in before.settings, false);
  const again = calculate(before.settings);
  assert.equal('buildCost' in again.settings, false);
  assert.equal(stagesOf(again), stagesOf(before));
  assert.deepEqual(again.warnings, before.warnings);
  for (const off of [undefined, false])
    assert.equal(stagesOf(calculate({ ...before.settings, buildCost: off })), stagesOf(before));
});

test('a setup whose build cost fits keeps exactly the plan it has without counting it', () => {
  // The recorded plan's own settings, and a short phase time that still leaves room for the parts.
  const counted = calculate({ ...before.settings, buildCost: true });
  assert.equal(counted.settings.buildCost, true);
  assert.equal(stagesOf(counted), stagesOf(before));
  const roomy = calculate({ ...ROOMY, buildCost: true });
  assert.ok(Object.values(roomy.stages).every(stage => stage.feasible));
  assert.equal(stagesOf(roomy), stagesOf(calculate(ROOMY)));
});

test('the check counts each building beyond those that stand, and only the parts the phase can make', () => {
  const check = (input: object, phase = 3) => {
    const stage = run({ ...settings(input), wholeMachines: false }, phase, { buildCost: true });
    assert.ok(stage.feasible && stage.buildCost);
    return stage;
  };
  const stage = check(ROOMY);
  const cost = stage.buildCost!;
  assert.equal(cost.hours, 2);
  // Production lines, generators, miners and extractors.
  for (const building of [
    'Constructor',
    'Assembler',
    'Fuel Generator',
    'Miner Mk.3',
    'Oil Extractor',
  ])
    assert.ok(cost.buildings[building]! > 0, building);
  // Every building at least the machines the lines of its kind run, rounded up.
  const machines = new Map<string, number>();
  for (const row of stage.rows)
    machines.set(row.machine, (machines.get(row.machine) ?? 0) + row.equivalent);
  for (const [machine, equivalents] of machines)
    assert.ok(cost.buildings[machine]! >= Math.ceil(equivalents - 1e-6) - 1, machine);
  // The parts are the buildings times the table, without the Portable Miners a Miner takes: the
  // Equipment Workshop makes those by hand under standard recipes.
  assert.deepEqual(cost.parts, partsOf(cost));
  assert.equal(cost.parts['Portable Miner'], undefined);
  // The Automated Miner alternate makes them in a factory, so with every alternate they count.
  assert.ok(check({ ...ROOMY, recipes: 'all' }).buildCost!.parts['Portable Miner']! > 0);
  // Generators you already have stand: none of them is built again.
  const owned = check({ ...ROOMY, ownedGenerators: { 'Fuel Generator': 1000 } }).buildCost!;
  assert.equal(owned.buildings['Fuel Generator'], undefined);
  // Nor are the machines of a built line (any recipe of the machine: it changes recipe for free).
  const built = check({ ...ROOMY, builtLines: { '3': { Recipe_IronPlate_C: 500 } } }).buildCost!;
  assert.equal(built.buildings.Constructor, undefined);
  // What the parts take a minute is no surplus.
  for (const item of Object.keys(cost.parts))
    assert.ok(!(stage.surplus[item]! > 0.01), `${item} is no surplus`);
});
// The parts `cost` lists: its buildings times BUILD_COSTS, for the items it counts.
function partsOf(cost: StageBuildCost) {
  const parts: Record<string, number> = {};
  for (const [building, count] of Object.entries(cost.buildings))
    for (const [item, amount] of Object.entries(BUILD_COSTS[building]!.cost))
      if (cost.parts[item] !== undefined) parts[item] = (parts[item] ?? 0) + amount * count;
  return parts;
}

test('a setup whose build cost does not fit is a draft whose reason names it', () => {
  const plain = calculate(SHORT);
  assert.ok(
    Object.values(plain.stages).every(stage => stage.feasible),
    'fits without it',
  );
  const counted = calculate({ ...SHORT, buildCost: true });
  // Phase 3 still fits; Phases 4 and 5 cannot make their buildings' parts within the hour.
  assert.equal(JSON.stringify(counted.stages['3']), JSON.stringify(plain.stages['3']));
  for (const key of ['4', '5'] as const) {
    const stage = counted.stages[key];
    assert.equal(stage.feasible, false, `Phase ${key}`);
    const cost = stage.buildCost!;
    assert.equal(cost.hours, 1);
    assert.ok(Object.keys(cost.buildings).length > 3);
    assert.deepEqual(cost.parts, partsOf(cost));
    // "Counting what its buildings cost to build, this phase does not fit in its 1 h: its 154
    // Miners Mk.3 need 7,700 × Steel Pipe, … to build, and its 8,761 other buildings need parts
    // too, which it can't make in time along with its deliveries."
    assert.match(
      stage.reason!,
      /^Counting what its buildings cost to build, this phase does not fit in its 1 h: its [\d,]+ [A-Z][^,]+ needs? [\d,]+ × [A-Z].* to build, and its [\d,]+ other buildings need parts too, which it can't make in time along with its deliveries\. /,
    );
    // The budget reason follows, with the time it fits in.
    assert.match(
      stage.reason!,
      /It fits the current budgets at about [\d h min]+ for this phase\.$/,
    );
    assert.ok(stage.minHours! > 1 && stage.minHours! <= 3, `Phase ${key}: ${stage.minHours}`);
    assert.ok(stage.shortfalls!.length > 0);
  }
  // The named building, its count and its parts are the draft’s own.
  const { reason, buildCost } = counted.stages['4'];
  const [, count, building] = reason!.match(/: its ([\d,]+) (.+?) needs? /)!;
  const named = Object.entries(buildCost!.buildings).find(
    ([name, number]) => buildingName(name, number) === building,
  )!;
  assert.ok(named, building);
  assert.equal(count, named[1].toLocaleString());
  for (const [item, amount] of Object.entries(BUILD_COSTS[named[0]]!.cost))
    if (buildCost!.parts[item] !== undefined)
      assert.ok(reason!.includes(`${(amount * named[1]).toLocaleString()} × ${item}`), item);
  // The draft is the plan the goal would need with its parts, so the plan is never shown as done.
  assert.ok(counted.stages['4'].rows!.length > 0);
});

test('no budget making the parts in time still gives the time the phase fits in', () => {
  const plan = calculate({ phase: '2', goal: 'timed', hours: 0.5, recipeCost: 2, buildCost: true });
  const stage = plan.stages['2'];
  assert.equal(stage.feasible, false);
  assert.match(
    stage.reason!,
    /^Counting what its buildings cost to build, this phase does not fit in its 0\.5 h: .* No budget makes them in that time, but it fits the current budgets at about 1 h 30 min for this phase\.$/,
  );
  assert.equal(stage.minHours, 1.5);
  assert.ok(stage.buildCost!.buildings['Coal Generator']! > 0);
});

test('the draft’s options offer to stop counting the build costs, on Edit settings step 1', () => {
  const plan = json(calculate({ ...SHORT, buildCost: true }));
  const advice = draftAdvice(plan.stages['4'], plan.settings, { phase: 4 });
  const lever = advice.levers.find(entry => entry.id === 'buildCost');
  assert.deepEqual(lever, {
    id: 'buildCost',
    text: 'Stop counting what buildings cost to build: untick “Count what buildings cost to build” (Game settings). This phase fits its budgets as planned without it.',
    step: 1,
    label: 'Change build costs in Edit settings →',
  });
  // More time, and what runs out, from the draft's measured figures.
  assert.ok(advice.levers.some(entry => entry.id === 'time'));
  assert.ok(advice.needs.length > 0);
  // A draft of another kind has no such option.
  const other = json(calculate({ ...SHORT, hours: 0.25 }));
  const failed = Object.values(other.stages).find(stage => !stage.feasible)!;
  assert.equal(
    draftAdvice(failed, other.settings, { phase: 5 }).levers.some(
      entry => entry.id === 'buildCost',
    ),
    false,
  );
});

test('Review, the profile card and the sidebar name the setting; a plan made before it is off', () => {
  const goals = catalog().goals;
  const off = json(before.settings);
  const named = (from: object, to: object) =>
    settingsChanges(from, to, goals).changes.filter(
      change => change.label === 'Count what buildings cost to build',
    );
  assert.deepEqual(named(off, { ...off, buildCost: true }), [
    { label: 'Count what buildings cost to build', before: 'Off', after: 'On' },
  ]);
  assert.deepEqual(named({ ...off, buildCost: true }, off), [
    { label: 'Count what buildings cost to build', before: 'On', after: 'Off' },
  ]);
  assert.deepEqual(named(off, off), []);
  assert.equal(settingsChanges(off, { ...off, buildCost: true }, goals).others, 0);
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1, buildCost: true }),
    'vanilla purity · 1× elevator · 1× power · build costs counted',
  );
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1 }),
    'vanilla purity · 1× elevator · 1× power',
  );
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-23T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});

test('migration: plans with and without the setting import and export unchanged', async () => {
  for (const plan of [before, json(calculate({ ...SHORT, buildCost: true }))]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
  }
});

test('both editions create the same plan with the setting the wizard sends', async () => {
  const body = newSaveRequest({ ...SHORT, buildCost: true });
  const docker = await dockerProfile(body),
    browser = await browserProfile(body);
  assert.equal(createdProfile(docker).settings.buildCost, true);
  assert.deepEqual(json(createdProfile(browser)), json(createdProfile(docker)));
  const stage = docker.plan!.stages['4'];
  assert.equal(stage.feasible, false);
  assert.match(stage.reason!, /^Counting what its buildings cost to build/);
  assert.equal(JSON.stringify(browser.plan!.stages), JSON.stringify(docker.plan!.stages));
});
