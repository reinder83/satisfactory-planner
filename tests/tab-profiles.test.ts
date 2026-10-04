// #1052, Docker edition: the active save and profile stay what a user opened last, in the same
// stored shape as every earlier release (users[].activeSave and each save's activeProfile), and
// only a new tab opens them. Two clients on one server: one duplicates the profile and is moved to
// the copy; the other keeps writing to the profile it shows, named in its request headers, and a
// workspace written that way loads again unchanged, with no migration and no pre-migration copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';
import type { WorkspaceSummary } from '../public/types/index.ts';

const close = (server: Server) => new Promise(resolve => server.close(resolve));
async function start(dir: string) {
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}

test('Docker: one client duplicating moves only the remembered profile; the other keeps writing its own', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-tab-profiles-'));
  await seedLegacy(dir);
  let app = await start(dir);
  try {
    const call = (route: string, body?: unknown, scope?: { save: string; profile: string }) =>
      fetch(app.url + route, {
        ...(body === undefined
          ? {}
          : {
              method: 'POST',
              body: JSON.stringify(body),
            }),
        headers: {
          'Content-Type': 'application/json',
          'X-Planner-Request': '1',
          ...(scope ? { 'X-Save-Id': scope.save, 'X-Profile-Id': scope.profile } : {}),
        },
      });
    const workspace = async (): Promise<WorkspaceSummary> => (await call('/api/workspace')).json();
    let ws = await workspace();
    const save = ws.saves[0]!;
    const main = { save: save.id, profile: save.activeProfile };
    // Client B duplicates Main: the server now remembers the copy as the one opened last.
    const copied = await call('/api/duplicate-profile', {
      saveId: save.id,
      profileId: main.profile,
    });
    assert.equal(copied.status, 201);
    const { profileId: copy } = (await copied.json()) as { profileId: string };
    ws = await workspace();
    assert.equal(ws.activeSave, save.id);
    assert.equal(ws.saves[0]!.activeProfile, copy);
    // Client A, still showing Main, ticks a box and writes a note: both land in Main only.
    for (const update of [
      { type: 'check', key: 'a-tick', value: true },
      { type: 'note', key: 'global', value: 'From A', base: '' },
    ])
      assert.equal((await call('/api/update', update, main)).status, 200);
    const stateOf = async (profile: string) =>
      (await call(`/api/state?save=${save.id}&profile=${profile}`)).json();
    assert.equal((await stateOf(main.profile)).checks['a-tick'], true);
    assert.equal((await stateOf(main.profile)).notes.global, 'From A');
    assert.equal((await stateOf(copy)).checks['a-tick'], undefined, 'nothing went into the copy');
    // The stored shape is the released one: a restart loads it as it is, rewriting nothing.
    const file = path.join(dir, 'workspace.json');
    const written = await fs.readFile(file, 'utf8');
    const stored = JSON.parse(written);
    assert.equal(stored.users[0].activeSave, save.id);
    assert.equal(stored.saves[0].activeProfile, copy);
    assert.deepEqual(Object.keys(stored.saves[0]).sort(), [
      'activeProfile',
      'id',
      'name',
      'profiles',
      'userId',
    ]);
    const before = (await fs.readdir(dir)).sort();
    await close(app.server);
    app = await start(dir);
    assert.equal(await fs.readFile(file, 'utf8'), written, 'loaded without a migration');
    assert.deepEqual((await fs.readdir(dir)).sort(), before, 'and without a new copy beside it');
    ws = await workspace();
    assert.equal(ws.saves[0]!.activeProfile, copy, 'a new tab opens what was opened last');
    assert.equal((await stateOf(main.profile)).checks['a-tick'], true);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
