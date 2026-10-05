// #1063: after Made on site, a central line could sink almost all it made. Alpha holds every line
// that uses Quickwire and makes it on site; the central Fused Quickwire line was still built, one
// machine making 90/min for the 1/min protected storage asks, its other 89/min sunk, beside
// Alpha's line sinking 70/min. withOverflow (planner/on-site.ts) plans such a phase again with the
// group's excess feeding the central demand, and keeps that plan only when it builds fewer
// machines. The plan as main stored it is tests/fixtures/on-site-sunk-central-2026-10-05.json
// (recorded on main before #1063 from the settings below): it keeps its numbers, in the books
// and through an import and both editions' loading, until the user recalculates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, settings } from '../planner.ts';
import { stageSettings, withOverflow } from '../planner/on-site.ts';
import { fullSpeed } from '../planner/adjustments.ts';
import { exactBalance } from '../planner/data.ts';
import { itemBooks, groupLinks, OUTSIDE } from '../public/app/group-links.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { lineProblems } from './helpers/on-site-books.ts';
import type { Solved } from '../planner/types.ts';
import type {
  CalcRow,
  CurrentSettings,
  FactoryGroups,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const ALPHA = 'fg-alpha1';
const FUSED = 'Recipe_Alternate_Quickwire_C';
const OWN = `${FUSED}:${ALPHA}`;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const recorded: { groups: FactoryGroups; plan: StoredCalculatedPlan } = JSON.parse(
  fs.readFileSync('tests/fixtures/on-site-sunk-central-2026-10-05.json', 'utf8'),
);
const rowsOf = (stage: StoredStage): CalcRow[] => stage.rows || [];
const row = (stage: StoredStage, id: string) => rowsOf(stage).find(line => line.id === id);
const buildings = (stage: StoredStage) =>
  rowsOf(stage).reduce((total, line) => total + line.machines, 0);
const PHASES: StageKey[] = ['3', '4', '5'];

let recalculated: ReturnType<typeof calculate> | undefined;
// The stored plan recalculated from its own settings, as /api/round-up and the browser edition's
// round-up do.
const recalculation = () => (recalculated ??= calculate(json(recorded.plan.settings)));

test('the stored plan: a central Fused Quickwire line sinks 89 of its 90/min', () => {
  for (const phase of PHASES) {
    const stage = recorded.plan.stages[phase];
    assert.equal(row(stage, FUSED)?.machines, 1, `Phase ${phase}: one central machine`);
    assert.equal(row(stage, FUSED)?.outputs.Quickwire, 90);
    assert.equal(stage.storage?.Quickwire, 1, 'for 1/min of storage');
    assert.equal(stage.surplus?.Quickwire, 159);
    const books = itemBooks(stage, recorded.groups, recorded.plan.settings.onSite);
    // Alpha's line sinks its excess and the central line the other 89.
    assert.equal(books.sunk.Quickwire?.get(ALPHA), 70);
    assert.equal(books.offered.Quickwire, undefined, 'nothing offered');
    assert.equal(stage.onSiteOverflow, undefined);
  }
});

// Alpha's line as the planner before #1063 sizes it from these settings: the stored plan's, but in
// Phase 5 two machines fewer, since #1086 plans the fuel for the load and the AI Limiter line
// takes 720 Quickwire/min rather than 840 (computed on main ac52c49 with #1086, the branch of
// #1086 before it merged #1063).
const BEFORE_1063_OWN: Record<string, number> = { '3': 6, '4': 13, '5': 19 };
// What Alpha's line makes beyond Alpha's lines and the 1/min of storage: 69/min, and in Phase 5,
// whose 19 machines make 1,710 for the 1,700 Alpha's lines take, 9.
const LEFT: Record<string, number> = { '3': 69, '4': 69, '5': 9 };

test("a recalculation lets Alpha's excess meet the central demand: no central line, fewer machines", () => {
  const plan = recalculation();
  for (const phase of PHASES) {
    const before = recorded.plan.stages[phase],
      stage = plan.stages[phase];
    assert.equal(row(stage, FUSED), undefined, `Phase ${phase}: no central Fused Quickwire line`);
    assert.equal(row(stage, OWN)?.machines, BEFORE_1063_OWN[phase], "Alpha's line as before");
    assert.deepEqual(stage.onSiteOverflow, { [ALPHA]: ['Quickwire'] });
    assert.equal(stage.surplus?.Quickwire, LEFT[phase], 'only what Alpha has left after storage');
    assert.ok(buildings(stage) < buildings(before), `${buildings(stage)} < ${buildings(before)}`);
    // The books: Alpha's excess beyond the plan's surplus is offered to storage; the sink takes
    // the rest, and every place still balances.
    const books = itemBooks(stage, recorded.groups, plan.settings.onSite);
    assert.equal(books.offered.Quickwire?.get(ALPHA), 1);
    assert.equal(books.sunk.Quickwire?.get(ALPHA), LEFT[phase]);
    const links = groupLinks(stage, recorded.groups, plan.settings.onSite);
    const toStorage = links.find(link => link.from === ALPHA && link.to === OUTSIDE.storage);
    assert.equal(toStorage?.items.find(entry => entry.item === 'Quickwire')?.rate, 1);
    // Alpha's line still makes what the books give Alpha, and only Quickwire is routed.
    const routed = { count: 0 };
    assert.deepEqual(
      lineProblems(stage, recorded.groups, `phase ${phase}`, { count: 0 }, undefined, routed),
      [],
    );
    assert.equal(routed.count, 1);
  }
  // The profile assumptions say so, per phase.
  for (const phase of PHASES)
    assert.ok(
      plan.warnings.includes(
        `Phase ${phase}: a central line would have sent almost all the Quickwire it made to the AWESOME Sink, so the own lines of Alpha also give the rest of the plan what they make beyond the factory's needs, and fewer central machines are built.`,
      ),
      `Phase ${phase}'s warning`,
    );
  assert.equal(recorded.plan.warnings.filter(w => w.includes('almost all')).length, 0);
  // The other phases have no line made on site and are planned exactly as before.
  for (const phase of ['1', '2'] as StageKey[])
    assert.deepEqual(
      rowsOf(plan.stages[phase]).map(line => [line.id, line.machines]),
      rowsOf(recorded.plan.stages[phase]).map(line => [line.id, line.machines]),
    );
});

// Minimal construction with exact clocks (#1092 review): the stored plan's settings with
// `goal: 'minimal'` and every central line of Phases 3-5 that makes no Quickwire at exact clocks,
// so fullSpeed (#1066) re-solves those phases rather than proving they cannot finish sooner.
// Before the fix, withOverflow compared the two plans before fullSpeed, and fullSpeed re-solved the
// routed phase without its route, so its central Quickwire line was capped at 0 machines: Phase 3
// took 23.1 hours instead of main's 13.8.
const exactClockSettings = () => {
  const input = json(recorded.plan.settings);
  input.exactClocks = Object.fromEntries(
    PHASES.map(phase => [
      phase,
      rowsOf(recorded.plan.stages[phase])
        .filter(line => !line.onSite && !line.id.startsWith('amp:') && !line.outputs.Quickwire)
        .map(line => line.id),
    ]),
  );
  return input;
};
// What main before #1063 calculates from those settings under minimal construction, with #1086's
// fuel (main ac52c49 with #1086, the branch of #1086 before it merged #1063). Main 990cec8 gave
// 78, 173 and 314 buildings in 13.81, 19.90 and 21.35 hours: its generators were sized for every
// line at full linear power, more than the 24-hour plan's load draws, and running the buildings
// faster used that power. Sized for the load, Phase 5's buildings allow no faster plan (`ahead`).
const MAIN_MINIMAL: Record<string, { buildings: number; hours: number; ahead: boolean }> = {
  '3': { buildings: 78, hours: 13.810672933513546, ahead: true },
  '4': { buildings: 171, hours: 19.942678244927716, ahead: true },
  '5': { buildings: 309, hours: 23.80952380952381, ahead: false },
};

test('under minimal construction with exact clocks, no phase finishes later than before #1063', () => {
  const plan = calculate({ ...exactClockSettings(), goal: 'minimal' });
  for (const phase of PHASES) {
    const stage = plan.stages[phase],
      main = MAIN_MINIMAL[phase]!;
    assert.ok(
      stage.hours! <= main.hours + 1e-6,
      `Phase ${phase}: ${stage.hours} h, main ${main.hours} h`,
    );
    assert.ok(buildings(stage) <= main.buildings, `Phase ${phase}: ${buildings(stage)} buildings`);
    assert.equal(stage.aheadOf !== undefined, main.ahead, `Phase ${phase} runs at full speed`);
    // A phase that keeps the route builds no central line and fewer machines; one that does not
    // is main's plan.
    if (stage.onSiteOverflow) {
      assert.equal(row(stage, FUSED), undefined, `Phase ${phase}: no central line`);
      assert.ok(buildings(stage) < main.buildings);
    } else assert.equal(buildings(stage), main.buildings);
  }
  // Phase 3 keeps the route and runs its buildings faster than main did.
  assert.deepEqual(plan.stages['3'].onSiteOverflow, { [ALPHA]: ['Quickwire'] });
  assert.ok(plan.stages['3'].hours! < MAIN_MINIMAL['3']!.hours - 1);
  // The warning names the phases that finish sooner, as on main.
  assert.ok(
    plan.warnings.includes(
      'Minimal construction builds the fewest machines that deliver each phase within 24 hours, then runs them as fast as those buildings allow, without adding one. Phases 3 and 4 finish sooner that way; their delivery rates are not rounded.',
    ),
    plan.warnings.find(warning => warning.startsWith('Minimal')),
  );
});

// What main ac52c49 (before #1063) calculates from those settings at twice the costs, balanced,
// with the target time on the final phase and #1086's fuel (the branch of #1086 before it merged
// #1063): Phases 3 and 4 are pulled ahead. (At the stored costs main gave 90, 230 and 460
// buildings; since #1086 the routed Phase 3 plan is pulled ahead too, so the costs are doubled for
// a phase whose routed plan cannot be.)
const MAIN_FINAL: Record<string, { buildings: number; hours: number }> = {
  '3': { buildings: 99, hours: 6.951270261543323 },
  '4': { buildings: 309, hours: 7.624113551418442 },
  '5': { buildings: 661, hours: 7.936507936507936 },
};

test("under phaseTime 'final', a routed phase that cannot be pulled ahead keeps the first plan when that one can (#1092 review)", () => {
  // Both Phase 3 plans take 8.33 hours, so the routed one stands on buildings. The capped re-solve
  // of the routed plan is not pulled ahead (#1094), while the first plan's is, to 6.95 hours, as
  // on main: Phase 3 keeps the first plan, pulled ahead.
  const plan = calculate({ ...exactClockSettings(), multiplier: 2, phaseTime: 'final' });
  for (const phase of PHASES) {
    const stage = plan.stages[phase],
      main = MAIN_FINAL[phase]!;
    assert.ok(
      stage.hours! <= main.hours + 1e-6,
      `Phase ${phase}: ${stage.hours} h, main ${main.hours} h`,
    );
    assert.ok(buildings(stage) <= main.buildings, `Phase ${phase}: ${buildings(stage)} buildings`);
  }
  const third = plan.stages['3'];
  assert.ok(Math.abs(third.hours! - MAIN_FINAL['3']!.hours) < 1e-6, `Phase 3: ${third.hours} h`);
  assert.equal(third.aheadOf, 25 / 3);
  assert.equal(third.onSiteOverflow, undefined, 'the first plan, without the route');
  assert.equal(row(third, FUSED)?.machines, 1, 'with its central line');
  // Phase 4's routed plan is pulled ahead itself, so it stays routed: no central line, fewer
  // buildings than main. Phase 5 is not re-solved and keeps its route.
  assert.ok(plan.stages['4'].aheadOf !== undefined);
  assert.equal(row(plan.stages['4'], FUSED), undefined, 'Phase 4: no central line');
  assert.ok(buildings(plan.stages['4']) < MAIN_FINAL['4']!.buildings);
  assert.deepEqual(plan.stages['5'].onSiteOverflow, { [ALPHA]: ['Quickwire'] });
  assert.equal(row(plan.stages['5'], FUSED), undefined, 'Phase 5: no central line');
  // The warning names Phases 3 and 4, as on main.
  assert.ok(
    plan.warnings.includes(
      'Your target time applies to Phase 5. Earlier phases run their lines as hard as the machines a later phase already builds allow, so Phases 3 and 4 finish sooner; no building is added that a later phase does not keep. Delivery rates for those phases are not rounded.',
    ),
    plan.warnings.find(warning => warning.startsWith('Your target time')),
  );
  // No fluid is made beyond what the plan uses.
  for (const phase of PHASES)
    for (const [item, rate] of Object.entries(plan.stages[phase].surplus || {}))
      if (exactBalance(item)) assert.ok(rate < 1e-6, `Phase ${phase}: ${rate}/min ${item}`);
});

test('fullSpeed re-solves a routed stage with its route, and keeps saying it was routed', () => {
  // The balanced plan routes Alpha's excess in Phases 3-5; re-solving such a stage for full speed
  // (stageSettings, as phaseTime 'final' and the augmenter fuel verdict also re-solve) needs the
  // route, or its central Quickwire line, capped at 0 machines, leaves no faster plan.
  const input = exactClockSettings();
  const plan = calculate(input);
  const minimal = settings({ ...input, goal: 'minimal' });
  for (const phase of PHASES) {
    const stage = plan.stages[phase] as Solved;
    assert.deepEqual(stage.onSiteOverflow, { [ALPHA]: ['Quickwire'] }, `Phase ${phase}`);
    assert.deepEqual(stageSettings(minimal, stage).onSite![ALPHA]!.overflow, ['Quickwire']);
    const fast = fullSpeed(minimal, Number(phase), stage);
    assert.deepEqual(fast.onSiteOverflow, { [ALPHA]: ['Quickwire'] });
    assert.equal(row(fast, FUSED), undefined, 'still no central line');
    // Phase 5's generators are sized for its load since #1086, and its whole lines leave no
    // faster plan within its buildings: it keeps the stage.
    if (phase === '5') {
      assert.equal(fast, stage, 'Phase 5 keeps its plan');
      continue;
    }
    assert.ok(fast.hours < stage.hours, `Phase ${phase}: ${fast.hours} < ${stage.hours}`);
    assert.equal(fast.aheadOf, stage.hours);
  }
  // A stage without the route re-solves with the settings as they are.
  assert.equal(plan.stages['1'].onSiteOverflow, undefined);
  assert.equal(stageSettings(minimal, plan.stages['1']), minimal);
});

// A full export holding the stored plan.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-05T12:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Quickwire', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});

test('the stored plan keeps its numbers through an import and both editions until recalculated', async () => {
  const plan = recorded.plan;
  const text = JSON.stringify(plan);
  const file = exported(plan);
  assert.equal(JSON.stringify(validateTransfer(json(file)).saves[0]!.profiles[0]!.plan), text);
  const imported = await importableTransfer(json(file));
  assert.equal(JSON.stringify(imported.saves[0]!.profiles[0]!.plan), text);
  // The Docker edition loads workspace.json without touching the plan.
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-overflow-'));
  try {
    const workspace = await loadWorkspace(dataDir, validateState);
    workspace.saves.push({
      id: 's1',
      name: 'World',
      userId: 'owner',
      activeProfile: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Quickwire',
          kind: 'calculated',
          plan: json(plan),
          state: initialState(),
        },
      ],
    });
    await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
    const loaded = await loadWorkspace(dataDir, validateState);
    assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), text);
  } finally {
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
  // The browser edition reads its IndexedDB record as it is.
  const record = {
    version: 1,
    activeSave: 's1',
    lastBackup: null,
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'Quickwire',
            kind: 'calculated',
            plan: json(plan),
            state: initialState(),
          },
        ],
      },
    ],
  };
  const records = new Map<string, unknown>([['main', json(record)]]);
  const read = await openBrowserStore(fakeIndexedDB(2, records)).transaction();
  assert.equal(JSON.stringify(read.saves[0]!.profiles[0]!.plan), text);
  // Only a recalculation the user starts plans it again.
  assert.notDeepEqual(
    rowsOf(recalculation().stages['4']).map(line => line.id),
    rowsOf(plan.stages['4']).map(line => line.id),
  );
});

// withOverflow on its own, with a stand-in for the phase's solve: a phase whose central line of an
// item a group makes on site sinks at least three quarters of what it makes is planned again with
// the route, and the second plan stands only with fewer machines and nothing it had to fall back to.
const USE = 'Recipe_Alternate_Stator_C';
const config = (wholeMachines = true): CurrentSettings =>
  settings({
    wholeMachines,
    onSite: { [ALPHA]: { name: 'Alpha', items: ['Quickwire'], shares: { '4': { [USE]: 1 } } } },
  });
const line = (id: string, machines: number, outputs: CalcRow['outputs'], extra = {}): CalcRow => ({
  id,
  name: id,
  phase: 2,
  machine: 'Assembler',
  power: 15,
  inputs: {},
  outputs,
  equivalent: machines,
  machines,
  lastClock: 100,
  peakMW: 15 * machines,
  generationMW: 0,
  ...extra,
});
// A plan whose own line makes `own` Quickwire/min for the 540 Alpha's Stator line takes, beside a
// central line of `central` machines (90/min each), with 1/min of storage.
function stagePlan(own: number, central: number): Solved {
  const rows = [
    line(OWN, own / 90, { Quickwire: own }, { onSite: { group: ALPHA, recipe: FUSED } }),
    ...(central ? [line(FUSED, central, { Quickwire: 90 * central })] : []),
    { ...line(USE, 6, { Stator: 60 }), inputs: { Quickwire: 540 } },
  ];
  // The recorded stage with these rows: withOverflow reads only the rows, surplus, hours and
  // fallbacks.
  return {
    ...recorded.plan.stages['4'],
    feasible: true,
    rows,
    surplus: { Quickwire: own - 540 + 90 * central - 1 },
    hours: 8,
  } as Solved;
}

test('withOverflow plans again only when a central line sinks almost all it makes', () => {
  const calls: CurrentSettings[] = [];
  // A solve that answers each call with the next plan, recording the settings it was given.
  const answer = (...plans: Solved[]) => {
    let call = 0;
    return (settings: CurrentSettings) => {
      calls.push(settings);
      return plans[call++]!;
    };
  };
  // 89 of 90 sunk: planned again with Alpha's route, and the plan without the central line stands.
  const sinking = stagePlan(540 + 60, 1),
    better = stagePlan(540 + 60, 0);
  const result = withOverflow(config(), 4, answer(sinking, better));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]!.onSite![ALPHA]!.overflow, ['Quickwire']);
  assert.equal(calls[0]!.onSite![ALPHA]!.overflow, undefined, 'the first solve has no route');
  assert.deepEqual(result, { ...better, onSiteOverflow: { [ALPHA]: ['Quickwire'] } });
  // As many machines, or a fallback: the first plan stands.
  calls.length = 0;
  assert.equal(withOverflow(config(), 4, answer(sinking, sinking)), sinking);
  calls.length = 0;
  const dropped = { ...better, onSiteDropped: { [ALPHA]: ['Quickwire'] } };
  assert.equal(withOverflow(config(), 4, answer(sinking, dropped)), sinking);
  // The central line uses most of what it makes (60 of 90 sunk, two thirds): planned once.
  calls.length = 0;
  const used = { ...stagePlan(540 + 60, 1), surplus: { Quickwire: 60 + 60 } };
  assert.equal(withOverflow(config(), 4, answer(used)), used);
  assert.equal(calls.length, 1);
  // Without whole machines, or without a central line, planned once.
  calls.length = 0;
  assert.equal(withOverflow(config(false), 4, answer(sinking)), sinking);
  const alone = stagePlan(600, 0);
  assert.equal(withOverflow(config(), 4, answer(alone)), alone);
  assert.equal(calls.length, 2);
});

test("withOverflow compares the two plans after the goal's finish (fullSpeed under minimal)", () => {
  const sinking = stagePlan(540 + 60, 1),
    better = stagePlan(540 + 60, 0);
  const solve = (settings: CurrentSettings) =>
    settings.onSite![ALPHA]!.overflow ? better : sinking;
  // A finish that runs the first plan to 5 hours and the routed one to 6: the first stands, as
  // the finish left it, though the routed plan was as fast before it.
  const finished: [string[] | undefined, Solved][] = [];
  const slower = (settings: CurrentSettings, plan: Solved) => {
    finished.push([settings.onSite![ALPHA]!.overflow, plan]);
    return { ...plan, hours: plan === better ? 6 : 5, aheadOf: plan.hours };
  };
  const firsts: Solved[] = [];
  const keep = (first: Solved) => firsts.push(first);
  const result = withOverflow(config(), 4, solve, slower, keep);
  assert.deepEqual(result, { ...sinking, hours: 5, aheadOf: 8 });
  assert.deepEqual(firsts, [], 'no first plan to keep when it stands itself');
  // Each plan was finished with the settings it was solved with.
  assert.deepEqual(finished, [
    [undefined, sinking],
    [['Quickwire'], better],
  ]);
  // A finish that runs both to 5 hours: the routed plan stands, with its route.
  const even = (_settings: CurrentSettings, plan: Solved) => ({ ...plan, hours: 5 });
  assert.deepEqual(withOverflow(config(), 4, solve, even, keep), {
    ...better,
    hours: 5,
    onSiteOverflow: { [ALPHA]: ['Quickwire'] },
  });
  // The first plan, as the finish left it, is kept for phaseTime 'final' (resolveEarlierPhases).
  assert.deepEqual(firsts, [{ ...sinking, hours: 5 }]);
});
