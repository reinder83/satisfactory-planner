// The workspace summary's per-phase step counts made cheaper (#804). profilePhases counts the
// steps of the phases up to the one worked on only, since the profile card draws later phases
// empty, and both editions keep each profile's counts (profilePhasesCache in
// public/state/summary.ts) until its plan or progress changes. The counts the card reads must
// stay what counting every phase gives, and a tick, an edit, another phase worked on or another
// plan must never leave a stale count behind, in the server's summary() and in the browser
// edition's GET /api/workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBrowserApi } from '../public/browser-api.ts';
import { milestoneOnlyPhases, phaseSteps } from '../public/progression.ts';
import {
  initialState,
  phaseProgress,
  planStepIds,
  profilePhases,
  profilePhasesCache,
} from '../public/state.ts';
import { calculate } from '../planner.ts';
import { summary } from '../server/scope.ts';
import type { Workspace } from '../server/persistence.ts';
import type {
  BrowserWorkspace,
  Catalog,
  Phase,
  PhaseProgress,
  Progression,
  ProgressState,
  StageKey,
  StoredCalculatedPlan,
  WorkspaceSummary,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// A plan from Phase 1, one made for Phase 3 (milestone-only Phases 1 and 2, #759) and one with a
// guide (#393) that leaves Phase 4 out (#466).
const fromOne: StoredCalculatedPlan = calculate({ phase: '1' });
const fromThree: StoredCalculatedPlan = calculate({});
const guided: StoredCalculatedPlan = {
  ...structuredClone(fromThree),
  guide: {
    phases: Object.fromEntries(
      (['3', '5'] as const).map(phase => [
        phase,
        phaseSteps(fromThree, { checks: {} }, data, phase).map(({ id, title, body }) => ({
          id,
          title,
          body,
        })),
      ]),
    ),
  },
};
const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];
const STAGES: StageKey[] = ['1', '2', '3', '4', '5'];

// What profilePhases sent before #804: every phase's steps, each phase worked out on its own, a
// step done by its own condition (#1070) counted as done.
function everyPhase(plan: StoredCalculatedPlan, state: ProgressState): PhaseProgress[] {
  const lines = phaseProgress(plan, state.checks)!;
  const milestoneOnly = milestoneOnlyPhases(plan).map(phase => ({ phase, done: 0, total: 0 }));
  return [...milestoneOnly, ...lines].map(entry => {
    const ids = planStepIds(plan, state, data, entry.phase),
      satisfied = new Set(
        phaseSteps(plan, state, data, entry.phase)
          .filter(step => step.satisfied)
          .map(step => step.id),
      );
    return {
      ...entry,
      steps: {
        done: ids.filter(id => state.checks[id] || satisfied.has(id)).length,
        total: ids.length,
      },
    };
  });
}
// That, less the steps of the phases after the one worked on, which the card never reads.
const expected = (plan: StoredCalculatedPlan, state: ProgressState) => {
  const working = state.settings.phase === 'post' ? 5 : Number(state.settings.phase);
  return everyPhase(plan, state).map(entry =>
    Number(entry.phase) > working
      ? { phase: entry.phase, done: entry.done, total: entry.total }
      : entry,
  );
};

// A profile's progress: `share` of each phase's steps ticked (every other one at 0.5), two
// personal tasks, one ticked, a removed step per phase and a tick the plan does not list.
function progress(plan: StoredCalculatedPlan, working: Phase, share = 0.5): ProgressState {
  const state = initialState();
  state.settings.phase = working;
  for (const stage of STAGES) {
    const ids = planStepIds(plan, { checks: {} }, data, stage);
    ids.forEach((id, i) => {
      if (i < ids.length * share) state.checks[id] = true;
    });
    if (ids.length > 2) state.taskEdits.removed.push(ids[ids.length - 2]!);
  }
  state.customTasks = [
    { id: 'custom-a', phase: '1', title: 'Mine' },
    { id: 'custom-b', phase: working, title: 'Sort' },
  ];
  state.checks['custom-a'] = true;
  state.checks['calc-9-gone'] = true;
  return state;
}

test('counting phases up to the one worked on gives the card the counts every phase gave', () => {
  for (const plan of [fromOne, fromThree, guided])
    for (const working of PHASES)
      for (const share of [0, 0.5, 1]) {
        const state = progress(plan, working, share),
          label = `plan from ${plan.settings.phase}${plan.guide ? ' with a guide' : ''}, ${working}, ${share}`;
        assert.deepEqual(profilePhases(plan, state, data), expected(plan, state), label);
        assert.deepEqual(
          profilePhasesCache()('p', plan, state, data),
          expected(plan, state),
          label,
        );
      }
  // Without a phase worked on, every phase has its steps, as before.
  const { settings: _, ...noPhase } = progress(fromOne, '3');
  assert.deepEqual(
    profilePhases(fromOne, noPhase, data),
    everyPhase(fromOne, noPhase as ProgressState),
  );
});

// progression.json behind a proxy that counts reads of its milestones, so a test can tell a
// cached answer (no reads) from one worked out again.
function counted(): { data: Progression; reads: () => number } {
  let reads = 0;
  return {
    data: new Proxy(data, {
      get(target, property, receiver) {
        if (property === 'entries') reads++;
        return Reflect.get(target, property, receiver);
      },
    }),
    reads: () => reads,
  };
}

test('profilePhasesCache keeps a profile’s counts until its plan or progress changes', () => {
  const cache = profilePhasesCache(),
    source = counted();
  let state = progress(fromOne, '3');
  const ask = (plan: StoredCalculatedPlan = fromOne) => {
    const before = source.reads();
    const phases = cache('p', plan, state, source.data);
    assert.deepEqual(phases, expected(plan, state));
    return { phases, worked: source.reads() > before };
  };
  assert.equal(ask().worked, true, 'the first summary works the counts out');
  // An unchanged profile, as a fresh copy after a commit (createCommitQueue clones the workspace).
  state = structuredClone(state);
  const kept = ask(structuredClone(fromOne));
  assert.equal(kept.worked, false, 'an unchanged profile is answered from the cache');
  // The answer is a copy: changing it does not change the next one.
  kept.phases![0]!.steps!.done = 99;
  assert.notEqual(ask().phases![0]!.steps!.done, 99);

  const changes: [string, () => void][] = [
    [
      'a tick',
      () =>
        (state.checks[planStepIds(fromOne, state, data, '1').find(id => !state.checks[id])!] =
          true),
    ],
    ['an untick', () => delete state.checks['custom-a']],
    ['a personal task', () => state.customTasks.push({ id: 'custom-c', phase: '2', title: 'New' })],
    [
      'a removed step',
      () => state.taskEdits.removed.push(planStepIds(fromOne, state, data, '2')[0]!),
    ],
    ['a restored step', () => state.taskEdits.removed.pop()],
    ['another phase worked on', () => (state.settings.phase = '5')],
    ['post-game', () => (state.settings.phase = 'post')],
  ];
  for (const [label, change] of changes) {
    state = structuredClone(state);
    change();
    assert.equal(ask().worked, true, label + ' works the counts out again');
    assert.equal(ask().worked, false, 'then they are kept again');
  }
  // Another plan under the same profile id, and other progression data.
  assert.equal(ask(fromThree).worked, true, 'another plan');
  const other = counted();
  const before = other.reads();
  assert.deepEqual(cache('p', fromThree, state, other.data), expected(fromThree, state));
  assert.ok(other.reads() > before, 'other progression data');
});

test('profilePhasesCache keeps at most its limit of profiles', () => {
  const cache = profilePhasesCache(2),
    source = counted(),
    state = progress(fromOne, '1');
  for (const id of ['a', 'b', 'c']) cache(id, fromOne, state, source.data);
  let before = source.reads();
  cache('c', fromOne, state, source.data);
  cache('b', fromOne, state, source.data);
  assert.equal(source.reads(), before, 'the two last used are kept');
  before = source.reads();
  cache('a', fromOne, state, source.data);
  assert.ok(source.reads() > before, 'the oldest was dropped');
});

// A workspace with one profile on `plan` with `state`, as the server holds it.
const serverWorkspace = (plan: StoredCalculatedPlan, state: ProgressState): Workspace => ({
  version: 2,
  revision: 1,
  accountsEnabled: false,
  registration: false,
  users: [{ id: 'owner', username: 'owner', activeSave: 's' }],
  saves: [
    {
      id: 's',
      name: 'World',
      userId: 'owner',
      activeProfile: 'cached',
      profiles: [{ id: 'cached', name: 'Plan', kind: 'calculated', plan, state }],
    },
  ],
  sessions: [],
});
const serverPhases = (workspace: Workspace) =>
  summary(workspace, workspace.users[0]).saves[0]!.profiles[0]!.phases;

test('the server summary sends fresh counts after a tick, an edit or a phase change', () => {
  let workspace = serverWorkspace(structuredClone(fromOne), progress(fromOne, '3'));
  assert.deepEqual(
    serverPhases(workspace),
    expected(fromOne, workspace.saves[0]!.profiles[0]!.state),
  );
  const edits: ((state: ProgressState) => void)[] = [
    state =>
      (state.checks[planStepIds(fromOne, state, data, '2').find(id => !state.checks[id])!] = true),
    state => state.customTasks.push({ id: 'custom-z', phase: '3', title: 'Z' }),
    state => state.taskEdits.removed.push(planStepIds(fromOne, state, data, '1')[0]!),
    state => (state.settings.phase = '1'),
  ];
  for (const edit of edits) {
    const before = serverPhases(workspace);
    // Each write commits a fresh copy of the workspace (createCommitQueue).
    workspace = structuredClone(workspace);
    edit(workspace.saves[0]!.profiles[0]!.state);
    const after = serverPhases(workspace);
    assert.deepEqual(after, expected(fromOne, workspace.saves[0]!.profiles[0]!.state));
    assert.notDeepEqual(after, before);
  }
});

test('the browser edition’s workspace sends fresh counts after a tick and a phase change', async () => {
  let record: BrowserWorkspace = {
    version: 1,
    activeSave: 's',
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'cached',
        profiles: [
          {
            id: 'cached',
            name: 'Plan',
            kind: 'calculated',
            plan: structuredClone(fromThree),
            state: progress(fromThree, '3', 0),
          },
        ],
      },
    ],
    lastBackup: null,
  };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(record);
      if (!change) return copy as T;
      const result = change(copy);
      record = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog, undefined, undefined, data);
  const phases = async () =>
    ((await api('/api/workspace')) as WorkspaceSummary).saves[0]!.profiles[0]!.phases!;
  const stored = () => record.saves[0]!.profiles[0]!.state as ProgressState;
  const update = (change: object) => api('/api/update', { body: JSON.stringify(change) });
  const start = await phases();
  assert.deepEqual(start, expected(fromThree, stored()));
  assert.deepEqual(await phases(), expected(fromThree, stored()), 'asked again');
  const first = planStepIds(fromThree, stored(), data, '1')[0]!;
  await update({ type: 'check', key: first, value: true });
  const ticked = await phases();
  assert.equal(ticked[0]!.steps!.done, start[0]!.steps!.done + 1, 'the tick is counted');
  assert.deepEqual(ticked, expected(fromThree, stored()));
  await update({ type: 'phase', value: '5' });
  const later = await phases();
  assert.ok(
    later.every(entry => entry.steps),
    'Phase 5 worked on: every phase has its steps',
  );
  assert.deepEqual(later, expected(fromThree, stored()));
  await update({ type: 'check', key: first, value: false });
  assert.equal((await phases())[0]!.steps!.done, start[0]!.steps!.done, 'the untick is counted');
});
