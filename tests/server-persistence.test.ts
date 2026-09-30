// server/persistence.ts on its own (#524): loading workspace.json, the refusals that keep a
// damaged, newer or missing-with-backup workspace from turning into an empty one, the first
// start from progress.json, and the commit queue's serialized, atomic writes. The handbook
// migration on load is covered by handbook-server-migration.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspace, createCommitQueue } from '../server/persistence.ts';
import { validateState } from '../public/state.ts';
import { seedLegacy } from './helpers/seed.ts';

const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'planner-persistence-'));
const read = (d: string, name: string) => fs.readFile(path.join(d, name), 'utf8');
const exists = (d: string, name: string) =>
  fs.stat(path.join(d, name)).then(
    () => true,
    () => false,
  );

test('a fresh data folder gets an empty workspace, written once', async () => {
  const d = await dir();
  const workspace = await loadWorkspace(d, validateState);
  assert.equal(workspace.version, 2);
  assert.equal(workspace.revision, 0);
  assert.equal(workspace.accountsEnabled, false);
  assert.deepEqual(workspace.saves, []);
  assert.deepEqual(
    workspace.users.map(u => [u.id, u.activeSave]),
    [['owner', null]],
  );
  assert.deepEqual(JSON.parse(await read(d, 'workspace.json')), workspace);
  // Opening it again changes nothing.
  const raw = await read(d, 'workspace.json');
  assert.deepEqual(await loadWorkspace(d, validateState), workspace);
  assert.equal(await read(d, 'workspace.json'), raw);
});

test('a legacy progress.json becomes the migrated profile of one save and stays untouched', async () => {
  const d = await dir();
  await seedLegacy(d);
  const legacy = await read(d, 'progress.json');
  const workspace = await loadWorkspace(d, validateState);
  assert.equal(workspace.users[0]!.activeSave, 'original-save');
  const [save] = workspace.saves;
  assert.equal(save!.id, 'original-save');
  assert.equal(save!.activeProfile, 'original');
  assert.equal(save!.profiles[0]!.kind, 'calculated', 'the handbook profile migrated (#495)');
  assert.equal(await read(d, 'progress.json'), legacy);
  // progress.json is its pre-migration copy; no pre-handbook copy of a file that never held one.
  assert.equal(await exists(d, 'workspace.json.pre-handbook'), false);
});

test('an unreadable, invalid or newer workspace.json stops loading and is left as it was', async () => {
  const cases: [string, RegExp][] = [
    ['{not json', /Workspace could not be read; existing data has not been overwritten/],
    [JSON.stringify({ version: 2, users: [], saves: [], sessions: [] }), /could not be read/],
    [JSON.stringify({ version: 3, users: [], saves: [], sessions: [] }), /newer version/],
  ];
  for (const [raw, message] of cases) {
    const d = await dir();
    await fs.writeFile(path.join(d, 'workspace.json'), raw);
    await assert.rejects(loadWorkspace(d, validateState), message);
    assert.equal(await read(d, 'workspace.json'), raw);
  }
});

test('a missing workspace.json with a .bak beside it is refused, nothing written', async () => {
  const d = await dir();
  await fs.writeFile(path.join(d, 'workspace.json.bak'), '{}');
  await assert.rejects(loadWorkspace(d, validateState), /workspace\.json\.bak exists/);
  assert.equal(await exists(d, 'workspace.json'), false);
  assert.equal(await read(d, 'workspace.json.bak'), '{}');
});

test('commits run one at a time, keep the previous workspace as .bak and survive a failed one', async () => {
  const d = await dir();
  const { current, commit } = createCommitQueue(d, await loadWorkspace(d, validateState));
  const results = await Promise.allSettled([
    commit(draft => {
      draft.registration = true;
      return 'first';
    }),
    commit(() => {
      throw new Error('refused');
    }),
    commit(draft => {
      draft.accountsEnabled = true;
      return 'third';
    }),
  ]);
  assert.deepEqual(
    results.map(r => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message)),
    ['first', 'refused', 'third'],
  );
  // The failed change wrote nothing, so two revisions.
  assert.equal(current().revision, 2);
  assert.equal(current().registration && current().accountsEnabled, true);
  assert.deepEqual(JSON.parse(await read(d, 'workspace.json')), current());
  const backup = JSON.parse(await read(d, 'workspace.json.bak'));
  assert.equal(backup.revision, 1);
  assert.equal(backup.accountsEnabled, false);
  assert.equal(await exists(d, 'workspace.json.tmp'), false);
});

test('a change that throws leaves the workspace in memory and on disk as it was', async () => {
  const d = await dir();
  const { current, commit } = createCommitQueue(d, await loadWorkspace(d, validateState));
  const before = await read(d, 'workspace.json');
  const held = current();
  await assert.rejects(
    commit(draft => {
      draft.registration = true;
      throw new Error('refused');
    }),
    /refused/,
  );
  assert.equal(current(), held);
  assert.equal(current().registration, false);
  assert.equal(await read(d, 'workspace.json'), before);
  assert.equal(await exists(d, 'workspace.json.bak'), false);
});
