// #1052: Backup → Import saves keeps the open profile open, names each copy after the file and
// its export date, and Saves & profiles then says what was imported and offers to open each copy.
// The stand-in server below moves the active save to the import, as releases before #1052 did,
// so the test shows the page stays on its profile whatever the server remembers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import {
  currentProfile,
  currentSave,
  importedSaves,
  setView,
  view,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { answerConfirms, $, $$, evil, go, open, page } from './setup.ts';
import type { WorkspaceSummary } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const friendsExport = (exportedAt = '2026-10-04T12:05:00.000Z') => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt,
  saves: [{ id: 'x', name: evil, activeProfile: 'xp', profiles: [] }],
});

// The requests the page sent, and the names each import carried.
let sent: string[];
let importedNames: string[][];
let summary: WorkspaceSummary;
function server() {
  sent = [];
  importedNames = [];
  summary = structuredClone(workspace);
  let next = 0;
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const route = String(path);
    sent.push(route);
    if (route === '/api/workspace') return new Response(JSON.stringify(summary));
    if (route === '/progression.json')
      return new Response(fs.readFileSync('public/progression.json', 'utf8'));
    if (route === '/api/import-saves') {
      const body = JSON.parse(String(options.body)) as { saves: { name: string }[] };
      importedNames.push(body.saves.map(save => save.name));
      for (const save of body.saves) {
        const id = 'imported-' + ++next;
        summary.saves.push({
          id,
          name: save.name,
          activeProfile: id + '-p',
          profiles: [{ id: id + '-p', name: 'Main', kind: 'calculated', completed: 9, phase: '2' }],
        });
        // As before #1052: the server remembers the import as the active save.
        summary.activeSave = id;
      }
      return new Response(JSON.stringify(summary));
    }
    if (route === '/api/select') return new Response(JSON.stringify(summary));
    if (route.startsWith('/api/context'))
      return new Response(
        JSON.stringify({
          save: { id: 'imported-1', name: summary.saves.at(-1)!.name },
          profile: { id: 'imported-1-p', name: 'Main', kind: 'calculated' },
          state: {
            version: 1,
            revision: 0,
            settings: { phase: '2' },
            checks: {},
            notes: {},
            deliveries: {},
            customTasks: [],
          },
          plan: {
            createdAt: '2026-09-24T10:00:00Z',
            settings: { phase: '2', purity: 'normal', multiplier: 1, powerFactor: 1 },
            stages: {},
            warnings: [],
          },
        }),
      );
    return new Response(JSON.stringify({ error: 'unexpected ' + route }), { status: 500 });
  };
}
async function importFile(data: unknown, name: string) {
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-saves')!;
  const file = new File([JSON.stringify(data)], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  // navigate() changed the hash; the app's hashchange listener draws the page.
  setView(view);
  render();
  await settle();
}

beforeEach(() => {
  page();
  open({ name: 'Mine' });
  server();
  answerConfirms(true);
});

test('an import keeps the open profile and says so, with a way to open the copy', async () => {
  await importFile(friendsExport(), 'anna.json');
  assert.equal(currentSave.id, 's', 'the open save stays open');
  assert.equal(currentProfile.id, 'p');
  assert.ok(!sent.some(route => route.startsWith('/api/context')), 'nothing else was opened');
  assert.ok(!sent.includes('/api/select'), 'nothing else was made active');
  // The copy is named after the file and its export date.
  assert.equal(importedNames.length, 1);
  assert.match(
    importedNames[0]![0]!,
    /^<x-evil.* \(from anna\.json, exported \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/,
  );
  // Saves & profiles says what happened.
  assert.equal(view, 'profiles');
  assert.match($('#toast')!.textContent!, /^Imported a copy\. You are still on “Mine”\./);
  const notice = $('[data-import-notice]')!;
  assert.ok(notice.classList.contains('info'));
  assert.match(notice.textContent!, /Imported 1 save as a new copy:/);
  assert.match(notice.textContent!, /You are still on “Mine” in “Mine”, and nothing in it changed/);
  assert.equal(document.querySelector('x-evil'), null, 'the copy’s name is text');
  // ADA says it too, on this page.
  adaClearFault();
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    setAdaIndex(i);
    seen.push(adaCurrent()!.id);
  }
  assert.ok(seen.includes('imported'));
  // Open takes the user there, through the usual open path.
  const openButton = $<HTMLButtonElement>('[data-open-imported="imported-1"]')!;
  assert.match(openButton.textContent!, /^\s*Open “<x-evil/);
  openButton.click();
  await settle();
  setView(view);
  render();
  await settle();
  assert.ok(sent.includes('/api/select'));
  assert.equal(currentSave.id, 'imported-1');
  assert.deepEqual(importedSaves, [], 'the notice is said once');
});

test('two imports of saves with the same name read differently', async () => {
  await importFile(friendsExport(), 'satisfactory-full-saves.json');
  await importFile(friendsExport('2026-10-05T18:30:00.000Z'), 'satisfactory-full-saves.json');
  await importFile(friendsExport('2026-10-05T18:30:00.000Z'), 'satisfactory-full-saves.json');
  const names = importedNames.map(names => names[0]!);
  assert.equal(new Set(names).size, 3, names.join(' | '));
  assert.ok(names[2]!.endsWith(' · 2'), 'the same file twice is numbered');
  // The page lists each one under its own name.
  go('profiles');
  render();
  await settle();
  const headings = $$('#main .save-panel h2').map(h2 => h2.textContent!.trim());
  for (const name of names) assert.ok(headings.some(heading => heading.includes(name.slice(-20))));
  assert.equal(currentSave.id, 's');
});

test('with no save open, the import opens the copy as before', async () => {
  // The empty workspace's placeholder save (boot() without saves).
  currentSave.id = '';
  summary.saves = [];
  summary.activeSave = null;
  await importFile(friendsExport(), 'anna.json');
  assert.ok(
    sent.some(route => route.startsWith('/api/context')),
    'boot() opened the import',
  );
  assert.equal(currentSave.id, 'imported-1');
  assert.equal($('[data-import-notice]'), null);
});
