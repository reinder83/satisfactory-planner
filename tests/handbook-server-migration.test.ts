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
import type { StoredProfile, WorkspaceFile } from '../public/types/index.ts';
import { frozenHandbook as frozen, recipes } from './helpers/data.ts';

const conversion = handbookToPlan(frozen, recipes, catalog().pureLimits);
const factory = frozen.factories.find(f => conversion.rows['3']![f.id])!;
const row = conversion.rows['3']![factory.id]!;

const open = (dataDir: string) => openWorkspace({ dataDir, validateState, mutate });
const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'planner-handbook-'));
const read = async (dataDir: string, name = 'workspace.json') =>
  fs.readFile(path.join(dataDir, name), 'utf8');
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
const write = async (dataDir: string, content: unknown) => {
  const raw = JSON.stringify(content);
  await fs.writeFile(path.join(dataDir, 'workspace.json'), raw);
  return raw;
};

test('a direct upgrade migrates every original profile and keeps the file as it was', async () => {
  const dataDir = await dir();
  const raw = await write(dataDir, workspace());
  await open(dataDir);
  assert.equal(await read(dataDir, 'workspace.json.pre-handbook'), raw, 'the pre-migration copy');
  const saved = JSON.parse(await read(dataDir)) as WorkspaceFile;
  const before = workspace();
  assert.equal(saved.revision, 8);
  for (const [i, save] of saved.saves.entries()) {
    const old = before.saves[i]!;
    // Ownership and account isolation are kept: the same users, sessions, saves and owners.
    assert.equal(save.userId, old.userId);
    assert.equal(save.activeProfile, old.activeProfile);
    assert.deepEqual(
      save.profiles.map(p => [p.id, p.name]),
      old.profiles.map(p => [p.id, p.name]),
    );
    const migrated = save.profiles[0]!;
    assert.equal(migrated.kind, 'calculated');
    assert.equal('handbook' in migrated, false);
    assert.deepEqual(migrated.plan, conversion.plan);
    assert.deepEqual(
      migrated.state,
      migrateHandbookState(old.profiles[0]!.state, frozen, conversion),
    );
    assert.equal(migrated.state.checks['calc-3-' + row], true);
    assert.equal(migrated.state.notes['factory-' + row], 'By the lake');
  }
  assert.deepEqual(saved.saves[0]!.profiles[1], calculated, 'a calculated profile is untouched');
  assert.deepEqual(saved.users, before.users);
  assert.deepEqual(saved.sessions, before.sessions);
  assert.equal(saved.accountsEnabled, true);
});

test('starting again changes nothing', async () => {
  const dataDir = await dir();
  const raw = await write(dataDir, workspace());
  await open(dataDir);
  const once = await read(dataDir);
  await open(dataDir);
  assert.equal(await read(dataDir), once, 'workspace.json is not written again');
  assert.equal(await read(dataDir, 'workspace.json.pre-handbook'), raw);
  // A workspace without original profiles never gets a pre-migration copy.
  const plainDir = await dir();
  const plainWorkspace = workspace();
  for (const save of plainWorkspace.saves) save.profiles = [calculated];
  for (const save of plainWorkspace.saves) save.activeProfile = 'calc';
  await write(plainDir, plainWorkspace);
  const plain = await read(plainDir);
  await open(plainDir);
  assert.equal(await read(plainDir), plain);
  await assert.rejects(read(plainDir, 'workspace.json.pre-handbook'), { code: 'ENOENT' });
});

test('a crash mid-write keeps the pre-migration copy, and the next start finishes', async () => {
  const dataDir = await dir();
  const raw = await write(dataDir, workspace());
  const rename = mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('crash'), { code: 'EIO' });
  });
  try {
    await assert.rejects(open(dataDir), /crash/);
  } finally {
    rename.mock.restore();
  }
  assert.equal(await read(dataDir), raw, 'workspace.json is as it was');
  assert.equal(await read(dataDir, 'workspace.json.pre-handbook'), raw);
  await open(dataDir);
  assert.equal(await read(dataDir, 'workspace.json.pre-handbook'), raw, 'never replaced');
  const saved = JSON.parse(await read(dataDir)) as WorkspaceFile;
  assert.ok(saved.saves.every(s => s.profiles.every(p => p.kind === 'calculated')));
});

test('a profile with its own handbook migrates with that one', async () => {
  const own = structuredClone(frozen);
  own.version = '2026-08-01';
  const renamed = own.factories.find(f => f.id === factory.id)!;
  renamed.id = 'renamed-factory';
  const file = workspace();
  const ownProfile = profile('original', { handbook: own });
  ownProfile.state.checks = {
    'factory-3-renamed-factory': true,
    ['factory-3-' + factory.id]: true,
  };
  file.saves[0]!.profiles[0] = ownProfile;
  const dataDir = await dir();
  await write(dataDir, file);
  await open(dataDir);
  const saved = JSON.parse(await read(dataDir)) as WorkspaceFile;
  const migrated = saved.saves[0]!.profiles[0]!;
  assert.equal('handbook' in migrated, false);
  assert.equal(migrated.plan!.engine, 'handbook-2026-08-01');
  assert.equal(migrated.state.checks['calc-3-' + row], true, 'its own factory id');
  // The frozen handbook's id is no factory of this one, so its tick is kept for review.
  assert.equal(migrated.state.handbookOrigin!.unmapped.checks['factory-3-' + factory.id], true);
  assert.equal(saved.saves[1]!.profiles[0]!.plan!.engine, 'handbook-' + frozen.version);
});

test('a skipped-version upgrade: a single-profile progress.json of an early release', async () => {
  const dataDir = await dir();
  // Content version 1, before workspace.json existed: handbook progress, factory ticks included.
  const old = {
    version: 1,
    checks: { ['factory-3-' + factory.id]: true, 'storage-ground-shell': true },
    notes: { ['factory-' + factory.id]: 'Old note' },
    deliveries: {},
    customTasks: [],
    settings: { phase: '4' },
  };
  await fs.writeFile(path.join(dataDir, 'progress.json'), JSON.stringify(old));
  await open(dataDir);
  const saved = JSON.parse(await read(dataDir)) as WorkspaceFile;
  const migrated = saved.saves[0]!.profiles[0]!;
  assert.equal(migrated.id, 'original');
  assert.equal(migrated.kind, 'calculated');
  assert.equal(migrated.state.checks['calc-3-' + row], true);
  assert.equal(migrated.state.notes['factory-' + row], 'Old note');
  assert.equal(migrated.state.settings.phase, '4');
  // progress.json itself is the pre-migration copy; no other is written.
  assert.deepEqual(JSON.parse(await read(dataDir, 'progress.json')), old);
  await assert.rejects(read(dataDir, 'workspace.json.pre-handbook'), { code: 'ENOENT' });
});

test("a migrated profile's Phase 5 is not over budget on Nitrogen Gas (the pureLimits base)", () => {
  const limits = conversion.plan.settings.limits!;
  const used = conversion.plan.stages['5'].raw!['Nitrogen Gas'] ?? 0;
  assert.ok(used > 0, 'Phase 5 uses Nitrogen Gas');
  assert.ok(limits['Nitrogen Gas']! >= used, `${used} within ${limits['Nitrogen Gas']}`);
});

test('the frozen handbook is in neither the Docker public files nor the Pages build', () => {
  const build = spawnSync(process.execPath, ['build.ts'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
  for (const out of ['dist/web', 'dist/satisfactory-planner'])
    for (const file of walk(out))
      assert.doesNotMatch(file.replaceAll('\\', '/'), /migrations|handbook-2026-09-13/, file);
  // The image copies migrations/ next to workspace.ts, outside the public/ it serves.
  const docker = readFileSync('Dockerfile', 'utf8');
  assert.match(docker, /^COPY --chown=node:node migrations \.\/migrations$/m);
});
