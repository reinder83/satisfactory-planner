// "Compare profiles" on Saves & profiles (#1074): each profile's figures are the ones its stored
// plan holds (planFigures in public/state/figures.ts), both editions' workspace summaries send
// them, and the comparison (compareView in public/app/profile-compare.ts) gives each figure's
// difference from the baseline and marks the fastest. A figure an older plan does not hold reads
// "—", never NaN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate } from '../planner.ts';
import { powerView } from '../public/power.ts';
import { alternateHunts } from '../public/progression.ts';
import { BUILD_COSTS, buildParts, minedResources } from '../public/preferences.ts';
import { cachedPlanFigures, planFigures } from '../public/state.ts';
import {
  compareView,
  delta,
  fastestProfiles,
  shortDuration,
  type ComparedProfile,
} from '../public/app/profile-compare.ts';
import type {
  BrowserWorkspace,
  Catalog,
  PlanFigures,
  Progression,
  StoredCalculatedPlan,
  StoredStage,
  WorkspaceFile,
  WorkspaceSummary,
} from '../public/types/index.ts';

const progression: Progression = JSON.parse(
  readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const firstRelease: StoredCalculatedPlan = JSON.parse(
  readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
);
// Three paces of one world, as the issue's playtest compared them; "All alternates" so the
// hard-drive count is not zero everywhere.
const PACES = [
  { name: 'Balanced', settings: { phase: '1', goal: 'balanced', recipes: 'all' } },
  { name: 'Minimal', settings: { phase: '1', goal: 'minimal', recipes: 'all' } },
  { name: 'Timed', settings: { phase: '1', goal: 'timed', hours: 2, recipes: 'all' } },
];
const plans = PACES.map(pace => calculate(pace.settings) as StoredCalculatedPlan);

// Every number in the figures, for the NaN check.
const numbers = (figures: PlanFigures) =>
  figures.phases.flatMap(phase =>
    [
      phase.buildings,
      phase.newBuildings,
      phase.buildParts,
      phase.powerMW,
      phase.ore,
      phase.oil,
      phase.alternates,
      phase.hours,
    ].filter(value => value != null),
  );

test("a plan's figures are the ones the stored plan holds, phase by phase", () => {
  for (const plan of plans) {
    const figures = planFigures(plan)!;
    assert.equal(figures.from, 1);
    assert.deepEqual(
      figures.phases.map(phase => phase.phase),
      ['1', '2', '3', '4', '5'],
    );
    const hunts = alternateHunts(plan, progression);
    let before: StoredStage | undefined;
    for (const phase of figures.phases) {
      const stage = plan.stages[phase.phase];
      // The machines the phase adds: a line the phase before also ran adds only the machines
      // beyond its count there, as the build plan's handover counts it; and what they cost.
      let added = 0,
        parts = 0;
      for (const row of stage.rows!) {
        const kept = before?.rows!.find(old => old.id === row.id && old.machine === row.machine);
        const count = Math.max(0, row.machines - (kept?.machines ?? 0));
        added += count;
        for (const amount of Object.values(BUILD_COSTS[row.machine]!.cost)) parts += amount * count;
      }
      assert.equal(phase.newBuildings, added);
      assert.equal(phase.buildParts, parts);
      if (!before) assert.equal(phase.newBuildings, phase.buildings, 'the first phase adds all');
      else assert.ok(phase.newBuildings! < phase.buildings!, 'a later phase keeps lines');
      before = stage;
      assert.equal(phase.feasible, stage.feasible);
      assert.equal(
        phase.buildings,
        stage.rows!.reduce((sum, row) => sum + row.machines, 0),
      );
      assert.equal(phase.powerMW, powerView(stage, plan.settings).needMW);
      assert.equal(
        phase.ore,
        minedResources.reduce((sum, resource) => sum + (stage.raw![resource] ?? 0), 0),
      );
      assert.equal(phase.oil, stage.raw!['Crude Oil'] ?? 0);
      assert.equal(phase.hours, stage.hours);
      // The count of the phase's hard-drive step: the recipes it asks to unlock.
      assert.equal(
        phase.alternates,
        hunts.find(hunt => hunt.phase === phase.phase)?.recipes.length ?? 0,
      );
    }
    assert.equal(
      figures.totalHours,
      figures.phases.reduce((sum, phase) => sum + phase.hours!, 0),
    );
  }
  assert.ok(
    plans.some(plan => planFigures(plan)!.phases.some(phase => phase.alternates! > 0)),
    'some phase asks for alternates',
  );
});

test('a plan from a later start phase compares only the phases it plans', () => {
  const plan = calculate({ phase: '3', goal: 'balanced' }) as StoredCalculatedPlan;
  const figures = planFigures(plan)!;
  assert.equal(figures.from, 3);
  assert.deepEqual(
    figures.phases.map(phase => phase.phase),
    ['3', '4', '5'],
  );
});

test('an older plan shows "—" for what it does not hold, never NaN', () => {
  const figures = planFigures(firstRelease)!;
  assert.ok(numbers(figures).every(Number.isFinite), 'no NaN from the first release plan');
  // A plan with a bare draft, a stage stored without raw or hours, and a phase that never ends.
  const older = structuredClone(firstRelease);
  older.stages['3'] = { feasible: false, reason: 'Too little coal.' };
  delete older.stages['4'].raw;
  delete older.stages['4'].hours;
  older.stages['5'].hours = null;
  const sparse = planFigures(older)!;
  const [three, four, five] = sparse.phases;
  assert.deepEqual(
    [
      three!.buildings,
      three!.newBuildings,
      three!.buildParts,
      three!.powerMW,
      three!.ore,
      three!.oil,
      three!.alternates,
      three!.hours,
    ],
    [null, null, null, null, null, null, null, null],
  );
  assert.equal(four!.ore, null);
  assert.equal(four!.oil, null);
  assert.equal(four!.hours, null);
  assert.equal(four!.never, undefined);
  assert.ok(Number.isFinite(four!.buildings));
  assert.equal(five!.hours, null);
  assert.equal(five!.never, true);
  assert.equal(sparse.totalHours, null, 'no total while a phase has no time');
  assert.ok(numbers(sparse).every(Number.isFinite));

  const view = compareView(
    [
      { id: 'old', name: 'Old', figures: sparse },
      { id: 'new', name: 'New', figures: planFigures(firstRelease) },
    ],
    'new',
    '3',
    3,
  )!;
  const old = view.rows.find(row => row.id === 'old')!;
  assert.equal(old.note, 'Does not fit');
  assert.deepEqual(
    old.cells.map(cell => cell.text),
    ['—', '—', '—', '—', '—', '—', '—', '—'],
  );
  assert.ok(
    old.cells.every(cell => !cell.delta),
    'no difference from a missing figure',
  );
  const time = view.time.find(row => row.id === 'old')!;
  assert.deepEqual(
    time.phases.slice(-3).map(cell => cell.text),
    ['—', '—', 'Never'],
  );
  assert.equal(time.total.text, '—');
  assert.equal(time.fastest, false);
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, /NaN|undefined|Infinity/);
});

test('the differences are against the baseline, with their sign', () => {
  const profiles: ComparedProfile[] = PACES.map((pace, index) => ({
    id: 'p' + index,
    name: pace.name,
    figures: planFigures(plans[index]),
  }));
  for (const baseline of profiles) {
    const view = compareView(profiles, baseline.id, '4', 3)!;
    assert.equal(view.baselineId, baseline.id);
    assert.equal(view.phase, '4');
    const base = baseline.figures!.phases.find(phase => phase.phase === '4')!;
    for (const row of view.rows) {
      const own = profiles
        .find(profile => profile.id === row.id)!
        .figures!.phases.find(phase => phase.phase === '4')!;
      assert.equal(row.baseline, row.id === baseline.id);
      if (row.baseline) {
        assert.ok(
          row.cells.every(cell => !cell.delta),
          'the baseline has no differences',
        );
        continue;
      }
      const buildings = row.cells[0]!.delta;
      const difference = own.buildings! - base.buildings!;
      if (Math.abs(difference) < 0.005) assert.equal(buildings, undefined);
      else {
        assert.equal(buildings!.trend, difference > 0 ? 'higher' : 'lower');
        assert.match(buildings!.text, difference > 0 ? /^\+/ : /^−/);
      }
    }
  }
  // The words of a difference.
  assert.deepEqual(delta(131, 291, String, 0.005), { text: '−160', trend: 'lower' });
  assert.deepEqual(delta(5.9, 2, shortDuration, 1 / 120), {
    text: '+3 h 54 min',
    trend: 'higher',
  });
  assert.equal(delta(2, 2.001, shortDuration, 1 / 120), undefined, 'under a minute is the same');
  assert.equal(delta(null, 2, String, 0), undefined);
  assert.equal(delta(2, undefined, String, 0), undefined);
  assert.equal(shortDuration(0.75), '45 min');
  assert.equal(shortDuration(3), '3 h');
});

test('the fastest total is marked, among the profiles that plan the same phases', () => {
  const figures = (from: number, hours: (number | null)[]): PlanFigures => ({
    from,
    phases: hours.map((hour, index) => ({
      phase: String(from + index) as '1',
      feasible: true,
      buildings: 10,
      newBuildings: 10,
      buildParts: 100,
      powerMW: 100,
      ore: 60,
      oil: 0,
      alternates: 0,
      hours: hour,
    })),
    totalHours: hours.includes(null)
      ? null
      : hours.reduce<number>((sum, hour) => sum + (hour ?? 0), 0),
  });
  const profiles: ComparedProfile[] = [
    { id: 'a', name: 'Alpha', figures: figures(1, [1, 2, 3, 4, 5]) },
    { id: 'b', name: 'Bravo', figures: figures(1, [1, 1, 1, 1, 1]) },
    { id: 'c', name: 'Charlie', figures: figures(1, [1, 1, 1, 1, 1]) },
    { id: 'd', name: 'Delta', figures: figures(3, [0.5, 0.5, 0.5]) },
    { id: 'e', name: 'Echo', figures: figures(1, [1, null, 1, 1, 1]) },
    { id: 'f', name: 'No plan' },
  ];
  const view = compareView(profiles, 'a', '2', 0)!;
  assert.deepEqual(
    view.rows.map(row => row.id),
    ['a', 'b', 'c', 'd', 'e'],
    'a profile without figures is left out',
  );
  assert.deepEqual(
    view.time.filter(row => row.fastest).map(row => row.id),
    ['b', 'c'],
    'a tie marks both; Delta plans other phases',
  );
  assert.deepEqual(view.otherPhases, ['Delta']);
  assert.equal(view.rows.find(row => row.id === 'd')!.note, 'Not planned');
  const alpha = view.time.find(row => row.id === 'a')!;
  assert.equal(alpha.total.text, 'about 15 h');
  assert.equal(alpha.covers, 'Phases 1–5');
  assert.equal(view.time.find(row => row.id === 'b')!.total.delta!.text, '−10 h');
  assert.equal(view.time.find(row => row.id === 'd')!.total.delta, undefined);
  assert.equal(view.time.find(row => row.id === 'e')!.total.text, '—');
  // With Delta as the baseline only Delta plans Phases 3-5: nothing to call fastest.
  assert.ok(compareView(profiles, 'd', '', 0)!.time.every(row => !row.fastest));
  assert.equal(compareView(profiles, 'd', '', 0)!.phase, '3', "the baseline's first phase");
  // An unknown baseline falls back to the first profile compared.
  assert.equal(compareView(profiles, 'gone', '', 0)!.baselineId, 'a');
  // One profile has nothing to compare against.
  assert.equal(compareView(profiles.slice(0, 1), 'a', '1', 0), null);
  // What ADA says.
  assert.deepEqual(fastestProfiles(profiles, 'a', 0), {
    names: ['Bravo', 'Charlie'],
    total: 'about 5 h',
  });
  assert.deepEqual(fastestProfiles(profiles, 'd', 0).names, []);
});

// The time to finish (#1074): the plan's delivery time plus an estimated building time, the
// buildings each phase adds times the minutes per building the user sets. Measured and estimated
// stay apart in the words, 0 minutes is delivery time only, and the estimate decides "Fastest".
test('the time to finish adds the estimated building time to the delivery time', () => {
  const figures = (hours: number[], added: number[]): PlanFigures => ({
    from: 1,
    phases: hours.map((hour, index) => ({
      phase: String(index + 1) as '1',
      feasible: true,
      buildings: added[index]!,
      newBuildings: added[index]!,
      buildParts: added[index]! * 10,
      powerMW: 100,
      ore: 60,
      oil: 0,
      alternates: 0,
      hours: hour,
    })),
    totalHours: hours.reduce((sum, hour) => sum + hour, 0),
  });
  // Quick delivers sooner but builds far more; Lean builds little.
  const profiles: ComparedProfile[] = [
    { id: 'q', name: 'Quick', figures: figures([2, 3], [60, 120]) },
    { id: 'l', name: 'Lean', figures: figures([4, 5], [10, 20]) },
  ];
  const deliveryOnly = compareView(profiles, 'q', '1', 0)!;
  assert.equal(deliveryOnly.minutes, 0);
  const quick0 = deliveryOnly.time.find(row => row.id === 'q')!;
  assert.deepEqual(quick0.phases, [{ text: 'about 2 h' }, { text: 'about 3 h' }]);
  assert.equal(quick0.total.text, 'about 5 h');
  assert.equal(quick0.total.parts, undefined, 'no estimate at 0 minutes');
  assert.ok(quick0.fastest);

  const estimated = compareView(profiles, 'q', '1', 3)!;
  const quick = estimated.time.find(row => row.id === 'q')!,
    lean = estimated.time.find(row => row.id === 'l')!;
  // 60 buildings at 3 minutes are 3 h of building on top of 2 h of delivery.
  assert.deepEqual(quick.phases[0], {
    text: 'about 5 h',
    parts: ['2 h delivery', '+ est. 3 h building'],
  });
  assert.equal(quick.total.text, 'about 14 h');
  assert.deepEqual(quick.total.parts, ['5 h delivery', '+ est. 9 h building']);
  assert.equal(lean.total.text, 'about 10 h 30 min');
  assert.deepEqual(lean.total.parts, ['9 h delivery', '+ est. 1 h 30 min building']);
  assert.deepEqual(lean.total.delta, { text: '−3 h 30 min', trend: 'lower' });
  assert.ok(lean.fastest && !quick.fastest, 'the estimate decides the fastest');
  assert.deepEqual(fastestProfiles(profiles, 'q', 3), {
    names: ['Lean'],
    total: 'about 10 h 30 min',
  });
  assert.deepEqual(fastestProfiles(profiles, 'q', 0).names, ['Quick']);

  // Buildings to add a reply did not send: the delivery time stays, the total is unknown.
  const older = structuredClone(profiles);
  delete older[1]!.figures!.phases[0]!.newBuildings;
  const partial = compareView(older, 'q', '1', 3)!.time.find(row => row.id === 'l')!;
  assert.deepEqual(partial.phases[0], {
    text: 'about 4 h',
    parts: ['delivery only', 'buildings unknown'],
  });
  assert.equal(partial.total.text, '—');
  assert.equal(partial.fastest, false);
  assert.doesNotMatch(JSON.stringify(compareView(older, 'q', '1', 3)), /NaN|undefined|Infinity/);
});

test('the phase table shows the buildings to add and their build materials', () => {
  const profiles: ComparedProfile[] = PACES.map((pace, index) => ({
    id: 'p' + index,
    name: pace.name,
    figures: planFigures(plans[index]),
  }));
  const view = compareView(profiles, 'p0', '3', 3)!;
  assert.deepEqual(view.columns.slice(0, 3), ['Buildings', 'Buildings to add', 'Build materials']);
  const own = profiles[1]!.figures!.phases.find(phase => phase.phase === '3')!;
  const cells = view.rows.find(row => row.id === 'p1')!.cells;
  assert.equal(cells[1]!.text, own.newBuildings!.toLocaleString(undefined));
  assert.equal(cells[2]!.text, own.buildParts!.toLocaleString(undefined) + ' parts');
});

test('build parts are counted once per building, and a building without a cost is named', () => {
  const { parts, unknown } = buildParts([
    ['Constructor', 2],
    ['Smelter', 1],
    ['Mystery Machine', 3],
    ['Mystery Machine', 1],
  ]);
  assert.deepEqual(Object.fromEntries(parts), {
    'Reinforced Iron Plate': 4,
    Cable: 16,
    'Iron Rod': 5,
    Wire: 8,
  });
  assert.deepEqual(unknown, ['Mystery Machine']);
  // A plan whose line runs on a building the table has no cost for: no part count is guessed.
  const plan = structuredClone(plans[0]!);
  plan.stages['1'].rows![0]!.machine = 'Mystery Machine';
  const phase = planFigures(plan)!.phases[0]!;
  assert.equal(phase.buildParts, null);
  assert.ok(phase.newBuildings! > 0);
});

test('cachedPlanFigures gives each caller its own copy of the same figures', () => {
  const first = cachedPlanFigures(plans[0])!;
  first.phases[0]!.buildings = -1;
  assert.deepEqual(cachedPlanFigures(plans[0]), planFigures(plans[0]));
  assert.equal(cachedPlanFigures(null), undefined);
});

// Both editions' GET /api/workspace: three profiles of one save, each with its plan's figures.
async function assertSummary(summary: WorkspaceSummary, stored: StoredCalculatedPlan[]) {
  const profiles = summary.saves[0]!.profiles;
  assert.deepEqual(
    profiles.map(profile => profile.name),
    PACES.map(pace => pace.name),
  );
  profiles.forEach((profile, index) =>
    assert.deepEqual(profile.figures, planFigures(stored[index]), profile.name),
  );
}

test('the Docker server sends each profile its plan figures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-compare-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    let saveId: string | undefined;
    for (const pace of PACES) {
      const response = await fetch(url + '/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
        body: JSON.stringify({ saveId, saveName: 'World', ...pace }),
      });
      assert.ok(response.ok, await response.clone().text());
      saveId = ((await response.json()) as { saveId: string }).saveId;
    }
    const file = JSON.parse(
      await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'),
    ) as WorkspaceFile;
    const stored = file.saves[0]!.profiles.map(profile => profile.plan!);
    const summary = (await (await fetch(url + '/api/workspace')).json()) as WorkspaceSummary;
    await assertSummary(summary, stored);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition sends each profile its plan figures', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  let saveId: string | undefined;
  for (const pace of PACES)
    saveId = (
      (await api('/api/profiles', {
        body: JSON.stringify({ saveId, saveName: 'World', ...pace }),
      })) as { saveId: string }
    ).saveId;
  const stored = data.saves[0]!.profiles.map(profile => profile.plan!);
  await assertSummary((await api('/api/workspace')) as WorkspaceSummary, stored);
});
