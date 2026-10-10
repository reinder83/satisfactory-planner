// A recalculation in place (Edit settings, "Recalculate in place", #1071) keeps the ticks of every
// build-plan step the new plan still lists, and the phase worked on (#1112): the Space Elevator,
// the mining, retirement and delivery steps, the augmenters and the hand-fed somersloops. A step
// the new plan no longer lists loses its tick, and the backup keeps everything as it was. A new
// profile (a fresh one, or "Try another profile" carrying from a sibling) still starts from the
// world facts only, as it always did.
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
import { phaseSteps } from '../public/progression.ts';
import { newProfileState, recalculatedProfile } from '../public/state.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  Progression,
  StoredCalculatedPlan,
  StoredProfile,
  WorkspaceFile,
} from '../public/types/index.ts';

const progression = JSON.parse(
  readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
) as Progression;

// A Phase 1 plan with mining per phase, two augmenters and a hand-fed somersloop, so its build plan
// lists every kind of step. The edit drops the augmenters, so their step goes.
const SETTINGS = {
  phase: '1',
  goal: 'minimal',
  phaseMining: true,
  augmenters: 2,
  sloopReserved: ['shards'],
};
const EDITED = { ...SETTINGS, goal: 'balanced', augmenters: 0 };
// Ticked before the edit: steps the edited plan still lists, the augmenter step it drops, and
// world records the carry always kept.
const KEPT = [
  'space-elevator',
  'mining-1',
  'mining-3',
  'retire-3',
  'retire-4',
  'sloop-hand-fed',
  'deliver-1',
  'deliver-3',
  'calc-1-storage',
];
const DROPPED = ['alien-power-augmenter'];
const WORLD = ['unlock-Schematic_1-1_C', 'startup-biomass'];
const WORKING = '4';

// Every step id a plan's build plan lists, over all its phases.
const listed = (plan: StoredCalculatedPlan) =>
  new Set(
    ['1', '2', '3', '4', '5', 'post'].flatMap(phase =>
      phaseSteps(plan, { checks: {}, settings: { phase: WORKING } }, progression, phase).map(
        step => step.id,
      ),
    ),
  );

// The previous version, kept as the backup: the stored profile as it was, under a new id and name.
function assertBackup(backup: StoredProfile, before: StoredProfile, name: string) {
  assert.equal(backup.name, name);
  // Linked to the profile it was kept for, so it can be restored (#1071).
  const { backupOf, ...copy } = backup;
  assert.equal(backupOf, before.id, 'linked to the profile it was kept for');
  assert.deepEqual({ ...copy, id: before.id, name: before.name }, before);
}

// What both editions must show after the recalculation in place.
function assertKept(after: ContextReply) {
  const steps = listed(after.plan!);
  for (const key of KEPT) {
    assert.ok(steps.has(key), key + ' is a step of the edited plan');
    assert.equal(after.state.checks[key], true, key + ' stays ticked');
  }
  for (const key of DROPPED) {
    assert.equal(steps.has(key), false, key + ' is not a step of the edited plan');
    assert.equal(after.state.checks[key], undefined, key + ' is not carried');
  }
  for (const key of WORLD) assert.equal(after.state.checks[key], true, key);
  assert.equal(after.state.settings.phase, WORKING, 'the phase worked on stays');
}

test('the Docker server keeps step ticks and the phase worked on when recalculating in place', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-1112-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const send = (endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
  const ok = async <T>(response: Response): Promise<T> => {
    assert.ok(response.ok, await response.clone().text());
    return response.json() as Promise<T>;
  };
  const stored = async () =>
    JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')) as WorkspaceFile;
  try {
    const first = await ok<{ saveId: string; profileId: string }>(
      await send('/api/profiles', { saveName: 'World', name: 'Minimal', settings: SETTINGS }),
    );
    const headers = { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId };
    const context = async () => ok<ContextReply>(await fetch(url + '/api/context', { headers }));
    for (const key of [...KEPT, ...DROPPED, ...WORLD])
      await ok(await send('/api/update', { type: 'check', key, value: true }, headers));
    await ok(await send('/api/update', { type: 'phase', value: WORKING }, headers));
    const before = await context();
    const storedBefore = (await stored()).saves[0]!.profiles[0]!;

    // "Try another profile" from it: a new profile starts from the world facts, as before.
    const sibling = await ok<{ profileId: string }>(
      await send('/api/profiles', {
        saveId: first.saveId,
        name: 'Sibling',
        settings: EDITED,
        carryFrom: first.profileId,
      }),
    );
    const fresh = await ok<ContextReply>(
      await fetch(url + '/api/context', {
        headers: { 'X-Save-Id': first.saveId, 'X-Profile-Id': sibling.profileId },
      }),
    );
    for (const key of [...KEPT, ...DROPPED])
      assert.equal(fresh.state.checks[key], undefined, key + ' is not a world fact');
    for (const key of WORLD) assert.equal(fresh.state.checks[key], true, key);
    assert.equal(fresh.state.settings.phase, '1', 'a new profile opens on its start phase');

    const done = await ok<{ backupId: string }>(
      await send(
        '/api/recalculate',
        {
          name: 'Balanced',
          backupName: 'Minimal (before edit)',
          settings: EDITED,
          planCreatedAt: before.plan!.createdAt,
        },
        headers,
      ),
    );
    assertKept(await context());
    const profiles = (await stored()).saves[0]!.profiles;
    assert.equal(profiles[1]!.id, done.backupId);
    assertBackup(profiles[1]!, storedBefore, 'Minimal (before edit)');
    for (const key of [...KEPT, ...DROPPED, ...WORLD])
      assert.equal(profiles[1]!.state.checks[key], true, key + ' stays in the backup');
    assert.equal(profiles[1]!.state.settings.phase, WORKING);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps step ticks and the phase worked on when recalculating in place', async () => {
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
  const api = createBrowserApi(store, calculate, {} as Catalog, undefined, undefined, progression),
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const first = (await post('/api/profiles', {
    saveName: 'World',
    name: 'Minimal',
    settings: SETTINGS,
  })) as { saveId: string; profileId: string };
  for (const key of [...KEPT, ...DROPPED, ...WORLD])
    await post('/api/update', { type: 'check', key, value: true });
  await post('/api/update', { type: 'phase', value: WORKING });
  const before = (await api('/api/context')) as ContextReply;
  const storedBefore = structuredClone(data.saves[0]!.profiles[0]!);

  const sibling = (await post('/api/profiles', {
    saveId: first.saveId,
    name: 'Sibling',
    settings: EDITED,
    carryFrom: first.profileId,
  })) as { profileId: string };
  const fresh = (await api('/api/context', {
    headers: { 'X-Save-Id': first.saveId, 'X-Profile-Id': sibling.profileId },
  })) as ContextReply;
  for (const key of [...KEPT, ...DROPPED]) assert.equal(fresh.state.checks[key], undefined, key);
  assert.equal(fresh.state.settings.phase, '1');

  const done = (await api('/api/recalculate', {
    headers: { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId },
    body: JSON.stringify({
      name: 'Balanced',
      backupName: 'Minimal (before edit)',
      settings: EDITED,
      planCreatedAt: before.plan!.createdAt,
    }),
  })) as { backupId: string };
  assertKept(
    (await api('/api/context', {
      headers: { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId },
    })) as ContextReply,
  );
  const backup = data.saves[0]!.profiles.find(profile => profile.id === done.backupId)!;
  assertBackup(backup, storedBefore, 'Minimal (before edit)');
});

// Plans for the phase rule: only the start phase and the guide matter.
let base: StoredCalculatedPlan | undefined;
const planFor = (phase: string, guide = false): StoredCalculatedPlan => {
  base ??= calculate(SETTINGS);
  return {
    ...structuredClone(base),
    settings: { ...base.settings, phase: phase as '1' },
    ...(guide ? { guide: { phases: {} } } : {}),
  };
};
const profileOn = (phase: string, plan: StoredCalculatedPlan): StoredProfile => ({
  id: 'p',
  name: 'P',
  kind: 'calculated',
  plan,
  state: {
    ...newProfileState(plan, null, null, undefined, undefined).state,
    settings: { phase: phase as '1' },
  },
});
const phaseAfter = (working: string, from: StoredCalculatedPlan, to: StoredCalculatedPlan) =>
  recalculatedProfile(
    profileOn(working, from),
    to,
    'P',
    undefined,
    undefined,
    'b',
    'B',
    progression,
  ).profile.state.settings.phase;

test('the phase worked on stays unless the edit moved the start phase past it', () => {
  assert.equal(phaseAfter('4', planFor('3'), planFor('3')), '4', 'a later phase stays');
  assert.equal(phaseAfter('post', planFor('3'), planFor('5')), 'post', 'Post Phase 5 stays');
  assert.equal(phaseAfter('3', planFor('3'), planFor('2')), '3', 'an earlier start keeps it');
  assert.equal(phaseAfter('4', planFor('3'), planFor('5')), '5', 'raised to a later start');
  assert.equal(
    phaseAfter('2', planFor('3'), planFor('3')),
    '2',
    'a milestone-only phase the user was on stays milestone-only, and stays',
  );
  assert.equal(
    phaseAfter('2', planFor('3', true), planFor('3', true)),
    '3',
    'a plan with a guide offers nothing before its start phase',
  );
});
