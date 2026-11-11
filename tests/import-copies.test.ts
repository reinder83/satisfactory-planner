// #1052, #1324: importing a full-save file (a friend's export or share) adds copies under the
// saves' own names, numbered only where a name is taken, with the file and its export date kept
// as `importedFrom` (labelImport, which the Backup page runs before either edition imports),
// and leaves the user on the save they had open (activeAfterImport, in both editions), so their
// next ticks never land in someone else's copy. Old exports still import, labelled the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { activeAfterImport, labelImport, validateTransfer } from '../public/transfer.ts';
import { calculate, catalog } from '../planner.ts';
import type { BrowserWorkspace, Catalog, Recipe, WorkspaceSummary } from '../public/types/index.ts';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
// The first release's full export (2026-09-13), with its original profile.
const firstExport = () => JSON.parse(read('./fixtures/export-2026-09-13.json'));
const recipes: Recipe[] = JSON.parse(read('../recipes.json')).recipes;
const migration = { recipes, pureLimits: catalog().pureLimits };
const exportOf = (names: string[], exportedAt = '2026-10-04T12:05:00.000Z') => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt,
  saves: names.map((name, i) => ({ id: 's' + i, name, activeProfile: 'p', profiles: [] })),
});
const namesOf = (data: unknown) => (data as { saves: { name: string }[] }).saves.map(s => s.name);

const fromOf = (data: unknown) =>
  (data as { saves: { importedFrom?: unknown }[] }).saves.map(s => s.importedFrom);
const AT = '2026-10-04T12:05:00.000Z';

test('labelImport keeps each save its own name and records the file and export date', () => {
  assert.deepEqual(namesOf(labelImport(exportOf(['Coop world', '  Spaced  ']), 'anna.json')), [
    'Coop world',
    'Spaced',
  ]);
  assert.deepEqual(fromOf(labelImport(exportOf(['W']), 'anna.json')), [
    { file: 'anna.json', exportedAt: AT },
  ]);
  // Without a usable date or file name, what is known; with neither, nothing.
  assert.deepEqual(fromOf(labelImport(exportOf(['W'], 'not a date'), 'anna.json')), [
    { file: 'anna.json' },
  ]);
  assert.deepEqual(fromOf(labelImport(exportOf(['W']), '  ')), [{ exportedAt: AT }]);
  assert.deepEqual(fromOf(labelImport(exportOf(['W'], 'not a date'), '  ')), [undefined]);
  // A source the file itself carries (it was an import there) is replaced by this file.
  const twice = exportOf(['W']);
  (twice.saves[0] as Record<string, unknown>).importedFrom = { file: 'older.json' };
  assert.deepEqual(fromOf(labelImport(twice, 'anna.json')), [
    { file: 'anna.json', exportedAt: AT },
  ]);
});

test('validateTransfer keeps only the usable parts of importedFrom', () => {
  const keep = (importedFrom: unknown) =>
    (
      validateTransfer({
        ...firstExport(),
        saves: [{ ...firstExport().saves[0], importedFrom }],
      }).saves[0] as { importedFrom?: unknown }
    ).importedFrom;
  assert.deepEqual(keep({ file: ' a.json ', exportedAt: AT, x: 1 }), {
    file: 'a.json',
    exportedAt: AT,
  });
  assert.deepEqual(keep({ file: 'a.json', exportedAt: 'soon' }), { file: 'a.json' });
  assert.deepEqual(keep({ file: 'f'.repeat(300) }), { file: 'f'.repeat(120) });
  for (const bad of [undefined, null, 'a.json', [], {}, { file: 7 }])
    assert.equal(keep(bad), undefined);
});

test('a name a save already has gets a number, a free one is left alone', () => {
  const mine = 'Coop world';
  const first = namesOf(labelImport(exportOf([mine]), 'satisfactory-full-saves.json', [mine]));
  assert.deepEqual(first, [mine + ' (2)']);
  const later = namesOf(
    labelImport(exportOf([mine]), 'satisfactory-full-saves.json', [mine, ...first]),
  );
  assert.deepEqual(later, [mine + ' (3)']);
  // Two saves of one file with one name are numbered too.
  assert.deepEqual(namesOf(labelImport(exportOf([mine, mine]), 'f.json')), [mine, mine + ' (2)']);
  assert.deepEqual(namesOf(labelImport(exportOf(['Other']), 'f.json', [mine])), ['Other']);
});

test('a number never makes a name longer than 80 characters', () => {
  const long = 'L'.repeat(80);
  const [name] = namesOf(labelImport(exportOf([long]), 'f.json'));
  assert.equal(name, long, 'a name of 80 characters stays whole when it is free');
  const [numbered] = namesOf(labelImport(exportOf([long]), 'f.json', [name!]));
  assert.ok(numbered!.length <= 80 && numbered!.endsWith('… (2)'), numbered);
  // Each label passes the import's own name rule.
  for (const label of [name!, numbered!]) {
    const checked = validateTransfer({
      ...firstExport(),
      saves: [{ ...firstExport().saves[0], name: label }],
    });
    assert.equal(checked.saves[0]!.name, label);
  }
});

test('a damaged file is refused exactly as before: only text names are labelled', () => {
  for (const damaged of [
    null,
    [],
    { saves: 'none' },
    { ...exportOf(['W']), saves: [{ name: 7 }] },
    { ...exportOf(['W']), saves: [{ name: '   ' }] },
  ]) {
    const before = JSON.stringify(damaged);
    assert.equal(JSON.stringify(labelImport(damaged, 'f.json')), before);
  }
  // A file too damaged to import is refused with the same message, labelled or not.
  const message = (data: unknown) => {
    try {
      validateTransfer(data);
      return '';
    } catch (error) {
      return (error as Error).message;
    }
  };
  const bad = {
    ...exportOf(['W']),
    saves: [{ id: 1, name: 'W', activeProfile: 'p', profiles: 3 }],
  };
  assert.equal(message(labelImport(structuredClone(bad), 'f.json')), message(bad));
});

test('activeAfterImport keeps the open save and gives a user without one the last copy', () => {
  const owned = [{ id: 'mine' }];
  const copies = [{ id: 'c1' }, { id: 'c2' }];
  assert.equal(activeAfterImport('mine', owned, copies), 'mine');
  assert.equal(activeAfterImport(null, owned, copies), 'c2');
  assert.equal(activeAfterImport(undefined, [], copies), 'c2');
  assert.equal(activeAfterImport('gone', owned, copies), 'c2', 'a save no longer there');
  assert.equal(activeAfterImport('mine', owned, []), 'mine');
  assert.equal(activeAfterImport(null, [], []), null);
});

const close = (server: Server) => new Promise(resolve => server.close(resolve));
const post = (url: string, endpoint: string, body: unknown) =>
  fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
    body: JSON.stringify(body),
  });

test('Docker edition: an import keeps the open save, and an old export round-trips labelled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-import-copies-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const workspace = async (): Promise<WorkspaceSummary> =>
    (await fetch(url + '/api/workspace')).json();
  try {
    // An empty workspace opens the imported save, as before.
    const first = labelImport(firstExport(), 'export-2026-09-13.json');
    assert.equal((await post(url, '/api/import-saves', first)).status, 200);
    let ws = await workspace();
    const own = ws.saves[0]!;
    assert.equal(ws.activeSave, own.id);
    assert.equal(own.name, 'My Satisfactory save', 'named by the save, not the file');
    assert.equal(own.importedFrom?.file, 'export-2026-09-13.json');
    assert.ok(own.importedFrom?.exportedAt, 'the export date is kept');
    // With a save open, a friend's copy of the same save arrives without moving anyone.
    const exported = await (await fetch(url + '/api/export-saves')).json();
    const friend = labelImport(
      exported,
      'friend.json',
      ws.saves.map(s => s.name),
    );
    const reply = await post(url, '/api/import-saves', friend);
    assert.equal(reply.status, 200);
    ws = await workspace();
    assert.equal(ws.saves.length, 2);
    assert.equal(ws.activeSave, own.id, 'the open save stays the active one');
    const copy = ws.saves[1]!;
    assert.equal(copy.name, own.name + ' (2)', 'a clash gets a number');
    assert.equal(copy.importedFrom?.file, 'friend.json');
    assert.equal(copy.profiles[0]!.name, own.profiles[0]!.name, 'its profiles keep their names');
    assert.equal(copy.profiles[0]!.completed, own.profiles[0]!.completed, 'with their progress');
  } finally {
    await close(server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Pages edition: an import keeps the open save, and an old export round-trips labelled', async () => {
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
  const api = createBrowserApi(store, calculate, {} as Catalog, undefined, async () => migration);
  const importSaves = (body: unknown) =>
    api('/api/import-saves', { body: JSON.stringify(body) }) as Promise<WorkspaceSummary>;
  let ws = await importSaves(labelImport(firstExport(), 'export-2026-09-13.json'));
  const own = ws.saves[0]!;
  assert.equal(data.activeSave, own.id, 'an empty workspace opens the import');
  const exported = await api('/api/export-saves');
  ws = await importSaves(
    labelImport(
      exported,
      'friend.json',
      ws.saves.map(s => s.name),
    ),
  );
  assert.equal(ws.saves.length, 2);
  assert.equal(data.activeSave, own.id, 'the open save stays the active one');
  assert.equal(ws.activeSave, own.id);
  assert.equal(own.name, 'My Satisfactory save', 'named by the save, not the file');
  assert.equal(own.importedFrom?.file, 'export-2026-09-13.json');
  assert.ok(own.importedFrom?.exportedAt, 'the export date is kept');
  assert.equal(ws.saves[1]!.name, own.name + ' (2)', 'a clash gets a number');
  assert.equal(ws.saves[1]!.importedFrom?.file, 'friend.json');
  assert.equal(data.saves[1]!.importedFrom?.file, 'friend.json', 'stored on the save');
  assert.deepEqual(
    data.saves[1]!.profiles[0]!.state.checks,
    data.saves[0]!.profiles[0]!.state.checks,
    'the copy keeps its progress',
  );
});
