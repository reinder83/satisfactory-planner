// Retiring the handbook, part 4a (#495): on opening the workspace, the server keeps
// workspace.json as it was in workspace.json.pre-handbook, then migrates every original profile
// into a calculated one in one write. One without its own handbook uses the frozen copy in
// migrations/, which neither the Docker edition's public files nor the Pages build contain.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../workspace.ts';
import { initialState, mutate, validateState } from '../server.ts';
import { handbookToPlan, migrateHandbookState } from '../public/handbook-migration.ts';
import { catalog } from '../planner.ts';
import frozenJson from '../migrations/handbook-2026-09-13.json' with { type: 'json' };
import recipesJson from '../recipes.json' with { type: 'json' };
import type { Handbook, Recipe, StoredProfile, WorkspaceFile } from '../public/types/index.ts';

const frozen = frozenJson as unknown as Handbook;
const recipes = (recipesJson as unknown as { recipes: Recipe[] }).recipes;
const conversion = handbookToPlan(frozen, recipes, catalog().pureLimits);
const factory = frozen.factories.find(f => conversion.rows['3']![f.id])!;
const row = conversion.rows['3']![factory.id]!;

const open = (dataDir: string) => openWorkspace({ dataDir, initialState, validateState, mutate });
const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'planner-handbook-'));
const read = async (d: string, name = 'workspace.json') => fs.readFile(path.join(d, name), 'utf8');
const profile = (id: string, extra: Partial<StoredProfile> = {}): StoredProfile => ({
  id,
  name: 'Original · ' + id,
  kind: 'original',
  state: {
    ...initialState(),
    checks: { ['factory-3-' + factory.id]: true, 'phase-3-survey': true },
    notes: { ['factory-' + factory.id]: 'By the lake', global: 'My world' },
  },
  ...extra,
});
// A calculated profile, which the migration leaves exactly as it is.
const calculated: StoredProfile = {
  id: 'calc',
  name: 'Balanced',
  kind: 'calculated',
  plan: conversion.plan,
  state: { ...initialState(), checks: { ['factory-3-' + factory.id]: true } },
};
const workspace = (): WorkspaceFile => ({
  version: 2,
  revision: 7,
  accountsEnabled: true,
  registration: false,
  users: [
    { id: 'owner', username: 'Owner', password: 'salt:hash', activeSave: 'save-a' },
    { id: 'u2', username: 'Friend', password: 'salt:hash2', activeSave: 'save-b' },
  ],
  saves: [
    {
      id: 'save-a',
      name: 'Owner world',
      userId: 'owner',
      activeProfile: 'original',
      profiles: [profile('original'), calculated],
    },
    {
      id: 'save-b',
      name: 'Friend world',
      userId: 'u2',
      activeProfile: 'theirs',
      profiles: [profile('theirs')],
    },
  ],
  sessions: [{ hash: 'abc', userId: 'u2', expires: 4102444800000 }],
});
const write = async (d: string, w: unknown) => {
  const raw = JSON.stringify(w);
  await fs.writeFile(path.join(d, 'workspace.json'), raw);
  return raw;
};

test('a direct upgrade migrates every original profile and keeps the file as it was', async () => {
  const d = await dir();
  const raw = await write(d, workspace());
  await open(d);
  assert.equal(await read(d, 'workspace.json.pre-handbook'), raw, 'the pre-migration copy');
  const db = JSON.parse(await read(d)) as WorkspaceFile;
  const before = workspace();
  assert.equal(db.revision, 8);
  for (const [i, save] of db.saves.entries()) {
    const old = before.saves[i]!;
    // Ownership and account isolation are kept: the same users, sessions, saves and owners.
    assert.equal(save.userId, old.userId);
    assert.equal(save.activeProfile, old.activeProfile);
    assert.deepEqual(
      save.profiles.map(p => [p.id, p.name]),
      old.profiles.map(p => [p.id, p.name]),
    );
    const p = save.profiles[0]!;
    assert.equal(p.kind, 'calculated');
    assert.equal('handbook' in p, false);
    assert.deepEqual(p.plan, conversion.plan);
    assert.deepEqual(p.state, migrateHandbookState(old.profiles[0]!.state, frozen, conversion));
    assert.equal(p.state.checks['calc-3-' + row], true);
    assert.equal(p.state.notes['factory-' + row], 'By the lake');
  }
  assert.deepEqual(db.saves[0]!.profiles[1], calculated, 'a calculated profile is untouched');
  assert.deepEqual(db.users, before.users);
  assert.deepEqual(db.sessions, before.sessions);
  assert.equal(db.accountsEnabled, true);
});

test('starting again changes nothing', async () => {
  const d = await dir();
  const raw = await write(d, workspace());
  await open(d);
  const once = await read(d);
  await open(d);
  assert.equal(await read(d), once, 'workspace.json is not written again');
  assert.equal(await read(d, 'workspace.json.pre-handbook'), raw);
  // A workspace without original profiles never gets a pre-migration copy.
  const e = await dir();
  const w = workspace();
  for (const s of w.saves) s.profiles = [calculated];
  for (const s of w.saves) s.activeProfile = 'calc';
  await write(e, w);
  const plain = await read(e);
  await open(e);
  assert.equal(await read(e), plain);
  await assert.rejects(read(e, 'workspace.json.pre-handbook'), { code: 'ENOENT' });
});

test('a crash mid-write keeps the pre-migration copy, and the next start finishes', async () => {
  const d = await dir();
  const raw = await write(d, workspace());
  const rename = mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('crash'), { code: 'EIO' });
  });
  try {
    await assert.rejects(open(d), /crash/);
  } finally {
    rename.mock.restore();
  }
  assert.equal(await read(d), raw, 'workspace.json is as it was');
  assert.equal(await read(d, 'workspace.json.pre-handbook'), raw);
  await open(d);
  assert.equal(await read(d, 'workspace.json.pre-handbook'), raw, 'never replaced');
  const db = JSON.parse(await read(d)) as WorkspaceFile;
  assert.ok(db.saves.every(s => s.profiles.every(p => p.kind === 'calculated')));
});

test('a profile with its own handbook migrates with that one', async () => {
  const own = structuredClone(frozen);
  own.version = '2026-08-01';
  const renamed = own.factories.find(f => f.id === factory.id)!;
  renamed.id = 'renamed-factory';
  const w = workspace();
  const p = profile('original', { handbook: own });
  p.state.checks = { 'factory-3-renamed-factory': true, ['factory-3-' + factory.id]: true };
  w.saves[0]!.profiles[0] = p;
  const d = await dir();
  await write(d, w);
  await open(d);
  const db = JSON.parse(await read(d)) as WorkspaceFile;
  const m = db.saves[0]!.profiles[0]!;
  assert.equal('handbook' in m, false);
  assert.equal(m.plan!.engine, 'handbook-2026-08-01');
  assert.equal(m.state.checks['calc-3-' + row], true, 'its own factory id');
  // The frozen handbook's id is no factory of this one, so its tick is kept for review.
  assert.equal(m.state.handbookOrigin!.unmapped.checks['factory-3-' + factory.id], true);
  assert.equal(db.saves[1]!.profiles[0]!.plan!.engine, 'handbook-' + frozen.version);
});

test('a skipped-version upgrade: a single-profile progress.json of an early release', async () => {
  const d = await dir();
  // Content version 1, before workspace.json existed: handbook progress, factory ticks included.
  const old = {
    version: 1,
    checks: { ['factory-3-' + factory.id]: true, 'storage-ground-shell': true },
    notes: { ['factory-' + factory.id]: 'Old note' },
    deliveries: {},
    customTasks: [],
    settings: { phase: '4' },
  };
  await fs.writeFile(path.join(d, 'progress.json'), JSON.stringify(old));
  await open(d);
  const db = JSON.parse(await read(d)) as WorkspaceFile;
  const p = db.saves[0]!.profiles[0]!;
  assert.equal(p.id, 'original');
  assert.equal(p.kind, 'calculated');
  assert.equal(p.state.checks['calc-3-' + row], true);
  assert.equal(p.state.notes['factory-' + row], 'Old note');
  assert.equal(p.state.settings.phase, '4');
  // progress.json itself is the pre-migration copy; no other is written.
  assert.deepEqual(JSON.parse(await read(d, 'progress.json')), old);
  await assert.rejects(read(d, 'workspace.json.pre-handbook'), { code: 'ENOENT' });
});

test("a migrated profile's Phase 5 is not over budget on Nitrogen Gas (the pureLimits base)", () => {
  const limits = conversion.plan.settings.limits!;
  const used = conversion.plan.stages['5'].raw!['Nitrogen Gas'] ?? 0;
  assert.ok(used > 0, 'Phase 5 uses Nitrogen Gas');
  assert.ok(limits['Nitrogen Gas']! >= used, `${used} within ${limits['Nitrogen Gas']}`);
});

test('the frozen handbook is in neither the Docker public files nor the Pages build', () => {
  const r = spawnSync(process.execPath, ['build.ts'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
    );
  for (const out of ['dist/web', 'dist/satisfactory-planner'])
    for (const f of walk(out))
      assert.doesNotMatch(f.replaceAll('\\', '/'), /migrations|handbook-2026-09-13/, f);
  // The image copies migrations/ next to workspace.ts, outside the public/ it serves.
  const docker = readFileSync('Dockerfile', 'utf8');
  assert.match(docker, /^COPY --chown=node:node migrations \.\/migrations$/m);
});
