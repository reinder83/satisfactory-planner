import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import type { Handbook } from '../public/types/index.ts';
async function start(dir: string, config: Parameters<typeof createApp>[0] = {}) {
  const server = await createApp({ dataDir: dir, ...config });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  // Listening on a TCP port, so address() is an AddressInfo.
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
const close = (server: Server) => new Promise(r => server.close(r));
async function post(
  url: string,
  endpoint: string,
  data: unknown,
  extra: Record<string, string> = {},
) {
  return fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...extra },
    body: JSON.stringify(data),
  });
}
test('progress persists, concurrent updates are not lost, backup restores and invalid writes preserve data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  let app = await start(dir);
  try {
    let s = await (await fetch(app.url + '/api/state')).json();
    assert.equal(s.checks['storage-ground-shell'], true);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        post(app.url, '/api/update', { type: 'check', key: 'test-' + i, value: true }),
      ),
    );
    assert.ok(results.every(r => r.status === 200));
    await post(app.url, '/api/update', {
      type: 'note',
      key: 'factory-iron-ingot',
      value: 'Station A <test> & belt 2',
    });
    await post(app.url, '/api/update', {
      type: 'addTask',
      id: 'custom-example',
      title: 'Wire station',
      phase: '3',
    });
    await post(app.url, '/api/update', { type: 'delivery', key: '3-modular-engine', value: 321 });
    const backup = await (await fetch(app.url + '/api/export')).json();
    assert.equal(backup.format, 'satisfactory-planner-backup');
    await close(app.server);
    app = await start(dir);
    s = await (await fetch(app.url + '/api/state')).json();
    assert.equal(s.notes['factory-iron-ingot'], 'Station A <test> & belt 2');
    assert.equal(s.deliveries['3-modular-engine'], 321);
    assert.equal(s.customTasks.length, 1);
    for (let i = 0; i < 12; i++) assert.equal(s.checks['test-' + i], true);
    assert.equal(
      (await post(app.url, '/api/update', { type: 'phase', value: 'oops' })).status,
      400,
    );
    assert.equal(
      (await post(app.url, '/api/update', { type: 'note', key: '__proto__', value: 'x' })).status,
      400,
    );
    assert.equal(
      (await post(app.url, '/api/update', { type: 'check', key: 'bad', value: 'yes' })).status,
      400,
    );
    assert.equal((await post(app.url, '/api/import', { version: 1, checks: {} })).status, 400);
    let after = await (await fetch(app.url + '/api/state')).json();
    assert.deepEqual(after, s);
    await post(app.url, '/api/update', { type: 'check', key: 'test-1', value: false });
    assert.equal((await post(app.url, '/api/import', backup)).status, 200);
    after = await (await fetch(app.url + '/api/state')).json();
    assert.equal(after.checks['test-1'], true);
    assert.equal(
      (
        await fetch(app.url + '/api/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (await post(app.url, '/api/update', {}, { Origin: 'https://other.example' })).status,
      403,
    );
    assert.equal((await fetch(app.url + '/%2e%2e%2fserver.ts')).status, 403);
    assert.equal((await fetch(app.url + '/no-such-file')).status, 404);
    assert.equal((await fetch(app.url + '/')).status, 200);
    const plan: Handbook = await (await fetch(app.url + '/plan.json')).json();
    assert.equal(plan.resources['5']!.Coal, 73473.33333333333);
    assert.equal(plan.power['5'], 913.925);
    assert.equal(plan.storage.flatMap(b => b.items).filter(x => x.name).length, 132);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('optional password guards app and progress while health remains readable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-auth-'));
  const app = await start(dir, { user: 'tester', password: 'test-only-secret' });
  try {
    assert.equal((await fetch(app.url + '/api/state')).status, 401);
    assert.equal((await fetch(app.url + '/')).status, 401);
    assert.equal((await fetch(app.url + '/health')).status, 200);
    assert.equal(
      (
        await fetch(app.url + '/api/state', {
          headers: {
            Authorization: 'Basic ' + Buffer.from('tester:test-only-secret').toString('base64'),
          },
        })
      ).status,
      200,
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('a damaged progress file never silently resets the save', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-damaged-'));
  try {
    await fs.writeFile(path.join(dir, 'progress.json'), '{broken');
    await assert.rejects(createApp({ dataDir: dir }), /has not been overwritten/);
    assert.equal(await fs.readFile(path.join(dir, 'progress.json'), 'utf8'), '{broken');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('malformed updates and save exports are refused with 400 and a reason', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const app = await start(dir);
  try {
    for (const type of [5, null, ['check']]) {
      const r = await post(app.url, '/api/update', { type });
      assert.equal(r.status, 400, JSON.stringify(type));
      assert.equal((await r.json()).error, 'Unknown update.');
    }
    const wrap = { format: 'satisfactory-planner-saves', version: 1 };
    for (const [data, error] of [
      [null, 'Choose a full planner save export.'],
      [{ ...wrap, saves: 'x' }, 'Choose a full planner save export.'],
      [{ ...wrap, saves: [null] }, 'Invalid profiles in export.'],
      [{ ...wrap, saves: [{ profiles: [null] }] }, 'Invalid profile.'],
      [
        { ...wrap, saves: [{ profiles: [{ id: 'p', kind: 'calculated' }] }] },
        'Missing calculation snapshot.',
      ],
    ] as [unknown, string][]) {
      const r = await post(app.url, '/api/import-saves', data);
      assert.equal(r.status, 400, JSON.stringify(data));
      assert.equal((await r.json()).error, error);
    }
    // The full-save import allows 50 MB, and says so when a file is larger.
    const big = await post(app.url, '/api/import-saves', 'x'.repeat(51 * 1024 * 1024));
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error, 'Backup or update exceeds 50 MB.');
    const saves = (await (await fetch(app.url + '/api/workspace')).json()).saves;
    assert.equal(saves.length, 1, 'nothing was imported');
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a missing workspace with a backup beside it stops start-up instead of starting fresh', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  try {
    let app = await start(dir);
    await post(app.url, '/api/update', { type: 'check', key: 'kept', value: true });
    await close(app.server);
    const file = path.join(dir, 'workspace.json');
    await fs.rename(file, file + '.bak');
    const backup = await fs.readFile(file + '.bak', 'utf8');
    await assert.rejects(start(dir), /workspace\.json\.bak exists/);
    assert.equal(await fs.readFile(file + '.bak', 'utf8'), backup, 'the backup is untouched');
    await assert.rejects(fs.stat(file), 'no fresh workspace was written');
    // Following the advice recovers it.
    await fs.rename(file + '.bak', file);
    app = await start(dir);
    assert.equal((await (await fetch(app.url + '/api/state')).json()).checks.kept, true);
    await close(app.server);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
