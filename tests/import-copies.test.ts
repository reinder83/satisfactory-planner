// #1052: importing a full-save file (a friend's export or share) adds copies named after the file
// and its export date (labelImport, which the Backup page runs before either edition imports),
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
// The local time as labelImport writes it, so the test holds in any time zone.
const local = (iso: string) => {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
};
const exportOf = (names: string[], exportedAt = '2026-10-04T12:05:00.000Z') => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt,
  saves: names.map((name, i) => ({ id: 's' + i, name, activeProfile: 'p', profiles: [] })),
});
const namesOf = (data: unknown) => (data as { saves: { name: string }[] }).saves.map(s => s.name);

test('labelImport names each copy after its file and export date', () => {
  const at = local('2026-10-04T12:05:00.000Z');
  assert.deepEqual(namesOf(labelImport(exportOf(['Coop world', '  Spaced  ']), 'anna.json')), [
    `Coop world (from anna.json, exported ${at})`,
    `Spaced (from anna.json, exported ${at})`,
  ]);
  // Without a usable date or file name, what is known.
  assert.deepEqual(namesOf(labelImport(exportOf(['W'], 'not a date'), 'anna.json')), [
    'W (from anna.json)',
  ]);
  assert.deepEqual(namesOf(labelImport(exportOf(['W'], 'not a date'), '  ')), ['W (imported)']);
});

test('two imports of saves with the same name read differently', () => {
  const mine = 'Coop world';
  const first = namesOf(labelImport(exportOf([mine]), 'satisfactory-full-saves.json', [mine]));
  const later = namesOf(
    labelImport(exportOf([mine], '2026-10-05T18:30:00.000Z'), 'satisfactory-full-saves.json', [
      mine,
      ...first,
    ]),
  );
  assert.notEqual(first[0], mine);
  assert.notEqual(later[0], first[0], 'another export date');
  // The same file twice, or two saves of one file with one name, are numbered.
  const again = namesOf(
    labelImport(exportOf([mine]), 'satisfactory-full-saves.json', [mine, ...first]),
  );
  assert.equal(again[0], first[0] + ' · 2');
  const twins = namesOf(labelImport(exportOf([mine, mine]), 'f.json'));
  assert.equal(twins[1], twins[0] + ' · 2');
});

test('a label never makes a name longer than 80 characters, and keeps the file and date', () => {
  const long = 'L'.repeat(80);
  const file = 'a-very-long-file-name-somebody-sent-over-chat.json';
  const [name] = namesOf(labelImport(exportOf([long]), file));
  assert.ok(name!.length <= 80, name);
  assert.match(name!, /^L+… \(from a-very-long-file-name-somebo/);
  assert.match(name!, /…, exported \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
  const [numbered] = namesOf(labelImport(exportOf([long]), file, [name!]));
  assert.ok(numbered!.length <= 80 && numbered!.endsWith(' · 2'), numbered);
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
    assert.match(own.name, /^My Satisfactory save \(from export-2026-09-13\.json, exported /);
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
    assert.notEqual(copy.name, own.name, 'the copy reads differently');
    assert.match(copy.name, /\(from friend\.json, exported \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
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
  assert.notEqual(ws.saves[1]!.name, own.name);
  assert.match(ws.saves[1]!.name, /\(from friend\.json, exported /);
  assert.deepEqual(
    data.saves[1]!.profiles[0]!.state.checks,
    data.saves[0]!.profiles[0]!.state.checks,
    'the copy keeps its progress',
  );
});
