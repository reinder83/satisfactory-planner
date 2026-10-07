// Whole machines and their cost (#1066): the production lines a whole-machine plan runs at exact
// clocks (settings.exactClocks, chosen in the progress state's exactClocks, state version 16), the
// exact plan a whole-machine phase records beside it (exactPlan), minimal construction run as fast
// as its buildings allow, the least extra budget a whole-machine draft asks for, and fluids, which
// never overproduce. The progress side covers both editions: the Docker server (createApp,
// workspace.json) and the browser edition (createBrowserApi over openBrowserStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, DATA, RAW, run, settings } from '../planner.ts';
import { roundsToWholeMachines } from '../planner/model.ts';
import { draftStage } from '../planner/draft.ts';
import { fullSpeed } from '../planner/adjustments.ts';
import { generators } from '../planner/recipes.ts';
import { resourceDefaults } from '../public/preferences.ts';
import { listNames } from '../public/wording.ts';
import {
  exactClocksChange,
  exactClocksSettings,
  fluidLines,
  lineClockNote,
  measuredRounding,
  roundingCost,
  roundsWholeLine,
  sameExactClocks,
  wantedExactClocks,
  withExactClock,
} from '../public/app/exact-clocks.ts';
import {
  checkBase,
  initialState,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version15, version16 } from './types/fixtures.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  CurrentStage,
  ExactClocks,
  ProgressState,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// The wizard's fresh settings (freshSettings in public/app/wizard/wizard.ts): whole machines, a
// guided Concrete top-up, every phase from Phase 1.
const BASE = { phase: '1', wholeMachines: true, storageOverrides: { Concrete: 20 } };
const buildings = (stage: CurrentStage) =>
  (stage.rows || []).reduce((total, row) => total + row.machines, 0);
const whole = (value: number) => Math.abs(value - Math.round(value)) < 1e-6;
const withoutTime = (plan: CurrentCalculatedPlan) => ({ ...plan, createdAt: '' });

let cached: CurrentCalculatedPlan | undefined;
const wholePlan = () => (cached ??= calculate(BASE));
// A Phase 3 line of the whole-machine plan that rounds, is the only maker of its product, and
// sends some of it to storage or the sink: one exact clocks change.
function overflowingLine(plan: CurrentCalculatedPlan): CalcRow {
  const stage = plan.stages['3'];
  const makers = (item: string) =>
    (stage.rows || []).filter(row => (row.outputs[item] || 0) > 0).length;
  const row = (stage.rows || []).find(candidate => {
    const [main] = Object.keys(candidate.outputs);
    return (
      roundsToWholeMachines(candidate) &&
      !!main &&
      makers(main) === 1 &&
      (stage.surplus?.[main] || 0) > 0.5
    );
  });
  assert.ok(row, 'the default plan has a line that overflows in Phase 3');
  return row;
}

test('settings keep the lines asked to run at exact clocks only when there are any', () => {
  assert.equal('exactClocks' in settings({}), false, 'absent by default');
  assert.equal('exactClocks' in settings({ exactClocks: {} }), false, 'an empty map is dropped');
  assert.equal('exactClocks' in settings({ exactClocks: { '3': [] } }), false);
  assert.deepEqual(
    settings({ exactClocks: { '3': ['b', 'a', 'a'], '4': [] } }).exactClocks,
    { '3': ['a', 'b'] },
    'duplicates go, ids are sorted, empty phases are dropped',
  );
  for (const bad of [
    [],
    { post: ['a'] },
    { '3': 'a' },
    { '3': [1] },
    { '3': ['amp:Recipe_Wire_C'] },
    { '3': ['bad id!'] },
  ])
    assert.throws(
      () => settings({ exactClocks: bad }),
      /Invalid exact clocks/,
      JSON.stringify(bad),
    );
});

test('a plan without exact clocks calculates exactly as without the field', () => {
  const plan = wholePlan();
  assert.deepEqual(
    withoutTime(calculate({ ...BASE, exactClocks: {} })),
    withoutTime(plan),
    'an empty choice plans the same as none',
  );
  assert.equal('exactClocks' in plan.settings, false);
});

test('a line set to exact clocks underclocks its last machine; the other lines stay whole', () => {
  const plan = wholePlan();
  const line = overflowingLine(plan);
  const [main] = Object.keys(line.outputs) as [string];
  const exact = calculate({ ...BASE, exactClocks: { '3': [line.id] } });
  const stage = exact.stages['3'];
  assert.deepEqual(exact.settings.exactClocks, { '3': [line.id] });
  const row = stage.rows!.find(candidate => candidate.id === line.id)!;
  assert.ok(row, 'the line is still planned');
  assert.ok((stage.surplus?.[main] || 0) < 0.01, 'its product no longer overflows');
  assert.ok(row.equivalent < line.equivalent, 'it runs no more than the exact remainder');
  for (const other of stage.rows!)
    if (other.id !== line.id && roundsToWholeMachines(other))
      assert.ok(whole(other.equivalent), other.name + ' stays whole');
  // Other phases plan as they did: the choice is per phase.
  for (const phase of ['1', '2', '4', '5'] as StageKey[])
    assert.deepEqual(
      { ...exact.stages[phase], exactPlan: undefined },
      { ...plan.stages[phase], exactPlan: undefined },
    );
  // The rounding warnings never name a line at exact clocks as one rounding left fractional.
  assert.ok(
    exact.warnings.some(warning => /One production line runs at exact clocks/.test(warning)),
  );
});

// Owner, 2026-10-04 (AGENTS.md): pipes cannot overflow, so a fluid balances exactly.
test('fluids never overproduce, with whole machines and with lines at exact clocks', () => {
  const plan = wholePlan();
  const line = overflowingLine(plan);
  const fluids = Object.keys(DATA.items).filter(item => DATA.items[item]!.fluid);
  for (const checked of [plan, calculate({ ...BASE, exactClocks: { '3': [line.id] } })])
    for (const [phase, stage] of Object.entries(checked.stages)) {
      assert.ok(stage.feasible, 'Phase ' + phase + ' fits');
      for (const fluid of fluids) {
        let net = RAW.includes(fluid) ? stage.raw?.[fluid] || 0 : 0;
        for (const row of stage.rows || [])
          net += (row.outputs[fluid] || 0) - (row.inputs[fluid] || 0);
        assert.ok(Math.abs(net) < 0.01, `Phase ${phase} makes ${net} more ${fluid} than it uses`);
      }
    }
});

test('a whole-machine phase records the same phase with exact clocks; an exact plan does not', () => {
  const plan = wholePlan();
  const exact = calculate({ ...BASE, wholeMachines: false });
  for (const phase of ['1', '2', '3', '4', '5'] as StageKey[]) {
    const recorded = plan.stages[phase].exactPlan!,
      reference = exact.stages[phase];
    assert.ok(recorded, 'Phase ' + phase + ' records its exact plan');
    assert.equal(recorded.buildings, buildings(reference));
    assert.equal(recorded.hours, reference.hours);
    assert.equal(recorded.needMW, reference.grid?.needMW ?? reference.requiredMW);
    assert.equal('exactPlan' in reference, false);
    assert.ok(recorded.buildings < buildings(plan.stages[phase]));
  }
  // The cost as the pages word it: more buildings and power, and the raw resources it adds.
  const cost = roundingCost(json(plan.stages['5']))!;
  assert.ok(cost.buildings[0] > 2 * cost.buildings[1], 'Phase 5 builds over twice as many');
  assert.ok(cost.needMW[0] > cost.needMW[1]);
  assert.ok(cost.extraRaw.length && cost.extraRaw.every(([, extra]) => extra > 0));
  assert.equal(roundingCost(json(exact.stages['5'])), null);
  assert.deepEqual(measuredRounding(json(plan))?.phase, '5');
  assert.equal(measuredRounding(json(exact)), null);
});

test('minimal construction runs the 24-hour buildings as fast as they allow, adding none', () => {
  const input = { ...BASE, wholeMachines: false, goal: 'minimal' };
  const plan = calculate(input);
  const config = settings(input);
  const faster = (['2', '3', '4', '5'] as StageKey[]).filter(
    phase => plan.stages[phase].aheadOf !== undefined,
  );
  assert.ok(faster.length, 'some phase finishes sooner');
  for (const phase of faster) {
    const stage = plan.stages[phase];
    const day = run(config, Number(phase), { conversion: phase === '5' });
    assert.ok(day.feasible);
    assert.equal(stage.aheadOf, day.hours, 'it records the 24-hour plan’s time');
    assert.ok(stage.hours! < day.hours, 'and finishes sooner');
    const built = new Map(day.rows.map(row => [row.id, row.machines]));
    for (const row of stage.rows!)
      assert.ok(row.machines <= (built.get(row.id) ?? 0), `${row.name} adds no building`);
  }
  assert.ok(
    plan.warnings.some(warning => warning.startsWith('Minimal construction builds the fewest')),
  );
  // Other goals plan as before: no phase is pulled ahead.
  const balanced = calculate({ ...BASE, wholeMachines: false });
  assert.ok(Object.values(balanced.stages).every(stage => stage.aheadOf === undefined));
});

// Counts the Date.now calls `fn` makes: every integer search reads its time left through it.
function searches<T>(fn: () => T): { value: T; calls: number } {
  const dateNow = Date.now;
  let calls = 0;
  Date.now = () => (calls++, dateNow());
  try {
    return { value: fn(), calls };
  } finally {
    Date.now = dateNow;
  }
}

test('minimal construction re-solves a phase only when its buildings might finish sooner', () => {
  const config = settings({ ...BASE, goal: 'minimal' });
  // Whole machines: every line runs at 100% and all of a part's output goes to the elevator, so
  // no plan within the same buildings finishes sooner, and the integer search is skipped.
  for (const phase of [2, 3, 4, 5]) {
    const day = run(config, phase, { conversion: phase === 5 });
    assert.ok(day.feasible);
    const { value, calls } = searches(() => fullSpeed(config, phase, day));
    assert.equal(value, day, `Phase ${phase} keeps its whole-machine plan`);
    assert.equal(calls, 0, `Phase ${phase} is not searched again`);
    // The search it skips finds nothing sooner either.
    const caps = Object.fromEntries(day.rows.map(row => [row.id, row.machines]));
    const fast = run(config, phase, { maximum: true, caps, conversion: phase === 5 });
    assert.ok(!fast.feasible || fast.hours >= day.hours - 1e-6, `Phase ${phase} cannot gain`);
  }
  // The part Phase 2 takes longest over, and its line.
  const day = run(config, 2);
  assert.ok(day.feasible);
  const [part] = Object.entries(day.delivery).sort(
    ([, a], [, b]) => b.target / b.rate - a.target / a.rate,
  )[0]!;
  const maker = day.rows.find(row => (row.outputs[part] || 0) > 0)!;
  // That line at exact clocks has room to spare, so the phase is searched again.
  const exact = settings({ ...BASE, goal: 'minimal', exactClocks: { '2': [maker.id] } });
  const exactDay = run(exact, 2);
  assert.ok(exactDay.feasible);
  assert.ok(
    searches(() => fullSpeed(exact, 2, exactDay)).calls > 0,
    'an exact-clock part is searched',
  );
  // So is a part you already make some of, and the same buildings then finish sooner.
  const supplied = settings({ ...BASE, goal: 'minimal', existingSupply: { [part]: 0.5 } });
  const suppliedDay = run(supplied, 2);
  assert.ok(suppliedDay.feasible);
  const faster = searches(() => fullSpeed(supplied, 2, suppliedDay));
  assert.ok(faster.calls > 0, 'a supplied part is searched');
  assert.ok(faster.value.hours < suppliedDay.hours - 1e-6, 'and finishes sooner');
  assert.equal(faster.value.aheadOf, suppliedDay.hours);
});

test('minimal construction with the target time on Phase 5 names only the earlier phases it pulls', () => {
  const input = { ...BASE, wholeMachines: false, goal: 'minimal', phaseTime: 'final' };
  const plan = calculate(input);
  const alone = calculate({ ...input, phaseTime: 'every' });
  // Every phase runs at full speed on its own; Phase 5 is not pulled, it is the final phase.
  assert.ok(alone.stages['5'].aheadOf !== undefined, 'Phase 5 runs at full speed');
  assert.equal(plan.stages['5'].hours, alone.stages['5'].hours);
  const pulled = (['1', '2', '3', '4'] as StageKey[]).filter(
    phase => plan.stages[phase].hours! < alone.stages[phase].hours! - 1e-6,
  );
  assert.ok(pulled.length, 'some earlier phase is pulled ahead');
  const warning = plan.warnings.find(text =>
    text.startsWith('Your target time applies to Phase 5.'),
  );
  assert.ok(warning);
  const many = pulled.length > 1;
  assert.ok(
    warning.includes(
      `so ${many ? 'Phases' : 'Phase'} ${listNames(pulled)} ${many ? 'finish' : 'finishes'} sooner;`,
    ),
    warning,
  );
  // A pulled phase records the 24-hour plan's time, as its full-speed plan did.
  for (const phase of pulled) {
    const own = alone.stages[phase];
    assert.equal(plan.stages[phase].aheadOf, own.aheadOf ?? own.hours, `Phase ${phase}`);
  }
});

// The issue's "+62% copper": measured with every budget doubled, raw resources cost almost
// nothing, so the fit drew extra copper to save machines and named it short.
test('a whole-machine draft asks for the least extra budget, never a resource it does not need', () => {
  const input = {
    phase: '5',
    purity: 'impure',
    multiplier: 5,
    limits: resourceDefaults('impure', 'original').limits,
    wholeMachines: true,
  };
  const stage = calculate(input).stages['5'];
  assert.equal(stage.feasible, false);
  assert.equal(stage.wholeMachinesOnly, true);
  assert.deepEqual(
    stage.shortfalls!.map(shortfall => shortfall.name),
    ['Crude Oil'],
    'copper fits once the fit may not spend budget it does not need',
  );
  assert.doesNotMatch(stage.reason!, /a little/);
  // The amount asked for is enough: the plan fits with it.
  const raised = { ...input.limits, 'Crude Oil': stage.shortfalls![0]!.needed };
  assert.equal(calculate({ ...input, limits: raised }).stages['5'].feasible, true);
});

// #1091: the draft measured the shortfall on the exact plan's network, while the plan with the
// raised budget picks its own network and runs the full whole-machine fit. On impure 5× with
// storage "all" it named Crude Oil 7,928/min, and at 7,928 the plan was a draft again asking for
// 8,081. Now the named amounts are checked with the real fit, so following them once gives a plan.
test('a whole-machine draft names budgets that fit when applied once', () => {
  const limits = resourceDefaults('impure', 'original').limits;
  for (const [phase, goal] of [
    ['5', 'balanced'],
    ['4', 'timed'],
  ] as const) {
    const input = { phase, goal, purity: 'impure', multiplier: 5, storage: 'all', limits };
    const stage = calculate({ ...input, wholeMachines: true }).stages['5'];
    assert.equal(stage.wholeMachinesOnly, true, `${phase} ${goal}`);
    assert.ok(stage.shortfalls!.length, `${phase} ${goal}`);
    const raised = { ...limits };
    for (const { name, needed, atLeast } of stage.shortfalls!) {
      assert.equal(atLeast, undefined, `${name} is confirmed`);
      raised[name] = needed;
    }
    const again = calculate({ ...input, wholeMachines: true, limits: raised }).stages['5'];
    assert.equal(again.feasible, true, `${phase} ${goal}: ${JSON.stringify(stage.shortfalls)}`);
  }
});

// A draft whose measured amount already fits names exactly what it named before the check
// (draftStage without `replan` is the measurement alone), and the plan with that amount fits.
test('a whole-machine draft that already fits is unchanged by the check', () => {
  const input = {
    phase: '5',
    purity: 'impure',
    multiplier: 5,
    wholeMachines: true,
    limits: resourceDefaults('impure', 'original').limits,
  };
  const stage = calculate(input).stages['5'];
  assert.equal(stage.wholeMachinesOnly, true);
  const measured = draftStage(settings(input), 5, { feasible: false, solverStatus: 'Infeasible' });
  assert.deepEqual(stage.shortfalls, measured.shortfalls);
  assert.equal(stage.reason, measured.reason);
  const raised = { ...input.limits };
  for (const { name, needed } of stage.shortfalls!) raised[name] = needed;
  const plan = calculate({ ...input, limits: raised });
  for (const phase of ['1', '2', '3', '4', '5'] as StageKey[])
    assert.equal(plan.stages[phase].shortfalls, undefined, `Phase ${phase}`);
  // When the check cannot confirm the amount (its search stops, or it stays short with nothing
  // more to measure), the draft keeps a floor and says so.
  for (const solverStatus of ['Time limit reached', 'Infeasible']) {
    let plans = 0;
    const unconfirmed = draftStage(
      settings(input),
      5,
      { feasible: false, solverStatus: 'Infeasible' },
      () => (plans++, { feasible: false, solverStatus }),
    );
    assert.ok(plans >= 1 && plans <= 3, `${solverStatus}: ${plans} plans`);
    assert.deepEqual(
      unconfirmed.shortfalls!.map(({ name, atLeast }) => [name, atLeast]),
      [['Crude Oil', true]],
      solverStatus,
    );
  }
});

// The interface decides which lines offer the choice by the planner's own rule.
test('the interface rounds a line exactly when the planner does, for every recipe', () => {
  const sinkable = new Set(catalog().storageItems.map(item => item.name));
  const fluids = fluidLines(
    { exactFluidLines: calculate({ phase: '2' }).exactFluidLines },
    new Set(Object.keys(DATA.items).filter(item => DATA.items[item]!.fluid)),
  );
  const config = settings({ nuclear: 'recycle', mainPower: 'nuclear' });
  for (const recipe of [...DATA.recipes, ...generators(config, 5)])
    assert.equal(
      roundsWholeLine(recipe, sinkable, fluids),
      roundsToWholeMachines(recipe),
      recipe.id + ' ' + recipe.name,
    );
});

test('the exact-clock choice: toggles, compares and names what a recalculation changes', () => {
  const plan = json(wholePlan()) as StoredCalculatedPlan;
  const line = overflowingLine(wholePlan());
  const state = initialState();
  assert.deepEqual(wantedExactClocks(plan, state), {}, 'a state without a choice follows the plan');
  assert.equal(exactClocksChange(plan, state), null);
  assert.equal(lineClockNote(plan, state, '3', line.id), '');
  const asked = withExactClock({}, '3', line.id, true);
  assert.deepEqual(asked, { '3': [line.id] });
  assert.deepEqual(withExactClock(asked, '3', line.id, false), {});
  assert.ok(sameExactClocks({ '3': ['b', 'a'] }, { '3': ['a', 'b'], '4': [] }));
  const change = exactClocksChange(plan, { exactClocks: asked })!;
  assert.deepEqual(change.exact, [{ phase: '3', id: line.id, name: line.name }]);
  assert.deepEqual(change.whole, []);
  assert.equal(
    lineClockNote(plan, { exactClocks: asked }, '3', line.id),
    'Exact clocks after a recalculation',
  );
  // An id the plan does not have in that phase asks for nothing.
  assert.equal(exactClocksChange(plan, { exactClocks: { '3': ['Recipe_Nothing_C'] } }), null);
  // The recalculation's settings: the plan's, with the choice, or without the field.
  assert.deepEqual(exactClocksSettings(plan.settings, asked).exactClocks, asked);
  assert.equal(
    'exactClocks' in exactClocksSettings({ ...plan.settings, exactClocks: asked }, {}),
    false,
  );
  // A plan calculated with the line at exact clocks, and the choice taken back.
  const recalculated = { ...plan, settings: { ...plan.settings, exactClocks: asked } };
  assert.equal(lineClockNote(recalculated, initialState(), '3', line.id), 'Exact clocks');
  assert.deepEqual(exactClocksChange(recalculated, { exactClocks: {} })!.whole, change.exact);
  assert.equal(
    lineClockNote(recalculated, { exactClocks: {} }, '3', line.id),
    'Whole machines after a recalculation',
  );
  // A plan without whole machines offers nothing.
  const precise = { ...plan, settings: { ...plan.settings, wholeMachines: false } };
  assert.equal(exactClocksChange(precise, { exactClocks: asked }), null);
  assert.equal(lineClockNote(precise, { exactClocks: asked }, '3', line.id), '');
});

test('the choice is state version 16; every released format loads unchanged without it', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 16) assert.equal('exactClocks' in clean, false);
  }
  const clean = validateState(json(version16));
  assert.equal(clean.version, 16);
  assert.deepEqual(clean.exactClocks, version16.exactClocks);
  // An empty choice is still a choice: it asks for no line at exact clocks.
  assert.equal(validateState(json({ ...version15, exactClocks: {} })).version, 16);
  for (const bad of [
    [],
    { post: ['a'] },
    { '3': 'a' },
    { '3': ['amp:Recipe_Wire_C'] },
    { '3': [7] },
  ])
    assert.throws(
      () => validateState(json({ ...version15, exactClocks: bad })),
      /Invalid exact clocks/,
    );
  assert.throws(() => validateState({ ...json(clean), version: 17 }), /newer planner version/);
  // The update saves the whole map; null forgets it and the state goes back to its version.
  const asked = mutate(json(version15), { type: 'exactClocks', value: { '4': ['b', 'a'] } });
  assert.deepEqual(asked.exactClocks, { '4': ['a', 'b'] });
  assert.equal(asked.version, 16);
  const forgotten = mutate(json(asked), { type: 'exactClocks', value: null });
  assert.equal('exactClocks' in forgotten, false);
  assert.equal(forgotten.version, 15);
  assert.throws(
    () => mutate(json(version15), { type: 'exactClocks', value: { '9': ['a'] } as ExactClocks }),
    /Invalid exact clocks/,
  );
  // It sends a whole map, so a tab that has not seen another's change is refused.
  const update = { type: 'exactClocks', value: {} };
  assert.throws(() => checkBase({ ...clean, revision: 3 }, update, '2'), /changed in another tab/);
  assert.doesNotThrow(() => checkBase({ ...clean, revision: 3 }, update, '3'));
});

test('a new profile starts without the choice; a share and a transfer keep it', () => {
  const source = validateState(json(version16));
  // A recalculation freezes the choice in the new plan's settings, so its state needs none.
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.equal('exactClocks' in carried, false);
  // A share strips progress, not plan choices such as this.
  assert.deepEqual(shareState(json(source)).exactClocks, version16.exactClocks);
});

// A stored plan keeps its numbers until the user recalculates (AGENTS.md): saving the choice
// changes the progress state only, in both editions, and a recalculation the user starts plans it.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = {
    save: { id: string };
    profile: { id: string };
    plan: StoredCalculatedPlan;
    state: ProgressState;
  };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Whole', settings: BASE });
  const before = await context();
  assert.ok(before.plan.stages['3']!.exactPlan, 'a new whole-machine plan records its exact plan');
  const line = overflowingLine(before.plan as CurrentCalculatedPlan);
  await request('/api/update', { type: 'exactClocks', value: { '3': [line.id] } });
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 16);
  assert.deepEqual(after.state.exactClocks, { '3': [line.id] });
  const change = exactClocksChange(after.plan, after.state)!;
  assert.equal(change.exact.length, 1);
  // A full export carries it and passes the import's check.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.exactClocks, {
    '3': [line.id],
  });
  // "Recalculate with exact clocks": a new profile with the choice in its settings.
  const settings = exactClocksSettings(after.plan.settings, change.wanted);
  await request('/api/profiles', {
    saveId: after.save.id,
    name: 'Whole · exact clocks',
    settings,
    carryFrom: after.profile.id,
  });
  const recalculated = await context();
  assert.deepEqual(recalculated.plan.settings.exactClocks, { '3': [line.id] });
  assert.equal('exactClocks' in recalculated.state, false);
  assert.equal(exactClocksChange(recalculated.plan, recalculated.state), null);
  assert.equal(lineClockNote(recalculated.plan, recalculated.state, '3', line.id), 'Exact clocks');
}

test('the Docker server saves the choice without recalculating the plan', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-exact-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status);
    return res.json();
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition saves the choice without recalculating the plan', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  await checkEdition(
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      api = open();
    },
  );
});
