// The save list's per-phase progress (ProfileSummary.phases, #746) in both editions: besides the
// production lines ticked Running, each phase counts every build-plan step of it (planStepIds in
// public/state/summary.ts), the steps a profile's opening phase is worked out from (#570). The
// server (summary() in server/scope.ts) and the browser edition (GET /api/workspace in
// public/browser-api.ts) send the same counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBrowserApi } from '../public/browser-api.ts';
import { initialState, planStepIds, profilePhases } from '../public/state.ts';
import { calculate } from '../planner.ts';
import { summary } from '../server/scope.ts';
import type { Workspace } from '../server/persistence.ts';
import type {
  BrowserWorkspace,
  Catalog,
  CurrentCalculatedPlan,
  PhaseProgress,
  ProgressState,
  StageKey,
  WorkspaceSummary,
} from '../public/types/index.ts';

const data = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const plan: CurrentCalculatedPlan = calculate({ phase: '1' });
const rowsOf = (phase: StageKey) => plan.stages[phase].rows ?? [];

// The issue's reproduction: a profile starting in Phase 1, working on Phase 3, with every
// Phase 1 production line ticked Running and Phase 1's other steps open. A personal Phase 2 task
// and a removed Phase 1 step show the summary counts what the build plan lists.
function reproduction(): ProgressState {
  const state = initialState();
  state.settings.phase = '3';
  for (const row of rowsOf('1')) state.checks['calc-1-' + row.id] = true;
  state.customTasks = [{ id: 'custom-mine', phase: '2', title: 'Mine' }];
  state.taskEdits.removed = ['calc-1-storage'];
  return state;
}
// The first phase before the working one with a step open, as openingPhase decides it.
const firstOpen = (phases: PhaseProgress[], working: number) =>
  phases.find(entry => Number(entry.phase) < working && entry.steps!.done < entry.steps!.total)
    ?.phase;

test('planStepIds lists the generated steps and personal tasks of a phase, less removed ones', () => {
  const state = reproduction();
  const one = planStepIds(plan, state, data, '1');
  assert.ok(one.includes('calc-1-' + rowsOf('1')[0]!.id), 'production lines count');
  assert.ok(
    one.some(id => id.startsWith('unlock-')),
    'milestones count',
  );
  assert.ok(!one.includes('calc-1-storage'), 'a removed step does not count');
  assert.ok(planStepIds(plan, state, data, '2').includes('custom-mine'), 'a personal task does');
  assert.ok(!one.includes('custom-mine'), 'only in its own phase');
});

test('the summary counts every step of a phase, so an earlier phase with all lines ticked is open', () => {
  const state = reproduction(),
    phases = profilePhases(plan, state, data)!;
  const one = phases.find(entry => entry.phase === '1')!;
  assert.equal(one.done, one.total, 'every Phase 1 line is ticked');
  assert.equal(one.steps!.done, rowsOf('1').length, 'only the lines are ticked');
  assert.ok(one.steps!.done < one.steps!.total, 'its other steps are open');
  assert.equal(firstOpen(phases, 3), '1', 'the profile opens on Phase 1');
  for (const entry of phases)
    assert.equal(entry.steps!.total, planStepIds(plan, state, data, entry.phase).length);
  // Every step of Phase 1 ticked: the profile opens on Phase 2, and the summary says so.
  for (const id of planStepIds(plan, state, data, '1')) state.checks[id] = true;
  const done = profilePhases(plan, state, data)!;
  assert.equal(done.find(entry => entry.phase === '1')!.steps!.done, one.steps!.total);
  assert.equal(firstOpen(done, 3), '2');
});

test('the summary keeps its earlier fields, and has no phases without a calculated plan', () => {
  const state = reproduction(),
    phases = profilePhases(plan, state, data)!;
  assert.deepEqual(
    phases.map(entry => entry.phase),
    ['1', '2', '3', '4', '5'] satisfies StageKey[],
  );
  for (const entry of phases) {
    const rows = rowsOf(entry.phase);
    assert.equal(entry.total, rows.length, 'total is still the production lines');
  }
  assert.equal(profilePhases(undefined, state, data), undefined);
});

// One profile with the reproduction's progress, in each edition's workspace.
const profile = () => ({
  id: 'p',
  name: 'Plan',
  kind: 'calculated' as const,
  plan: structuredClone(plan),
  state: reproduction(),
});

test('both editions send the same per-phase step counts, so the card agrees with the phase opened on', async () => {
  const server: Workspace = {
    version: 2,
    revision: 1,
    accountsEnabled: false,
    registration: false,
    users: [{ id: 'owner', username: 'owner', activeSave: 's' }],
    saves: [{ id: 's', name: 'World', userId: 'owner', activeProfile: 'p', profiles: [profile()] }],
    sessions: [],
  };
  const fromServer = summary(server, server.users[0]).saves[0]!.profiles[0]!.phases!;
  let record: BrowserWorkspace = {
    version: 1,
    activeSave: 's',
    saves: [{ id: 's', name: 'World', activeProfile: 'p', profiles: [profile()] }],
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
  const reply = (await api('/api/workspace')) as WorkspaceSummary;
  const fromBrowser = reply.saves[0]!.profiles[0]!.phases!;
  assert.deepEqual(fromBrowser, fromServer, 'the editions agree');
  assert.deepEqual(fromServer, profilePhases(plan, reproduction(), data));
  assert.equal(firstOpen(fromServer, 3), '1', 'Phase 1 is open in the summary');
});
