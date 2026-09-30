import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { contentTypes, createApp } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';
import { fontNames } from '../fonts.ts';
import type { Handbook } from '../public/types/index.ts';
async function start(dir: string, config: Parameters<typeof createApp>[0] = {}) {
  await seedLegacy(dir);
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
      key: 'global',
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
    // The fresh server's original profile migrates on the restart (#495); a global note stays.
    assert.equal(s.notes.global, 'Station A <test> & belt 2');
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
      // An original profile whose handbook sources are not a list (#116).
      ...[5, {}, 'x'].map(sources => [
        {
          ...wrap,
          saves: [
            {
              profiles: [
                {
                  id: 'p',
                  kind: 'original',
                  handbook: { factories: [], phases: {}, storage: [], sources },
                },
              ],
            },
          ],
        },
        'Invalid handbook sources.',
      ]),
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

// Starts a server that is expected to be refused. If it starts anyway, it is closed before the
// test fails, so a regression fails the test instead of leaving node --test hanging.
const refused = (dir: string) =>
  start(dir).then(async app => {
    await close(app.server);
    return app;
  });

test('a missing workspace with a backup beside it stops start-up instead of starting fresh', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  let app: Awaited<ReturnType<typeof start>> | undefined;
  try {
    app = await start(dir);
    await post(app.url, '/api/update', { type: 'check', key: 'kept', value: true });
    await close(app.server);
    app = undefined;
    const file = path.join(dir, 'workspace.json');
    await fs.rename(file, file + '.bak');
    const backup = await fs.readFile(file + '.bak', 'utf8');
    await assert.rejects(refused(dir), /workspace\.json\.bak exists/);
    assert.equal(await fs.readFile(file + '.bak', 'utf8'), backup, 'the backup is untouched');
    await assert.rejects(fs.stat(file), 'no fresh workspace was written');
    // Following the advice recovers it.
    await fs.rename(file + '.bak', file);
    app = await start(dir);
    assert.equal((await (await fetch(app.url + '/api/state')).json()).checks.kept, true);
  } finally {
    if (app) await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a backup that cannot be checked also stops start-up; only a certainly missing one does not', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const stat = fs.stat;
  // Only the .bak lookup fails, and not with ENOENT (a permission error, say).
  mock.method(fs, 'stat', (p: string) =>
    String(p).endsWith('workspace.json.bak')
      ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      : stat(p),
  );
  try {
    // It says the backup could not be checked, with the code, not that it exists (#175).
    await assert.rejects(refused(dir), (e: Error) => {
      assert.match(e.message, /workspace\.json\.bak could not be checked \(EACCES\)/);
      assert.match(e.message, /permissions/);
      assert.doesNotMatch(e.message, /bak exists/);
      return true;
    });
    await assert.rejects(fs.access(path.join(dir, 'workspace.json')), 'nothing was written');
  } finally {
    mock.restoreAll();
    await fs.rm(dir, { recursive: true, force: true });
  }
  // With no backup at all, a fresh data folder starts as before.
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  try {
    const app = await start(fresh);
    await close(app.server);
  } finally {
    await fs.rm(fresh, { recursive: true, force: true });
  }
});

test('only the development server lets Vite start a blob: worker', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const csp = async (dev: boolean) => {
    const app = await start(dir, { dev });
    try {
      return (await fetch(app.url + '/health')).headers.get('content-security-policy') || '';
    } finally {
      await close(app.server);
    }
  };
  try {
    const production = await csp(false);
    assert.match(production, /script-src 'self';/);
    assert.doesNotMatch(production, /blob:/);
    assert.match(await csp(true), /worker-src 'self' blob:;/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the interface fonts are served as font/woff2, not a generic download', () => {
  // The fonts build.ts copies into the image's public/fonts; nosniff is on every response.
  assert.ok(fontNames.length);
  for (const name of fontNames) assert.equal(contentTypes[path.extname(name)], 'font/woff2', name);
});

test('a workspace from a newer planner stops start-up with "update the app", untouched', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  try {
    const app = await start(dir);
    await close(app.server);
    const file = path.join(dir, 'workspace.json');
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    // A newer workspace format, then a current one holding a newer profile state.
    for (const workspace of [
      { ...current, version: 3 },
      {
        ...current,
        saves: current.saves.map((s: { profiles: { state: object }[] }) => ({
          ...s,
          profiles: s.profiles.map(p => ({ ...p, state: { ...p.state, version: 99 } })),
        })),
      },
    ]) {
      const text = JSON.stringify(workspace);
      await fs.writeFile(file, text);
      await assert.rejects(start(dir), /newer version of the planner\. Update the app/);
      assert.equal(await fs.readFile(file, 'utf8'), text, 'left exactly as it was');
    }
    // A damaged one keeps the generic message.
    await fs.writeFile(file, '{"version":2}');
    await assert.rejects(start(dir), /Workspace could not be read/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a whole-value write from a tab that missed a change is refused, small ones still merge', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const app = await start(dir);
  try {
    const state = async () => (await (await fetch(app.url + '/api/state')).json()).revision;
    const seen = await state();
    const at = (revision: number) => ({ 'X-Planner-Revision': String(revision) });
    // Tab one saves a note from what it saw; tab two, still on that revision, saves its own.
    assert.equal(
      (await post(app.url, '/api/update', { type: 'note', key: 'n', value: 'one' }, at(seen)))
        .status,
      200,
    );
    const stale = await post(
      app.url,
      '/api/update',
      { type: 'note', key: 'n', value: 'two' },
      at(seen),
    );
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /changed in another tab/);
    const order = { type: 'taskOrder', phase: '3', ids: ['a', 'b'] };
    assert.equal((await post(app.url, '/api/update', order, at(seen))).status, 409);
    let s = await (await fetch(app.url + '/api/state')).json();
    assert.equal(s.notes.n, 'one', "the first tab's note is kept");
    // A tick from the stale tab merges, and so does anything without the header.
    assert.equal(
      (await post(app.url, '/api/update', { type: 'check', key: 'k', value: true }, at(seen)))
        .status,
      200,
    );
    assert.equal(
      (await post(app.url, '/api/update', { type: 'note', key: 'n', value: 'script' })).status,
      200,
    );
    // With the current revision the same write goes through.
    assert.equal(
      (
        await post(
          app.url,
          '/api/update',
          { type: 'note', key: 'n', value: 'two' },
          at(await state()),
        )
      ).status,
      200,
    );
    s = await (await fetch(app.url + '/api/state')).json();
    assert.equal(s.notes.n, 'two');
    assert.equal(s.checks.k, true);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// SP-33: the wizard's live estimates count against their own allowance (120 a minute), so
// estimating while editing never uses up the 20 calculations Calculate plan needs, and the
// other way round.
test('live estimates and full calculations are throttled separately', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const app = await start(dir);
  const settings = { phase: '5', wholeMachines: false };
  const preview = (estimate: boolean) =>
    post(app.url, estimate ? '/api/preview?estimate=1' : '/api/preview', { settings });
  try {
    for (let i = 0; i < 21; i++) assert.equal((await preview(true)).status, 200, 'estimate ' + i);
    for (let i = 0; i < 20; i++) assert.equal((await preview(false)).status, 200, 'preview ' + i);
    assert.equal((await preview(false)).status, 429, 'the 21st full calculation waits');
    assert.equal((await preview(true)).status, 200, 'estimates carry on');
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// #413: marking a preview as an estimate cannot buy more solving than the estimate budget, and
// an over-limit request is refused before its body is read. The old body flag is not an estimate.
test('live estimates stop at their solving-time budget, and the limit runs before the body', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const app = await start(dir, { estimateBudgetMs: 1 });
  const settings = { phase: '5', wholeMachines: false };
  try {
    const first = await post(app.url, '/api/preview?estimate=1', { settings });
    assert.equal(first.status, 200, 'the budget is not used up yet');
    const second = await post(app.url, '/api/preview?estimate=1', { settings });
    assert.equal(second.status, 429, 'the first solve used the 1 ms budget');
    assert.match((await second.json()).error, /Live estimates are paused for a minute/);
    // Calculate plan is unaffected.
    assert.equal((await post(app.url, '/api/preview', { settings })).status, 200);
    // A body flag no longer marks an estimate: it counts as a full calculation.
    for (let i = 0; i < 19; i++)
      assert.equal(
        (await post(app.url, '/api/preview', { settings, estimate: true })).status,
        200,
        'full ' + i,
      );
    // Over the limit, even a malformed body is refused for the limit, so it was never read.
    const over = await fetch(app.url + '/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: '{not json',
    });
    assert.equal(over.status, 429);
    const estimateOver = await fetch(app.url + '/api/preview?estimate=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: '{not json',
    });
    assert.equal(estimateOver.status, 429, 'nor for an estimate over its budget');
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// A brand-new Docker server starts like the Pages edition (decision 5A on #387, #496): the
// owner has no saves, so the interface opens the guided start, and nothing is created until
// the pioneer makes a profile. /api/profiles refuses the retired handbook kind.
test('a fresh data folder has no saves, and a handbook profile cannot be created', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-fresh-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const w = await (await fetch(url + '/api/workspace')).json();
    assert.deepEqual(w.saves, []);
    assert.equal(w.activeSave, null);
    const db = JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'));
    assert.deepEqual(db.saves, []);
    assert.equal(db.users[0].activeSave, null);
    await assert.rejects(fs.stat(path.join(dir, 'workspace.json.pre-handbook')), {
      code: 'ENOENT',
    });
    const refused = await post(url, '/api/profiles', {
      saveName: 'World',
      name: 'Handbook',
      kind: 'original',
    });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /can no longer be created/);
    assert.deepEqual((await (await fetch(url + '/api/workspace')).json()).saves, []);
    // A calculated profile is the first save.
    const made = await post(url, '/api/profiles', {
      saveName: 'World',
      name: 'Balanced',
      settings: {},
    });
    assert.equal(made.status, 201);
    const after = await (await fetch(url + '/api/workspace')).json();
    assert.equal(after.saves.length, 1);
    assert.equal(after.saves[0].profiles[0].kind, 'calculated');
  } finally {
    await close(server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
