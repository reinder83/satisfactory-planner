// The profile's detail level (ONB-2, #1337): the progress state's `detailLevel` (state version
// 31), Beginner, Standard or Expert, in place of the browser's two switches "New to Satisfactory"
// and "Expert mode". Every released format loads unchanged and gains no level (such a profile
// follows the browser's level, migrated from the two switches in app/detail-level.ts, tested in
// tests/ui/detail-level.test.ts); an upgrade from 30, 27 and 1 keeps everything else; anything but
// the three levels is refused; a version-30 planner's limit refuses a version-31 state with the
// update message (as this one refuses 32). The detailLevel update sets it; a new profile takes the
// wizard's level and nothing from the profile it carries from; a recalculation in place keeps the
// profile's or takes Edit settings'; a share leaves it behind. Both editions keep it through a
// reload, a full export and import (into the other edition too), a progress backup and its
// restore, and a recalculation in place, and serve a version-30 record as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  calculatedProfile,
  checkBase,
  DETAIL_LEVELS,
  detailLevelOf,
  mutate,
  newProfileState,
  recalculatedProfile,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version1, version27, version30, version31 } from './types/fixtures.ts';
import type {
  DetailLevel,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  StoredProfile,
  UpdateOp,
  WorkspaceSummary,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const level = (value: DetailLevel): UpdateOp => ({ type: 'detailLevel', value });

test('the detail level is state version 31; every released format loads unchanged', () => {
  assert.deepEqual(DETAIL_LEVELS, ['beginner', 'standard', 'expert']);
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 31) assert.equal('detailLevel' in clean, false, `version ${version}`);
  }
  const clean = validateState(json(version31));
  assert.equal(clean.version, 31);
  assert.equal(clean.detailLevel, 'expert');
  assert.deepEqual(validateState(json(clean)), clean, 'a repeated load changes nothing');
  // From version 30 (#1284), 27 (#1283) and 1: the level comes on top, everything else as it was.
  for (const older of [version30, version27, version1]) {
    const before = validateState(json(older));
    for (const detailLevel of DETAIL_LEVELS) {
      const upgraded = validateState(json({ ...older, detailLevel }));
      assert.equal(upgraded.version, 31, detailLevel);
      assert.equal(upgraded.detailLevel, detailLevel);
      const { detailLevel: _level, ...rest } = upgraded;
      assert.deepEqual({ ...rest, version: before.version }, before);
    }
  }
});

test('anything but the three levels is refused, and a newer version with the update message', () => {
  for (const bad of ['Expert', 'master', '', null, 1, true, ['expert'], { level: 'expert' }])
    assert.throws(
      () => validateState(json({ ...version30, detailLevel: bad })),
      /Invalid detail level/,
      JSON.stringify(bad),
    );
  // What a request sends is read leniently: anything else is left out.
  assert.equal(detailLevelOf('beginner'), 'beginner');
  for (const bad of ['Expert', undefined, null, 3]) assert.equal(detailLevelOf(bad), undefined);
  // A version-30 planner accepts versions up to 30 and refuses a higher one with the update
  // message, never dropping what it does not know; this one does the same above 31.
  assert.throws(
    () => validateState({ ...json(version31), version: 32 }),
    /newer planner version\. Update the app/,
  );
  assert.throws(() => validateState({ ...json(version31), version: '32' }), /Update the app/);
});

test('the detailLevel update sets one level, refuses others, and is never refused as stale', () => {
  const start = validateState(json(version30));
  const picked = mutate(json(start), level('beginner'));
  assert.equal(picked.detailLevel, 'beginner');
  assert.equal(picked.version, 31);
  assert.equal(mutate(json(picked), level('standard')).detailLevel, 'standard');
  assert.equal(mutate(json(picked), level('expert')).detailLevel, 'expert');
  for (const bad of [{ type: 'detailLevel' }, { type: 'detailLevel', value: 'Novice' }])
    assert.throws(() => mutate(json(start), bad as UpdateOp), /Invalid detail level/);
  // One value: a stale tab can only pick a level, so no revision is compared.
  const current = { ...validateState(json(version31)), revision: 4 };
  assert.doesNotThrow(() => checkBase(current, level('standard'), '2'));
});

// A plan to carry with: the planner's own, for the carry functions below.
const PLAN: StoredCalculatedPlan = calculate({ phase: '3', recipes: 'standard' });

test('a new profile takes the wizard’s level only; a recalculation keeps or takes one; a share drops it', () => {
  const source = validateState(json(version31));
  // Carried from a profile at Expert with every carry option: the level is not carried.
  const carried = newProfileState(
    null,
    json(source),
    null,
    { notes: true, planEdits: true },
    undefined,
  ).state;
  assert.equal('detailLevel' in carried, false);
  // calculatedProfile (/api/profiles) stores the wizard's level, versioned; anything else is
  // left out, so the profile follows the browser's.
  for (const detail of DETAIL_LEVELS) {
    const made = calculatedProfile('p1', 'New', PLAN, null, {}, [], undefined, detail);
    assert.equal(made.profile.state.detailLevel, detail);
    assert.equal(made.profile.state.version, 31);
  }
  for (const detail of [undefined, 'master', 2]) {
    const made = calculatedProfile('p1', 'New', PLAN, null, {}, [], undefined, detail);
    assert.equal('detailLevel' in made.profile.state, false, String(detail));
    assert.ok(made.profile.state.version < 31);
  }
  // recalculatedProfile (/api/recalculate): the profile's own level, or the one Edit settings sent.
  const profile: StoredProfile = {
    id: 'p1',
    name: 'Old',
    kind: 'calculated',
    plan: PLAN,
    state: source,
  };
  const kept = recalculatedProfile(profile, PLAN, 'Old', {}, [], 'b1', 'Old (before edit)');
  assert.equal(kept.profile.state.detailLevel, 'expert');
  assert.equal(kept.profile.state.version, 31);
  assert.equal(kept.backup.state.detailLevel, 'expert', 'the kept version as it was');
  const changed = recalculatedProfile(
    profile,
    PLAN,
    'Old',
    {},
    [],
    'b1',
    'Old (before edit)',
    undefined,
    undefined,
    'beginner',
  );
  assert.equal(changed.profile.state.detailLevel, 'beginner');
  const legacy: StoredProfile = { ...profile, state: validateState(json(version30)) };
  const without = recalculatedProfile(legacy, PLAN, 'Old', {}, [], 'b1', 'Old (before edit)');
  assert.equal('detailLevel' in without.profile.state, false, 'still follows the browser');
  // A share is how the sharer looks at the plan: the copy follows the recipient's own level.
  const shared = shareState(json(source));
  assert.equal('detailLevel' in shared, false);
  assert.equal(shared.version, 30);
});

// Both editions: the level is stored with a new profile, saved, kept through a reload, a full
// export and import, a progress backup and its restore, and a recalculation in place.
const BASE = { phase: '3', recipes: 'standard' };
type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', {
    saveName: 'World',
    name: 'Detailed',
    settings: BASE,
    detailLevel: 'beginner',
  });
  const created = await context();
  assert.equal(created.state.detailLevel, 'beginner', 'the wizard’s level');
  assert.equal(created.state.version, 31);
  await request('/api/update', level('expert'));
  await reload();
  const after = await context();
  assert.equal(after.state.detailLevel, 'expert');
  // A full export carries it and an import brings it back on the copy.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.equal(validateTransfer(exported).saves[0]!.profiles[0]!.state.detailLevel, 'expert');
  await request('/api/import-saves', exported);
  const summary = (await request('/api/workspace')) as WorkspaceSummary;
  assert.equal(summary.saves.length, 2);
  // The progress backup and its restore.
  const backup = (await request('/api/export')) as { state: ProgressState };
  assert.equal(backup.state.detailLevel, 'expert');
  await request('/api/update', level('standard'));
  assert.equal((await context()).state.detailLevel, 'standard');
  await request('/api/import', backup);
  const restored = await context();
  assert.equal(restored.state.detailLevel, 'expert');
  // A recalculation in place keeps it; one from Edit settings takes the level it showed.
  const recalculate = async (extra: object) => {
    const before = await context();
    await request('/api/recalculate', {
      name: 'Detailed',
      backupName: 'Detailed (before edit)',
      settings: before.plan.settings,
      planCreatedAt: before.plan.createdAt,
      carry: {},
      ...extra,
    });
    return context();
  };
  assert.equal((await recalculate({})).state.detailLevel, 'expert');
  assert.equal((await recalculate({ detailLevel: 'beginner' })).state.detailLevel, 'beginner');
  // A request without a level makes a profile without one, which follows the browser's.
  await request('/api/profiles', { saveName: 'Plain', name: 'Plain', settings: BASE });
  assert.equal('detailLevel' in (await context()).state, false);
  return exported;
}

async function dockerEdition<T>(
  run: (
    request: (route: string, body?: unknown) => Promise<unknown>,
    reload: () => Promise<void>,
  ) => Promise<T>,
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-detail-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (res.ok ? '' : await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    return await run(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
const browserEdition = (records = new Map<string, unknown>()) => {
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  return {
    records,
    request: (route: string, body?: unknown) =>
      api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    reload: async () => {
      api = open();
    },
  };
};

test('the Docker server keeps the level, and a browser edition imports its export', async () => {
  const exported = await dockerEdition(checkEdition);
  const browser = browserEdition();
  await browser.request('/api/import-saves', exported);
  const stored = (
    browser.records.get('main') as { saves: { profiles: { state: ProgressState }[] }[] }
  ).saves[0]!.profiles[0]!.state;
  assert.equal(stored.detailLevel, 'expert');
  assert.equal(stored.version, 31);
});

test('the browser edition keeps the level, and the Docker server imports its export', async () => {
  const browser = browserEdition();
  const exported = await checkEdition(browser.request, browser.reload);
  await dockerEdition(async request => {
    await request('/api/import-saves', exported);
    // The server had no save, so the imported copy is the one open.
    const { state } = (await request('/api/context')) as { state: ProgressState };
    assert.equal(state.detailLevel, 'expert');
  });
});

// The browser edition serves stored progress without validateState (AGENTS.md): a version-31
// record keeps its level and a version-30 one loads as it was, without one.
test('the browser edition loads stored progress of version 30 and 31 unchanged', async () => {
  for (const state of [version30, version31]) {
    const browser = browserEdition();
    await browser.request('/api/profiles', { saveName: 'World', name: 'Old', settings: BASE });
    const main = browser.records.get('main') as { saves: { profiles: { state: unknown }[] }[] };
    main.saves[0]!.profiles[0]!.state = json(state);
    await browser.reload();
    const loaded = (await browser.request('/api/context')) as Context;
    assert.deepEqual(loaded.state, validateState(json(state)));
    assert.equal(loaded.state.version, state.version);
  }
});
