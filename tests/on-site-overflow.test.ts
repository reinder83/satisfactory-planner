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
import { withOverflow } from '../planner/on-site.ts';
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

test("a recalculation lets Alpha's excess meet the central demand: no central line, fewer machines", () => {
  const plan = recalculation();
  for (const phase of PHASES) {
    const before = recorded.plan.stages[phase],
      stage = plan.stages[phase];
    assert.equal(row(stage, FUSED), undefined, `Phase ${phase}: no central Fused Quickwire line`);
    assert.equal(row(stage, OWN)?.machines, row(before, OWN)?.machines, "Alpha's line as before");
    assert.deepEqual(stage.onSiteOverflow, { [ALPHA]: ['Quickwire'] });
    assert.equal(stage.surplus?.Quickwire, 69, 'only what Alpha has left after storage');
    assert.ok(buildings(stage) < buildings(before), `${buildings(stage)} < ${buildings(before)}`);
    // The books: Alpha's excess beyond the plan's surplus is offered to storage; the sink takes
    // the rest, and every place still balances.
    const books = itemBooks(stage, recorded.groups, plan.settings.onSite);
    assert.equal(books.offered.Quickwire?.get(ALPHA), 1);
    assert.equal(books.sunk.Quickwire?.get(ALPHA), 69);
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
