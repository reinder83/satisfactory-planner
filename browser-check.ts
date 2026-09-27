import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createApp } from './server.ts';
import os from 'node:os';
import type { Page } from 'playwright';
import type {
  ContextReply,
  ProgressState,
  SaveExport,
  StoredPayoff,
  WorkspaceSummary,
} from './public/types/index.ts';
// The shipped browser-api.js is public/browser-api.ts with its types stripped.
type BrowserApi = typeof import('./public/browser-api.ts');
const { chromium }: typeof import('playwright') = await import(
  process.env.PLANNER_PLAYWRIGHT ? pathToFileURL(process.env.PLANNER_PLAYWRIGHT).href : 'playwright'
);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = http.createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) throw Error();
    res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404);
    res.end('Missing');
  }
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
// Listening on a TCP port, so the address is an AddressInfo.
const port = (s: http.Server) => (s.address() as AddressInfo).port;
const base = 'http://127.0.0.1:' + port(server) + '/satisfactory-planner/';
let browser: import('playwright').Browser | undefined, backend: http.Server | undefined;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-browser-check-'));
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLANNER_BROWSER_CHANNEL
      ? { channel: process.env.PLANNER_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext(),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('response', r => {
    if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + new URL(r.url()).pathname);
  });
  page.on('pageerror', e => {
    errors.push(e.message);
    console.log('Browser error:', e.message);
  });
  page.on('console', m => {
    if (m.type() === 'error') console.log('Console:', m.text());
  });
  await page.goto(base);
  await page.locator('#wizard-form').waitFor();
  assert.ok(await page.getByText('Saved in this browser', { exact: true }).count());
  // A brand new browser workspace opens on the guided start. Answer its first
  // question, then take the escape hatch: All settings must arrive at the step
  // that owns the same question with the answer already carried across.
  await page.locator('.guided-card').first().waitFor();
  await page.locator('input[name="guided:phase"][value="2"]').check();
  await page.locator('[name=saveName]').fill('Browser test');
  await page.locator('[data-guided-advanced]').click();
  await page.locator('[data-wizard-step="1"]').waitFor();
  assert.equal(
    await page.locator('[name=phase]').inputValue(),
    '2',
    'the guided answer carried into All settings',
  );
  await page.locator('[name=phase]').selectOption('1');
  await page.locator('[data-wizard-step="2"]').click();
  await page.locator('[name=storage]').selectOption('construction');
  await page.locator('[data-wizard-step="3"]').click();
  await page.locator('[name=profileName]').fill('First profile');
  await page.locator('[data-wizard-step="5"]').click();
  console.log('Calculating browser plan');
  await page
    .getByRole('button', { name: 'Create profile', exact: true })
    .waitFor({ timeout: 180000 });
  console.log('Saving browser profile');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.locator('#phase-note').waitFor({ timeout: 180000 });
  // Notes save themselves after a pause in typing (#237); the status line says so.
  await page.locator('[data-save-note="phase-1"]').fill('Remember my iron site');
  await page
    .locator('#phase-note-status')
    .getByText(/^Saved · /)
    .waitFor();
  const check = page.locator('[data-check]').first();
  const key = await check.getAttribute('data-check');
  await check.check();
  await page.waitForTimeout(250);
  await page.reload();
  await page.locator('#phase-note').waitFor();
  assert.equal(await page.locator('#phase-note').inputValue(), 'Remember my iron site');
  assert.ok(await page.locator(`[data-check="${key}"]`).isChecked());
  // Calls the page's own API, as the interface does. `T` is the reply's shape.
  const api = async <T = unknown>(route: string, body?: unknown) =>
    page.evaluate(
      async ({ route, body }) => {
        // Sent as the interface's fetch-style options; browserRequest reads the body.
        const options: RequestInit = body ? { method: 'POST', body: JSON.stringify(body) } : {};
        // A path in the published site, which TypeScript cannot resolve from here.
        const { browserRequest } = (await import('./browser-api.js' as string)) as BrowserApi;
        return browserRequest(route, options) as Promise<T>;
      },
      { route, body },
    );
  // Hard-drive payoff (#203): the ranking runs on the real worker and is stored with the profile.
  console.log('Ranking alternates on the worker');
  const payoff = await api<StoredPayoff>('/api/rank-alternates', { phase: '1' });
  assert.equal(payoff.ranking.phase, '1');
  assert.ok(payoff.ranking.total > 0);
  assert.equal(payoff.ranking.candidates.length, payoff.ranking.total);
  assert.deepEqual((await api<ContextReply>('/api/context')).payoff, payoff);
  const checkStorage = async () => {
    await page.goto(base + '#storage');
    await page.locator('[data-complete-bay="A"]').waitFor();
    const shown = await page
      .locator('.bay')
      .filter({ has: page.locator('[data-complete-bay="A"]') })
      .locator('[data-complete-slot]')
      .evaluateAll(xs => xs.map(x => x.dataset.completeSlot ?? ''));
    await page.locator('[data-complete-bay="A"]').click();
    // These functions run in the page, which has the button and the dialog.
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>('[data-complete-bay="A"]')!.disabled,
    );
    let s = await api<ProgressState>('/api/state');
    for (const id of shown)
      for (const k of ['built', 'labelled', 'connected', 'verified'])
        assert.equal(s.checks['slot-' + id + '-' + k], true);
    await page.locator('[data-complete-slot="A01"]').uncheck();
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-complete-bay="A"]')!.disabled,
    );
    assert.equal(await page.locator('#detail').evaluate((x: HTMLDialogElement) => x.open), false);
    await page.locator('[data-slot="A01"]').click();
    await page.locator('#detail [data-save-note]').fill('Storage test note');
    await page
      .locator('#detail-note-status')
      .getByText(/^Saved · /)
      .waitFor();
    assert.equal((await api<ProgressState>('/api/state')).notes['slot-A01'], 'Storage test note');
    assert.equal(await page.locator('#detail').evaluate((x: HTMLDialogElement) => x.open), true);
    await page.locator('#detail [data-close]').click();
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#detail')!.open);
    await page.locator('[data-slot="A01"]').click();
    assert.equal(await page.locator('#detail-note').inputValue(), 'Storage test note');
    // Emptying a note deletes it; closing the dialog sends it without waiting for the pause.
    await page.locator('#detail-note').fill('  ');
    await page.locator('#detail [data-close]').click();
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#detail')!.open);
    for (
      let i = 0;
      Object.hasOwn((await api<ProgressState>('/api/state')).notes, 'slot-A01');
      i++
    ) {
      assert.ok(i < 50, 'the emptied note is deleted');
      await page.waitForTimeout(100);
    }
    await page.reload();
    await page.locator('[data-complete-slot="A01"]').waitFor();
    assert.equal(await page.locator('[data-complete-slot="A01"]').isChecked(), false);
    for (const id of shown.slice(1))
      assert.ok(await page.locator('[data-complete-slot="' + id + '"]').isChecked());
  };
  await checkStorage();
  // The browser workspace has the save the wizard just created.
  const first = (await api<WorkspaceSummary>('/api/workspace')).saves[0]!;
  await api('/api/profiles', {
    saveId: first.id,
    name: 'Second profile',
    settings: { phase: '1', goal: 'minimal' },
  });
  assert.equal(Object.keys((await api<ProgressState>('/api/state')).checks).length, 0);
  await api('/api/select', { saveId: first.id, profileId: first.activeProfile });
  assert.equal((await api<ProgressState>('/api/state')).notes['phase-1'], 'Remember my iron site');
  const exported = await api<SaveExport>('/api/export-saves');
  assert.equal(exported.saves[0]!.profiles.length, 2);
  await api('/api/import-saves', exported);
  assert.equal((await api<WorkspaceSummary>('/api/workspace')).saves.length, 2);
  const separate = await browser.newContext(),
    other = await separate.newPage();
  await other.goto(base);
  await other.locator('#wizard-form').waitFor();
  await other.locator('.guided-card').first().waitFor();
  assert.equal(
    await other.locator('[name=saveName]').inputValue(),
    '',
    'a separate browser profile starts at the guided start with nothing filled in',
  );
  // Cross-tab transactions must preserve independent checks.
  const tab = await context.newPage();
  await tab.goto(base);
  await tab.locator('#main').waitFor();
  const write = (p: Page, k: string) =>
    p.evaluate(
      async k =>
        ((await import('./browser-api.js' as string)) as BrowserApi).browserRequest('/api/update', {
          body: JSON.stringify({ type: 'check', key: k, value: true }),
        }),
      k,
    );
  await Promise.all([write(page, 'parallel-one'), write(tab, 'parallel-two')]);
  const state = await api<ProgressState>('/api/state');
  assert.equal(state.checks['parallel-one'], true);
  assert.equal(state.checks['parallel-two'], true);
  // Docker export contains portable handbook and progress, never accounts or sessions.
  backend = await createApp({ dataDir: temp, password: '' });
  const listening = backend;
  await new Promise<void>(r => listening.listen(0, '127.0.0.1', r));
  const backendURL = 'http://127.0.0.1:' + port(listening);
  const updateServer = async (body: unknown) =>
    fetch(backendURL + '/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await updateServer({
        type: 'checks',
        keys: ['slot-B01-built', 'slot-B01-labelled', 'slot-B01-connected', 'slot-B01-verified'],
        value: true,
      })
    ).status,
    200,
  );
  await updateServer({ type: 'note', key: 'slot-B01', value: 'Old note' });
  await updateServer({ type: 'note', key: 'slot-B01', value: '' });
  const serverState: ProgressState = await (await fetch(backendURL + '/api/state')).json();
  assert.equal(serverState.checks['slot-B01-verified'], true);
  assert.equal(Object.hasOwn(serverState.notes, 'slot-B01'), false);
  // Typed with the fields the export must not have, to check they are absent.
  const backup: SaveExport & { users?: unknown; sessions?: unknown } = await (
    await fetch(backendURL + '/api/export-saves')
  ).json();
  assert.ok(backup.saves[0]!.profiles[0]!.handbook);
  assert.equal(backup.users, undefined);
  assert.equal(backup.sessions, undefined);
  await api('/api/import-saves', backup);
  await page.goto(base + '#plan');
  await page.reload();
  await page.getByText('Build the first three iron halls', { exact: true }).waitFor();
  await checkStorage();
  const roundtrip = await fetch(backendURL + '/api/import-saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
    body: JSON.stringify(exported),
  });
  assert.equal(roundtrip.status, 200);
  const reexport: SaveExport = await (await fetch(backendURL + '/api/export-saves')).json();
  assert.equal(reexport.saves.length, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(temp, 'browser-check.png'), fullPage: true });
  console.log(
    'Browser checks passed: wizard, WASM calculator, IndexedDB reload, profile isolation, tabs, export/import, Docker roundtrip.',
  );
} finally {
  await browser?.close();
  const opened = backend;
  if (opened) await new Promise<void>(r => opened.close(() => r()));
  await new Promise<void>(r => server.close(() => r()));
  await fs.rm(temp, { recursive: true, force: true });
}
