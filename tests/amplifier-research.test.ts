// Production amplification waits for the MAM research Production Amplifier (#1056). Machines take
// somersloops only once it is researched, and it costs SAM Fluctuators and Circuit Boards, first
// available in Phase 3 (AMPLIFIER_PHASE in public/somersloops.ts). Before, Phases 1 and 2 got
// amplified lines and the build plan never listed the research. Now a phase before it is planned
// exactly as without an amplification budget, a phase with amplified lines lists the research's
// step in its own phase, and a plan stored before keeps its numbers in both editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import {
  milestonePhase,
  milestonesListedIn,
  phaseSteps,
  requiredMilestones,
  guideContext,
} from '../public/progression.ts';
import { AMPLIFIER_PHASE, AMPLIFIER_RESEARCH, amplifiesIn } from '../public/somersloops.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  CurrentCalculatedPlan,
  Progression,
  StageKey,
  StoredStage,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const RESEARCH_ID = 'Research_Alien_ProductionBooster_C';
const STEP = 'unlock-' + RESEARCH_ID;
// A plan stored by the release before #1056 (the commit #1147 is based on): Phase 1 start,
// precise balancing, the standard recipes and 40 somersloops for amplification. Its Phase 1 has 2
// amplified lines and its Phase 2 has 5.
const STORED: CurrentCalculatedPlan = JSON.parse(
  fs.readFileSync(new URL('./fixtures/amplified-early-2026-10-12.json', import.meta.url), 'utf8'),
);
const SETTINGS = {
  phase: '1',
  wholeMachines: false,
  recipes: 'standard',
  somersloops: 106,
  amplifySloops: 40,
};
const amplifiedRows = (stage: StoredStage | undefined) =>
  (stage?.rows || []).filter(row => row.id.startsWith('amp:'));

let amplifiedPlan: CurrentCalculatedPlan | undefined, plainPlan: CurrentCalculatedPlan | undefined;
const withAmplification = () => (amplifiedPlan ??= calculate(SETTINGS));
const withoutAmplification = () => (plainPlan ??= calculate({ ...SETTINGS, amplifySloops: 0 }));

test('the Production Amplifier is the MAM research its phase and name say', () => {
  const entry = data.entries.find(known => known.name === AMPLIFIER_RESEARCH);
  assert.ok(entry, 'progression.json lists it');
  assert.equal(entry.id, RESEARCH_ID);
  assert.ok(entry.mam);
  assert.deepEqual(Object.keys(entry.cost).sort(), [
    'Circuit Board',
    'SAM Fluctuator',
    'Somersloop',
  ]);
  assert.equal(milestonePhase(entry, data), AMPLIFIER_PHASE, 'its costs first come in Phase 3');
  assert.equal(AMPLIFIER_PHASE, 3);
  assert.equal(amplifiesIn({ amplifySloops: 40 }, 2), false);
  assert.equal(amplifiesIn({ amplifySloops: 40 }, 3), true);
  assert.equal(amplifiesIn({ amplifySloops: 0 }, 5), false);
});

test('phases before the Production Amplifier research have no amplified lines', () => {
  const plan = withAmplification(),
    plain = withoutAmplification();
  for (const phase of ['1', '2'] as const) {
    assert.deepEqual(amplifiedRows(plan.stages[phase]), [], `Phase ${phase}: no amplified lines`);
    assert.equal(plan.stages[phase]!.sloopsUsed, 0, `Phase ${phase}: no somersloops placed`);
    assert.equal(plan.stages[phase]!.amplificationDropped, undefined, 'nothing was dropped');
    // Planned exactly as without an amplification budget.
    assert.deepEqual(plan.stages[phase], plain.stages[phase], `Phase ${phase} as without`);
  }
});

test('the research phase and later have amplified lines', () => {
  const plan = withAmplification();
  for (const phase of ['3', '4', '5'] as const) {
    assert.ok(amplifiedRows(plan.stages[phase]).length > 0, `Phase ${phase} amplifies`);
    assert.ok(plan.stages[phase]!.sloopsUsed! > 0);
    assert.ok(plan.stages[phase]!.sloopsUsed! <= SETTINGS.amplifySloops);
  }
  const warning = plan.warnings.find(text => /^Production amplification may place/.test(text));
  assert.match(
    warning!,
    /^Production amplification may place up to 40 somersloops in each phase's plan from Phase 3 on, once the MAM research Production Amplifier is done \(Phases 1 and 2 are planned without it\), and this plan uses \d+\./,
  );
});

test('the build plan lists the research in Phase 3 when a phase has amplified lines', () => {
  const plan = withAmplification();
  const step = phaseSteps(plan, { checks: {} }, data, '3').find(entry => entry.id === STEP);
  assert.ok(step, 'Phase 3 lists the research');
  assert.equal(step.title, 'MAM: Production Amplifier');
  assert.match(step.body, /Cost .*1 Somersloop.*100 SAM Fluctuator.*50 Circuit Board/);
  assert.ok(!step.optional, 'Phase 3 has amplified lines, so it is required there');
  for (const phase of ['1', '2', '4', '5'])
    assert.ok(
      !phaseSteps(plan, { checks: {} }, data, phase).some(entry => entry.id === STEP),
      `Phase ${phase} does not list it`,
    );
  // Each phase with amplified lines needs it.
  for (const phase of ['3', '4', '5'] as StageKey[])
    assert.ok(
      requiredMilestones(guideContext(plan, { checks: {} }, data, phase)).some(
        entry => entry.id === RESEARCH_ID,
      ),
      `Phase ${phase} needs it`,
    );
  // Without amplification no phase lists it.
  const plain = withoutAmplification();
  for (const phase of ['1', '2', '3', '4', '5'])
    assert.ok(!phaseSteps(plain, { checks: {} }, data, phase).some(entry => entry.id === STEP));
});

test('a profile that starts after Phase 3 lists the research in Phase 3, its milestone phase', () => {
  const plan = calculate({ ...SETTINGS, phase: '4' });
  assert.ok(amplifiedRows(plan.stages['4']).length > 0);
  assert.ok(
    milestonesListedIn(plan, { checks: {} }, data, 3).some(entry => entry.id === RESEARCH_ID),
  );
});

test('a stored plan with amplified lines in Phases 1 and 2 keeps them in its build plan', () => {
  const stored = structuredClone(STORED);
  assert.equal(amplifiedRows(stored.stages['1']).length, 2);
  assert.equal(amplifiedRows(stored.stages['2']).length, 5);
  const ids = (phase: string) => phaseSteps(stored, { checks: {} }, data, phase).map(s => s.id);
  for (const phase of ['1', '2'] as const)
    for (const row of amplifiedRows(stored.stages[phase]))
      assert.ok(ids(phase).includes(`calc-${phase}-${row.id}`), `${row.id} keeps its step`);
  // Its later phases' amplified lines bring the research in, listed in Phase 3.
  assert.ok(ids('3').includes(STEP));
  assert.deepEqual(stored, STORED, 'reading it changes nothing');
});

// A profile made with plain settings, its plan then replaced by the stored one.
const SIMPLE = { phase: '1', goal: 'minimal' };

test('the Docker server loads a stored plan with Phase 1-2 amplified lines unchanged', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-amplifier-'));
  let server = await createApp({ dataDir: dir, password: '' });
  const listen = async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise(resolve => server.close(resolve));
  let url = await listen();
  try {
    const created = (await (
      await fetch(url + '/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
        body: JSON.stringify({ saveName: 'S', name: 'P', settings: SIMPLE }),
      })
    ).json()) as { saveId: string; profileId: string };
    await close();
    const file = path.join(dir, 'workspace.json');
    const workspace = JSON.parse(await fsp.readFile(file, 'utf8'));
    workspace.saves[0].profiles[0].plan = structuredClone(STORED);
    await fsp.writeFile(file, JSON.stringify(workspace));
    server = await createApp({ dataDir: dir, password: '' });
    url = await listen();
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const reply = (await (await fetch(url + '/api/context', { headers })).json()) as ContextReply;
    assert.deepEqual(reply.plan, STORED, 'it loads with its numbers, Phase 1-2 lines included');
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition loads a stored plan with Phase 1-2 amplified lines unchanged', async () => {
  let workspace: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(workspace);
      if (!change) return copy as T;
      const result = change(copy);
      workspace = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, input => calculate(input), {} as Catalog);
  const created = (await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'S', name: 'P', settings: SIMPLE }),
    headers: {},
  })) as { saveId: string; profileId: string };
  workspace.saves[0]!.profiles[0]!.plan = structuredClone(STORED);
  const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
  const reply = (await api('/api/context', { headers })) as ContextReply;
  assert.deepEqual(reply.plan, STORED, 'it loads with its numbers, Phase 1-2 lines included');
});
