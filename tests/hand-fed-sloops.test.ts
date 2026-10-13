// The hand-fed constructors' somersloops wait for the MAM research Production Amplifier (#1150):
// machines take somersloops only once it is researched, from Phase 3 (AMPLIFIER_PHASE in
// public/somersloops.ts). Before, "Park somersloops in the hand-fed constructors" was listed in the
// profile's start phase, usually Phase 1, and no phase listed the research for it. Now the step is
// listed in the start phase or Phase 3, whichever is later, that phase needs the research, and the
// step's id stays `sloop-hand-fed`, so its tick carries: on a stored plan, and through a
// recalculation in place that moves the phase listing it, in both editions.
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
  guideContext,
  milestonesListedIn,
  phaseSteps,
  requiredMilestones,
} from '../public/progression.ts';
import { newProfileState, recalculatedProfile } from '../public/state.ts';
import { AMPLIFIER_WORDS, handFedPhase } from '../public/somersloops.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  CurrentCalculatedPlan,
  Progression,
  StageKey,
  StoredCalculatedPlan,
  StoredProfile,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const STEP = 'sloop-hand-fed';
const RESEARCH_ID = 'Research_Alien_ProductionBooster_C';
const RESEARCH = 'unlock-' + RESEARCH_ID;
const PHASES = ['1', '2', '3', '4', '5', 'post'];
// A Phase 1 profile with one somersloop parked in a hand-fed constructor and no amplification
// budget, so only the hand-fed step can bring the research in.
const SETTINGS = { phase: '1', goal: 'minimal', somersloops: 2, sloopReserved: ['shards'] };
const LATE = { ...SETTINGS, phase: '4' };

let early: CurrentCalculatedPlan | undefined, late: CurrentCalculatedPlan | undefined;
const phaseOne = () => (early ??= calculate(SETTINGS));
const phaseFour = () => (late ??= calculate(LATE));
const ids = (plan: StoredCalculatedPlan, phase: string, checks: Record<string, boolean> = {}) =>
  phaseSteps(plan, { checks }, data, phase).map(step => step.id);
// The phases whose build plan lists `id`.
const listing = (plan: StoredCalculatedPlan, id: string) =>
  PHASES.filter(phase => ids(plan, phase).includes(id));
const needs = (plan: StoredCalculatedPlan, phase: StageKey) =>
  requiredMilestones(guideContext(plan, { checks: {} }, data, phase)).some(
    entry => entry.id === RESEARCH_ID,
  );

test('the hand-fed step is listed from Phase 3, or a later start phase', () => {
  assert.equal(handFedPhase(1), 3);
  assert.equal(handFedPhase(2), 3);
  assert.equal(handFedPhase(3), 3);
  assert.equal(handFedPhase(4), 4);
  assert.equal(handFedPhase(5), 5);
});

test('a Phase 1 profile lists the hand-fed step in Phase 3, after the research it needs', () => {
  const plan = phaseOne();
  assert.equal(plan.settings.amplifySloops ?? 0, 0, 'no amplification budget');
  assert.deepEqual(listing(plan, STEP), ['3'], 'the step is listed in Phase 3 only');
  assert.deepEqual(listing(plan, RESEARCH), ['3'], 'and the research with it');
  const steps = phaseSteps(plan, { checks: {} }, data, '3');
  const research = steps.find(step => step.id === RESEARCH)!;
  assert.equal(research.title, 'MAM: Production Amplifier');
  assert.ok(!research.optional, 'Phase 3 needs it for the hand-fed step');
  assert.ok(
    steps.findIndex(step => step.id === RESEARCH) < steps.findIndex(step => step.id === STEP),
    'the research comes before the step that waits for it',
  );
  for (const phase of ['1', '2'] as const) assert.ok(!needs(plan, phase), `Phase ${phase}`);
  for (const phase of ['3', '4', '5'] as const) assert.ok(needs(plan, phase), `Phase ${phase}`);
  const step = steps.find(found => found.id === STEP)!;
  assert.equal(step.title, 'Park somersloops in the hand-fed constructors');
  assert.equal(
    step.body,
    'Reserve 1 Somersloop for a Constructor making Power Shards from power slugs — the world holds a fixed number of slugs, so an amplified Constructor is the difference between 2,650 and 5,301 shards for the whole save. Machines take somersloops once the MAM research Production Amplifier is done, from Phase 3 on. Insert the Somersloop in the Constructor, not the Crafting Bench: hand-crafting cannot be amplified, so anything you craft by hand is worth half. These lines are fed by hand and are deliberately left out of the continuous production balance — they reserve a somersloop and nothing else.',
  );
});

test('two hand-fed constructors say when they can start in the list too', () => {
  const plan = structuredClone(phaseOne());
  plan.settings.sloopReserved = ['shards', 'dna'];
  const step = phaseSteps(plan, { checks: {} }, data, '3').find(found => found.id === STEP)!;
  assert.ok(step.list!.after!.startsWith(AMPLIFIER_WORDS + ' Insert the Somersloop'));
  assert.ok(step.body.endsWith(step.list!.after!));
});

test('a Phase 4 profile lists the hand-fed step in Phase 4, the research in Phase 3', () => {
  const plan = phaseFour();
  assert.deepEqual(listing(plan, STEP), ['4']);
  // As for amplified lines (#1056): the research is listed in its own phase, here the
  // milestone-only Phase 3 before the start phase, and Phase 4 needs it.
  assert.deepEqual(listing(plan, RESEARCH), ['3']);
  assert.ok(milestonesListedIn(plan, { checks: {} }, data, 3).some(e => e.id === RESEARCH_ID));
  assert.ok(needs(plan, '4'));
});

test('without hand-fed constructors or amplification no phase lists the research', () => {
  const plan = structuredClone(phaseOne());
  plan.settings.sloopReserved = [];
  assert.deepEqual(listing(plan, STEP), []);
  assert.deepEqual(listing(plan, RESEARCH), []);
});

test('a tick on the hand-fed step carries to the phase that lists it now', () => {
  const plan = phaseOne(),
    before = structuredClone(plan);
  const checks = { [STEP]: true };
  assert.ok(ids(plan, '3', checks).includes(STEP), 'the ticked step is listed in Phase 3');
  assert.deepEqual(plan, before, 'reading the plan changes nothing');
});

// A profile on `plan` with the hand-fed step ticked, working on Phase 1.
const tickedProfile = (plan: StoredCalculatedPlan): StoredProfile => {
  const { state } = newProfileState(plan, null, null, undefined, undefined);
  return {
    id: 'p',
    name: 'P',
    kind: 'calculated',
    plan,
    state: { ...state, checks: { [STEP]: true } },
  };
};

test('recalculating in place keeps the tick when the phase listing the step changes', () => {
  // Phase 1 start (step in Phase 3) to Phase 4 start (step in Phase 4), and back.
  for (const [from, to] of [
    [phaseOne(), phaseFour()],
    [phaseFour(), phaseOne()],
  ] as const) {
    const { profile, backup } = recalculatedProfile(
      tickedProfile(structuredClone(from)),
      structuredClone(to),
      'P',
      undefined,
      undefined,
      'b',
      'B',
      data,
    );
    assert.equal(profile.state.checks[STEP], true, 'the tick carries');
    assert.equal(backup.state.checks[STEP], true, 'and the backup keeps it');
  }
});

// The hand-fed step's tick through the API of either edition: a stored plan loads unchanged with
// its tick, and a recalculation in place to a Phase 4 start, which moves the step from Phase 3 to
// Phase 4, keeps it.
async function throughApi(
  send: (route: string, body: unknown, ids?: Record<string, string>) => Promise<unknown>,
  context: (ids: Record<string, string>) => Promise<ContextReply>,
  reload: () => Promise<void>,
) {
  const created = (await send('/api/profiles', {
    saveName: 'World',
    name: 'Hand-fed',
    settings: SETTINGS,
  })) as { saveId: string; profileId: string };
  const scope = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
  await send('/api/update', { type: 'check', key: STEP, value: true }, scope);
  const before = await context(scope);
  await reload();
  const stored = await context(scope);
  assert.deepEqual(stored.plan, before.plan, 'the stored plan loads unchanged');
  assert.equal(stored.state.checks[STEP], true, 'with its tick');
  assert.deepEqual(listing(stored.plan!, STEP), ['3']);
  await send(
    '/api/recalculate',
    {
      name: 'Hand-fed',
      backupName: 'Hand-fed (before edit)',
      settings: LATE,
      planCreatedAt: before.plan!.createdAt,
    },
    scope,
  );
  const after = await context(scope);
  assert.deepEqual(listing(after.plan!, STEP), ['4'], 'the step moved to Phase 4');
  assert.equal(after.state.checks[STEP], true, 'and kept its tick');
}

test('the Docker server keeps the hand-fed tick on a stored plan and through a recalculation', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-1150-'));
  let server = await createApp({ dataDir: dir, password: '' });
  let url = '';
  const listen = async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise(resolve => server.close(resolve));
  await listen();
  try {
    await throughApi(
      async (route, body, scope = {}) => {
        const response = await fetch(url + route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...scope },
          body: JSON.stringify(body),
        });
        assert.ok(response.ok, await response.clone().text());
        return response.json();
      },
      async scope => (await fetch(url + '/api/context', { headers: scope })).json(),
      async () => {
        await close();
        server = await createApp({ dataDir: dir, password: '' });
        await listen();
      },
    );
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps the hand-fed tick on a stored plan and through a recalculation', async () => {
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
  const api = createBrowserApi(store, calculate, {} as Catalog, undefined, undefined, data);
  await throughApi(
    (route, body, scope = {}) => api(route, { body: JSON.stringify(body), headers: scope }),
    async scope => (await api('/api/context', { headers: scope })) as ContextReply,
    async () => {},
  );
});
