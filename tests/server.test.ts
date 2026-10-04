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
async function start(dir: string, config: Parameters<typeof createApp>[0] = {}) {
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, ...config });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // Listening on a TCP port, so address() is an AddressInfo.
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
const close = (server: Server) => new Promise(resolve => server.close(resolve));
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
    let state = await (await fetch(app.url + '/api/state')).json();
    assert.equal(state.checks['storage-ground-shell'], true);
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
    state = await (await fetch(app.url + '/api/state')).json();
    // The fresh server's original profile migrates on the restart (#495); a global note stays.
    assert.equal(state.notes.global, 'Station A <test> & belt 2');
    assert.equal(state.deliveries['3-modular-engine'], 321);
    assert.equal(state.customTasks.length, 1);
    for (let i = 0; i < 12; i++) assert.equal(state.checks['test-' + i], true);
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
    assert.deepEqual(after, state);
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
    // The profile migrated from the handbook opens with its plan and no handbook (#820).
    const context = await (await fetch(app.url + '/api/context')).json();
    assert.deepEqual(Object.keys(context).sort(), ['payoff', 'plan', 'profile', 'save', 'state']);
    assert.equal(context.profile.kind, 'calculated');
    // The retired handbook is no longer served (#397).
    assert.equal((await fetch(app.url + '/plan.json')).status, 404);
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
      const response = await post(app.url, '/api/update', { type });
      assert.equal(response.status, 400, JSON.stringify(type));
      assert.equal((await response.json()).error, 'Unknown update.');
    }
    const wrap = { format: 'satisfactory-planner-saves', version: 1 };
    for (const [data, error] of [
      [{ ...wrap, saves: 'x' }, 'Choose a full planner save export.'],
      [
        { ...wrap, saves: [null] },
        'This save file has a world with missing, damaged or too many profiles, so it cannot be imported. Export it again from the planner that made it.',
      ],
      [
        { ...wrap, saves: [{ profiles: [null] }] },
        'This save file has a damaged profile, so it cannot be imported. Export it again from the planner that made it.',
      ],
      [
        { ...wrap, saves: [{ profiles: [{ id: 'p', kind: 'calculated' }] }] },
        'This save file has a plan without its calculation, so it cannot be imported. Export it again from the planner that made it.',
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
        'This save file has damaged source links, so it cannot be imported. Export it again from the planner that made it.',
      ]),
    ] as [unknown, string][]) {
      const response = await post(app.url, '/api/import-saves', data);
      assert.equal(response.status, 400, JSON.stringify(data));
      assert.equal((await response.json()).error, error);
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

// A body that is valid JSON but not an object (null, a list, a string or a number) is refused
// by the one body reader with 400, never reported as a storage failure (#541).
test('a JSON body that is not an object is refused with 400 before any route reads it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-body-'));
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-body-fresh-'));
  const app = await start(dir);
  const empty = await createApp({ dataDir: fresh });
  await new Promise<void>(resolve => empty.listen(0, '127.0.0.1', resolve));
  const emptyUrl = 'http://127.0.0.1:' + (empty.address() as AddressInfo).port;
  try {
    const before = await (await fetch(app.url + '/api/state')).json();
    const cases: [string, string[]][] = [
      [emptyUrl, ['/api/setup', '/api/login', '/api/register']],
      [
        app.url,
        [
          '/api/preview',
          '/api/profiles',
          '/api/select',
          '/api/remove-profile',
          '/api/rename',
          '/api/duplicate-profile',
          '/api/rank-alternates',
          '/api/import',
          '/api/update',
          '/api/import-saves',
        ],
      ],
    ];
    for (const [url, endpoints] of cases)
      for (const endpoint of endpoints)
        for (const data of [null, [], 'x', 5]) {
          const response = await post(url, endpoint, data);
          const label = endpoint + ' ' + JSON.stringify(data);
          assert.equal(response.status, 400, label);
          assert.equal((await response.json()).error, 'Expected a JSON object.', label);
        }
    assert.deepEqual(await (await fetch(app.url + '/api/state')).json(), before);
    // An object body still reaches its route.
    const ok = await post(app.url, '/api/update', { type: 'check', key: 'body-ok', value: true });
    assert.equal(ok.status, 200);
  } finally {
    await close(app.server);
    await close(empty);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(fresh, { recursive: true, force: true });
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
  mock.method(fs, 'stat', (filePath: string) =>
    String(filePath).endsWith('workspace.json.bak')
      ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      : stat(filePath),
  );
  try {
    // It says the backup could not be checked, with the code, not that it exists (#175).
    await assert.rejects(refused(dir), (error: Error) => {
      assert.match(error.message, /workspace\.json\.bak could not be checked \(EACCES\)/);
      assert.match(error.message, /permissions/);
      assert.doesNotMatch(error.message, /bak exists/);
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
        saves: current.saves.map((save: { profiles: { state: object }[] }) => ({
          ...save,
          profiles: save.profiles.map(p => ({ ...p, state: { ...p.state, version: 99 } })),
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
    const atRevision = (revision: number) => ({ 'X-Planner-Revision': String(revision) });
    // Tab one saves a note from what it saw; tab two, still on that revision, saves its own.
    assert.equal(
      (
        await post(
          app.url,
          '/api/update',
          { type: 'note', key: 'n', value: 'one' },
          atRevision(seen),
        )
      ).status,
      200,
    );
    const stale = await post(
      app.url,
      '/api/update',
      { type: 'note', key: 'n', value: 'two' },
      atRevision(seen),
    );
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /changed in another tab/);
    const order = { type: 'taskOrder', phase: '3', ids: ['a', 'b'] };
    assert.equal((await post(app.url, '/api/update', order, atRevision(seen))).status, 409);
    let current = await (await fetch(app.url + '/api/state')).json();
    assert.equal(current.notes.n, 'one', "the first tab's note is kept");
    // A tick from the stale tab merges, and so does anything without the header.
    assert.equal(
      (
        await post(
          app.url,
          '/api/update',
          { type: 'check', key: 'k', value: true },
          atRevision(seen),
        )
      ).status,
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
          atRevision(await state()),
        )
      ).status,
      200,
    );
    current = await (await fetch(app.url + '/api/state')).json();
    assert.equal(current.notes.n, 'two');
    assert.equal(current.checks.k, true);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// #1052: a note write names the saved text it was typed over (`base`). It is refused when the note
// now says something else, whatever revision it names, and goes through when only other records
// changed meanwhile (a tick from someone else no longer blocks a note).
test('a note write with its base text is refused only when that note changed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-test-'));
  const app = await start(dir);
  try {
    const revision = async () => (await (await fetch(app.url + '/api/state')).json()).revision;
    const atRevision = (seen: number) => ({ 'X-Planner-Revision': String(seen) });
    const note = (value: string, base: string) => ({ type: 'note', key: 'g', value, base });
    const seen = await revision();
    // Someone else ticks a box: the note is unchanged, so a note typed over '' still saves.
    await post(app.url, '/api/update', { type: 'check', key: 'k', value: true });
    assert.equal((await post(app.url, '/api/update', note('A', ''), atRevision(seen))).status, 200);
    // Another tab, still showing '', writes its own: refused, with the note's own message.
    const refused = await post(app.url, '/api/update', note('B', ''), atRevision(await revision()));
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /Both versions are shown under the note/);
    let current = await (await fetch(app.url + '/api/state')).json();
    assert.equal(current.notes.g, 'A', 'the first note is kept');
    // Typed over 'A' (the choice "Keep mine" sends that), it replaces it; whitespace is no note.
    assert.equal((await post(app.url, '/api/update', note('B', 'A'))).status, 200);
    assert.equal((await post(app.url, '/api/update', note(' ', 'B'))).status, 200);
    assert.equal((await post(app.url, '/api/update', note('C', '  \n'))).status, 200);
    current = await (await fetch(app.url + '/api/state')).json();
    assert.equal(current.notes.g, 'C');
    // A base that is not text is no base: the revision rule applies as before.
    const old = await post(
      app.url,
      '/api/update',
      { type: 'note', key: 'g', value: 'D', base: 7 },
      atRevision(seen),
    );
    assert.equal(old.status, 409);
    assert.match((await old.json()).error, /changed in another tab/);
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const workspace = await (await fetch(url + '/api/workspace')).json();
    assert.deepEqual(workspace.saves, []);
    assert.equal(workspace.activeSave, null);
    const file = JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'));
    assert.deepEqual(file.saves, []);
    assert.equal(file.users[0].activeSave, null);
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
test('a request no route answers is checked like any other before it gets "Not found."', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-routes-'));
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-routes-fresh-'));
  const app = await start(dir);
  const empty = await createApp({ dataDir: fresh });
  await new Promise<void>(resolve => empty.listen(0, '127.0.0.1', resolve));
  const emptyUrl = 'http://127.0.0.1:' + (empty.address() as AddressInfo).port;
  const answer = async (reply: Response) => [reply.status, (await reply.json()).error];
  try {
    // An unknown path, or a known path with another method, is resolved against the scoped save
    // and profile first, like the scoped routes, then answered 404 'Not found.'.
    assert.deepEqual(await answer(await fetch(app.url + '/api/nothing')), [404, 'Not found.']);
    assert.deepEqual(await answer(await post(app.url, '/api/nothing', {})), [404, 'Not found.']);
    assert.deepEqual(await answer(await fetch(app.url + '/api/login')), [404, 'Not found.']);
    assert.deepEqual(await answer(await post(app.url, '/api/state', {})), [404, 'Not found.']);
    const head = await fetch(app.url + '/api/state', { method: 'HEAD' });
    assert.equal(head.status, 404);
    const missingSave = await fetch(app.url + '/api/nothing', { headers: { 'X-Save-Id': 'gone' } });
    assert.deepEqual(await answer(missingSave), [404, 'Save not found.']);
    const missingProfile = await fetch(app.url + '/api/nothing?profile=gone');
    assert.deepEqual(await answer(missingProfile), [404, 'Profile not found.']);
    // A route that needs no scope never reports a missing save, even for a save id that is gone.
    const exported = await fetch(app.url + '/api/export-saves', {
      headers: { 'X-Save-Id': 'gone' },
    });
    assert.equal(exported.status, 200);
    // Outside /api/ a POST is 'Not found.' and another method is not allowed.
    assert.deepEqual(await answer(await post(app.url, '/nothing', {})), [404, 'Not found.']);
    const put = await fetch(app.url + '/api/state', { method: 'PUT' });
    assert.deepEqual(await answer(put), [405, 'Method not allowed.']);
    assert.equal(put.headers.get('allow'), 'GET, HEAD, POST');
    // With no saves the scope is missing, so an unknown route reports that first.
    assert.deepEqual(await answer(await fetch(emptyUrl + '/api/nothing')), [
      404,
      'Save not found.',
    ]);
    // Signed out, only the account routes answer; an unknown route asks to sign in.
    const setupToken = (
      await fs.readFile(path.join(fresh, 'account-setup-token.txt'), 'utf8')
    ).trim();
    const setup = await post(emptyUrl, '/api/setup', {
      setupToken,
      username: 'pioneer',
      password: 'a long password',
    });
    assert.equal(setup.status, 200);
    assert.match(setup.headers.get('set-cookie') ?? '', /^planner_session=\w+; Path=\/; HttpOnly/);
    assert.equal((await fetch(emptyUrl + '/api/workspace')).status, 200);
    assert.deepEqual(await answer(await fetch(emptyUrl + '/api/nothing')), [
      401,
      'Sign in to continue.',
    ]);
    assert.deepEqual(await answer(await post(emptyUrl, '/api/logout', {})), [
      401,
      'Sign in to continue.',
    ]);
  } finally {
    await close(app.server);
    await close(empty);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(fresh, { recursive: true, force: true });
  }
});
