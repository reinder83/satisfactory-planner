// The guided start's "What you already have" (#1068, ui/guided/GuidedHave.vue) sends what All
// settings and Review send: settings.ownedMiner, ownedBelt and ownedAlternates, and the steps
// "Everything before Phase N is done" and the owned alternates tick as the new profile's `built`
// work. Nothing new is stored, so both editions must create the same profile from the same
// answers, and a skipped screen leaves every field absent in both, as before the screen existed.
// The screen itself is covered in tests/ui/guided-have.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate } from '../planner.ts';
import { alternateHunts, ownedAlternateKeys, stepsBeforeStart } from '../public/progression.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  Progression,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// A hard-drive alternate available from Phase 2 that a Phase 3 plan uses once it may.
const SCREW = 'Recipe_Alternate_Screw_2_C';
// A new save's guided start for Phase 3, as freshSettings starts it (mining per phase on).
const GUIDED = { phase: '3', goal: 'minimal', phaseMining: true };
// The same start with every "What you already have" answer given.
const ANSWERED = { ...GUIDED, ownedMiner: 3, ownedBelt: 5, ownedAlternates: [SCREW] };

// What createProfile sends as `built` for those answers (alreadyHaveKeys in wizard/wizard.ts):
// the steps before the start phase, and the owned recipe's unlock step with any hunt it empties.
function builtFor(settings: typeof GUIDED | typeof ANSWERED, earlierDone: boolean) {
  const plan = calculate(settings);
  const owned = new Set(
    ('ownedAlternates' in settings ? settings.ownedAlternates : []).map(
      id => `recipe-unlock-${id}`,
    ),
  );
  return [
    ...(earlierDone ? stepsBeforeStart(plan, { checks: {} }, data) : []),
    ...(owned.size ? ownedAlternateKeys(alternateHunts(plan, data), owned) : []),
  ];
}

const request = (settings: object, built: string[]) => ({
  saveId: null,
  saveName: 'World',
  name: 'Guided',
  settings,
  carryFrom: null,
  carry: {},
  built,
});

// The profile the Docker server creates from `body`, as /api/context returns it.
async function dockerProfile(body: object): Promise<ContextReply> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-guided-have-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const created = await fetch(url + '/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
    assert.ok(created.ok, await created.clone().text());
    const { saveId, profileId } = (await created.json()) as { saveId: string; profileId: string };
    const context = await fetch(url + '/api/context', {
      headers: { 'X-Save-Id': saveId, 'X-Profile-Id': profileId },
    });
    assert.ok(context.ok);
    return (await context.json()) as ContextReply;
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// The profile the browser edition creates from `body`.
async function browserProfile(body: object): Promise<ContextReply> {
  let stored: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (workspace: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(stored);
      if (!change) return copy as T;
      const result = change(copy);
      stored = copy;
      return structuredClone(result);
    },
  };
  // The Catalog is not read by these routes.
  const api = createBrowserApi(store, calculate, {} as Catalog);
  await api('/api/profiles', { body: JSON.stringify(body) });
  return (await api('/api/context')) as ContextReply;
}

// The parts of a new profile both editions must agree on: the plan's settings and the progress.
const created = (context: ContextReply) => ({
  settings: context.plan!.settings,
  checks: context.state.checks,
});

test('the guided answers create the same profile in both editions', async () => {
  const built = builtFor(ANSWERED, true);
  assert.ok(built.length >= 17, 'the earlier steps and the owned recipe');
  assert.ok(built.includes(`recipe-unlock-${SCREW}`));
  const docker = await dockerProfile(request(ANSWERED, built));
  const browser = await browserProfile(request(ANSWERED, built));
  assert.deepEqual(created(browser), created(docker));
  const { settings, checks } = created(docker);
  assert.equal(settings.ownedMiner, 3);
  assert.equal(settings.ownedBelt, 5);
  assert.deepEqual(settings.ownedAlternates, [SCREW]);
  assert.equal(settings.phaseMining, true);
  for (const key of built) assert.equal(checks[key], true, key);
  // The plan mines Phase 3 with what was owned: Miner Mk.3 and Mk.5 belts.
  assert.equal(docker.plan!.stages['3']!.mining!.miner.mark, 3);
  assert.equal(docker.plan!.stages['3']!.mining!.belt.mark, 'Mk.5');
});

test('a skipped "What you already have" creates the profile it made before, in both editions', async () => {
  const docker = await dockerProfile(request(GUIDED, []));
  const browser = await browserProfile(request(GUIDED, []));
  assert.deepEqual(created(browser), created(docker));
  for (const field of ['ownedMiner', 'ownedBelt', 'ownedAlternates'])
    assert.equal(field in docker.plan!.settings, false, field);
  assert.deepEqual(docker.state.checks, {});
  assert.equal(docker.plan!.stages['3']!.mining!.miner.mark, 2, 'Phase 3’s own Miner Mk.2');
  assert.equal(docker.plan!.stages['3']!.mining!.belt.mark, 'Mk.4');
});
