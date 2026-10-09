// The plan's recalculation offers recalculate the open profile in place (#1071), through the
// request Edit settings sends (POST /api/recalculate), in both editions: "Recalculate in place
// with items made on site" (settings.onSite), "… with exact clocks" (settings.exactClocks) and
// "… with transport fuel" (settings.transportFuel). Each keeps the profile's id and name, gives
// it the new plan and carries its progress from itself with every carry pick, as the new profile
// these offers used to create was carried: world records stay, a line that grew is left for
// review, and a central tick whose phase gains a factory's own line of its recipe is kept for
// review (onSiteReview, #876). The previous version is kept whole as a profile of its own right
// after it; a request made on a plan the profile no longer has is refused (409) and writes
// nothing. The buttons themselves are tested in tests/ui/recalc-offers.test.ts and beside each
// offer's own tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate, catalog } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { exactClocksChange, exactClocksSettings } from '../public/app/exact-clocks.ts';
import { recalculatedElsewhere } from '../public/state.ts';
import { roundsToWholeMachines } from '../planner/model.ts';
import type {
  BrowserWorkspace,
  ContextReply,
  FactoryGroups,
  StoredCalculatedPlan,
  StoredProfile,
  WorkspaceFile,
} from '../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22';
const WIRE = 'Recipe_Wire_C';
const key = (id: string) => 'calc-3-' + id;
const UNLOCK = 'unlock-Schematic_1-1_C';

// Alpha holds the Stator line, Beta the Cable line, and both make Wire on site.
const twoGroups = (): FactoryGroups => ({
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: ALPHA, rate: null }],
    Recipe_Cable_C: [{ group: BETA, rate: null }],
  },
  local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
});

interface Recalculated {
  saveId: string;
  profileId: string;
  backupId: string;
  reviewCount: number;
}

// One edition: a request (a refusal rejects with its status) and the save's stored profiles.
interface Edition {
  request: <T>(route: string, body?: unknown) => Promise<T>;
  refused: (route: string, body: unknown) => Promise<{ status: number; error: string }>;
  profiles: () => Promise<StoredProfile[]>;
}

// The offers, in the order the test presses them, each with the settings its button sends for
// the plan on screen, and what the recalculated plan must show of it.
const offers: {
  name: string;
  settings: (plan: StoredCalculatedPlan) => StoredCalculatedPlan['settings'];
  planned: (plan: StoredCalculatedPlan) => void;
}[] = [
  {
    name: 'items made on site',
    settings: plan => ({ ...plan.settings, onSite: onSiteSettings(plan, twoGroups()) }),
    planned: plan => {
      assert.deepEqual(plan.settings.onSite?.[ALPHA]?.items, ['Wire']);
      assert.ok(plan.stages['3'].rows!.some(row => row.id === `${WIRE}:${ALPHA}`));
    },
  },
  {
    name: 'exact clocks',
    settings: plan => {
      const line = plan.stages['3'].rows!.find(row => roundsToWholeMachines(row))!;
      return exactClocksSettings(plan.settings, { '3': [line.id] });
    },
    planned: plan => {
      assert.equal(plan.settings.exactClocks?.['3']?.length, 1);
      assert.equal(exactClocksChange(plan, { exactClocks: plan.settings.exactClocks }), null);
    },
  },
  {
    name: 'transport fuel',
    settings: plan => ({ ...plan.settings, transportFuel: { '3': { 'Packaged Fuel': 8 } } }),
    planned: plan => {
      assert.deepEqual(plan.settings.transportFuel, { '3': { 'Packaged Fuel': 8 } });
      assert.deepEqual(plan.stages['3'].transport, { 'Packaged Fuel': 8 });
    },
  },
];

// The previous version, kept as the backup: the stored profile as it was, under a new id and name.
function assertBackup(backup: StoredProfile | undefined, before: StoredProfile, name: string) {
  assert.ok(backup);
  assert.equal(backup.name, name);
  assert.notEqual(backup.id, before.id);
  assert.deepEqual({ ...backup, id: before.id, name: before.name }, before);
}

async function pressEachOffer(edition: Edition) {
  const created = await edition.request<Recalculated>('/api/profiles', {
    saveName: 'World',
    name: 'Main base',
    settings: BASE,
  });
  const context = () => edition.request<ContextReply>('/api/context');
  const first = await context();
  const ticked = first.plan!.stages['3'].rows!.map(row => key(row.id));
  assert.ok(ticked.includes(key(WIRE)), 'the plan makes Wire centrally');
  for (const check of [...ticked, UNLOCK])
    await edition.request('/api/update', { type: 'check', key: check, value: true });
  await edition.request('/api/update', { type: 'note', key: 'global', value: 'Keep me' });

  const backups: string[] = [];
  for (const [index, offer] of offers.entries()) {
    const before = await context();
    const stored = (await edition.profiles()).find(p => p.id === created.profileId)!;
    const backupName = `Main base (before edit ${index + 1}, Oct 9, 2:05 PM)`;
    const done = await edition.request<Recalculated>('/api/recalculate', {
      name: before.profile.name,
      backupName,
      settings: offer.settings(before.plan!),
      planCreatedAt: before.plan!.createdAt,
    });
    assert.equal(done.profileId, created.profileId, `${offer.name}: the profile keeps its id`);
    const after = await context();
    assert.equal(after.profile.id, created.profileId);
    assert.equal(after.profile.name, 'Main base', `${offer.name}: and its name`);
    assert.notEqual(after.plan!.createdAt, before.plan!.createdAt, 'a new plan');
    offer.planned(after.plan!);
    // Progress carried from itself: world records stay; a production line the new plan still
    // has keeps a tick or is left unticked for review.
    assert.equal(after.state.checks[UNLOCK], true, offer.name);
    assert.equal(after.state.notes.global, 'Keep me', offer.name);
    const kept = after
      .plan!.stages['3'].rows!.map(row => key(row.id))
      .filter(check => before.state.checks[check] === true);
    assert.ok(kept.length > 0, offer.name);
    for (const check of kept)
      assert.equal(typeof after.state.checks[check], 'boolean', `${offer.name}: ${check}`);
    assert.ok(
      kept.filter(check => after.state.checks[check] === false).length <= done.reviewCount,
      `${offer.name}: every tick not kept is counted for review`,
    );
    // The previous version, whole, right after the profile.
    backups.unshift(done.backupId);
    const profiles = await edition.profiles();
    assert.deepEqual(
      profiles.map(p => p.id),
      [created.profileId, ...backups],
      `${offer.name}: the backups sit right after the profile, the newest first`,
    );
    assertBackup(profiles[1], stored, backupName);
    if (offer.name === 'items made on site') {
      // The central Wire tick cannot land on one line: kept for review, and left unticked.
      assert.deepEqual(after.state.onSiteReview, { checks: { [key(WIRE)]: true } });
      assert.equal(after.state.checks[key(WIRE)], false);
      assert.ok(done.reviewCount >= 1);
    }
  }

  // A tab that still shows the plan before is refused, and nothing is written.
  const now = await context();
  const before = await edition.profiles();
  const stale = await edition.refused('/api/recalculate', {
    name: 'Main base',
    backupName: 'Main base (stale)',
    settings: now.plan!.settings,
    planCreatedAt: 'an earlier plan',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.error, recalculatedElsewhere);
  assert.deepEqual(await edition.profiles(), before);
}

test('each recalculation offer recalculates in place on the Docker server, keeping a backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-offers-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const send = (route: string, body?: unknown) =>
    fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    await pressEachOffer({
      async request<T>(route: string, body?: unknown) {
        const response = await send(route, body);
        assert.ok(response.ok, route + ' ' + (await response.clone().text()));
        return (await response.json()) as T;
      },
      async refused(route, body) {
        const response = await send(route, body);
        return {
          status: response.status,
          error: ((await response.json()) as { error: string }).error,
        };
      },
      async profiles() {
        const file = JSON.parse(
          await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'),
        ) as WorkspaceFile;
        return file.saves[0]!.profiles;
      },
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('each recalculation offer recalculates in place in the browser edition, keeping a backup', async () => {
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
  const api = createBrowserApi(store, calculate, catalog());
  const call = (route: string, body?: unknown) =>
    api(route, body === undefined ? {} : { body: JSON.stringify(body) });
  await pressEachOffer({
    request: async <T>(route: string, body?: unknown) => (await call(route, body)) as T,
    async refused(route, body) {
      try {
        await call(route, body);
      } catch (error) {
        return {
          status: (error as { status?: number }).status ?? 0,
          error: (error as Error).message,
        };
      }
      return { status: 200, error: '' };
    },
    profiles: async () => structuredClone(data.saves[0]!.profiles),
  });
});
