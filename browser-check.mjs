import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createApp } from './server.mjs';
import os from 'node:os';
const { chromium } = await import(
  process.env.PLANNER_PLAYWRIGHT ? pathToFileURL(process.env.PLANNER_PLAYWRIGHT).href : 'playwright'
);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = {
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
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/satisfactory-planner/';
let browser, backend;
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
  const errors = [];
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
  await page.locator('#phase-note').fill('Remember my iron site');
  await page.locator('[data-save-note="phase-1"]').click();
  const check = page.locator('[data-check]').first();
  const key = await check.getAttribute('data-check');
  await check.check();
  await page.waitForTimeout(250);
  await page.reload();
  await page.locator('#phase-note').waitFor();
  assert.equal(await page.locator('#phase-note').inputValue(), 'Remember my iron site');
  assert.ok(await page.locator(`[data-check="${key}"]`).isChecked());
  const api = async (route, body) =>
    page.evaluate(
      async ({ route, body }) =>
        (await import('./browser-api.js')).browserRequest(
          route,
          body ? { method: 'POST', body: JSON.stringify(body) } : {},
        ),
      { route, body },
    );
  const checkStorage = async () => {
    await page.goto(base + '#storage');
    await page.locator('[data-complete-bay="A"]').waitFor();
    const shown = await page
      .locator('.bay')
      .filter({ has: page.locator('[data-complete-bay="A"]') })
      .locator('[data-complete-slot]')
      .evaluateAll(xs => xs.map(x => x.dataset.completeSlot));
    await page.locator('[data-complete-bay="A"]').click();
    await page.waitForFunction(() => document.querySelector('[data-complete-bay="A"]').disabled);
    let s = await api('/api/state');
    for (const id of shown)
      for (const k of ['built', 'labelled', 'connected', 'verified'])
        assert.equal(s.checks['slot-' + id + '-' + k], true);
    await page.locator('[data-complete-slot="A01"]').uncheck();
    await page.waitForFunction(() => !document.querySelector('[data-complete-bay="A"]').disabled);
    assert.equal(await page.locator('#detail').evaluate(x => x.open), false);
    await page.locator('[data-slot="A01"]').click();
    await page.locator('#detail-note').fill('Storage test note');
    await page.locator('#detail [data-save-note]').click();
    await page.waitForFunction(() => !document.querySelector('#detail').open);
    assert.equal((await api('/api/state')).notes['slot-A01'], 'Storage test note');
    await page.locator('[data-slot="A01"]').click();
    await page.locator('#detail-note').fill('  ');
    await page.locator('#detail [data-save-note]').click();
    await page.waitForFunction(() => !document.querySelector('#detail').open);
    assert.equal(Object.hasOwn((await api('/api/state')).notes, 'slot-A01'), false);
    await page.reload();
    await page.locator('[data-complete-slot="A01"]').waitFor();
    assert.equal(await page.locator('[data-complete-slot="A01"]').isChecked(), false);
    for (const id of shown.slice(1))
      assert.ok(await page.locator('[data-complete-slot="' + id + '"]').isChecked());
  };
  await checkStorage();
  const first = (await api('/api/workspace')).saves[0];
  const second = await api('/api/profiles', {
    saveId: first.id,
    name: 'Second profile',
    settings: { phase: '1', goal: 'minimal' },
  });
  assert.equal(Object.keys((await api('/api/state')).checks).length, 0);
  await api('/api/select', { saveId: first.id, profileId: first.activeProfile });
  assert.equal((await api('/api/state')).notes['phase-1'], 'Remember my iron site');
  const exported = await api('/api/export-saves');
  assert.equal(exported.saves[0].profiles.length, 2);
  await api('/api/import-saves', exported);
  assert.equal((await api('/api/workspace')).saves.length, 2);
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
  const write = (p, k) =>
    p.evaluate(
      async k =>
        (await import('./browser-api.js')).browserRequest('/api/update', {
          body: JSON.stringify({ type: 'check', key: k, value: true }),
        }),
      k,
    );
  await Promise.all([write(page, 'parallel-one'), write(tab, 'parallel-two')]);
  const state = await api('/api/state');
  assert.equal(state.checks['parallel-one'], true);
  assert.equal(state.checks['parallel-two'], true);
  // Docker export contains portable handbook and progress, never accounts or sessions.
  backend = await createApp({ dataDir: temp, password: '' });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const backendURL = 'http://127.0.0.1:' + backend.address().port;
  const updateServer = async body =>
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
  const serverState = await (await fetch(backendURL + '/api/state')).json();
  assert.equal(serverState.checks['slot-B01-verified'], true);
  assert.equal(Object.hasOwn(serverState.notes, 'slot-B01'), false);
  const backup = await (await fetch(backendURL + '/api/export-saves')).json();
  assert.ok(backup.saves[0].profiles[0].handbook);
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
  const reexport = await (await fetch(backendURL + '/api/export-saves')).json();
  assert.equal(reexport.saves.length, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(temp, 'browser-check.png'), fullPage: true });
  console.log(
    'Browser checks passed: wizard, WASM calculator, IndexedDB reload, profile isolation, tabs, export/import, Docker roundtrip.',
  );
} finally {
  await browser?.close();
  if (backend) await new Promise(r => backend.close(r));
  await new Promise(r => server.close(r));
  await fs.rm(temp, { recursive: true, force: true });
}
