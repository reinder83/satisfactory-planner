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
  // While a dialog's body scrolls, its hazard stripe and sticky header keep the top of the
  // dialog: no body content shows above the header (#314). The stripe is the dialog's ::before,
  // so a point on it hits the <dialog> itself.
  await page.goto(base + '#factories');
  await page.locator('[data-calc-factory]').first().click();
  await page.waitForFunction(() => document.querySelector<HTMLDialogElement>('#detail')!.open);
  const topOfDialog = await page.locator('#detail').evaluate((d: HTMLDialogElement) => {
    d.scrollTop = d.scrollHeight;
    const box = d.getBoundingClientRect();
    const at = (dy: number) => document.elementFromPoint(box.left + box.width / 2, box.top + dy);
    return {
      scrolled: d.scrollTop > 0,
      stripe: at(3) === d,
      head: !!at(10)?.closest('.dialog-head'),
    };
  });
  assert.deepEqual(
    topOfDialog,
    { scrolled: true, stripe: true, head: true },
    'the scrolled dialog shows only its stripe and header at the top',
  );
  await page.locator('#detail [data-close]').click();
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#detail')!.open);
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
  // Every dialog opens at the top (#316): the <dialog> is the scroll container and kept its
  // offset while closed, and while a link inside it put another factory in its place.
  const detailTop = () => page.locator('#detail').evaluate((d: HTMLDialogElement) => d.scrollTop);
  const scrollDetail = () =>
    page.locator('#detail').evaluate((d: HTMLDialogElement) => {
      d.scrollTop = d.scrollHeight;
      return d.scrollTop;
    });
  await page.goto(base + '#factories');
  await page.locator('[data-calc-factory]').first().click();
  await page.waitForFunction(() => document.querySelector<HTMLDialogElement>('#detail')!.open);
  assert.ok((await scrollDetail()) > 0, 'the factory dialog scrolls');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#detail')!.open);
  await page.locator('[data-calc-factory]').first().click();
  await page.waitForFunction(() => document.querySelector<HTMLDialogElement>('#detail')!.open);
  assert.equal(await detailTop(), 0, 'reopened at the top');
  const inner = page.locator('#detail [data-calc-factory]').last();
  const from = await page.locator('#detail h2').textContent();
  assert.ok((await scrollDetail()) > 0);
  await inner.click();
  await page.waitForFunction(t => document.querySelector('#detail h2')?.textContent !== t, from);
  assert.equal(await detailTop(), 0, 'a factory opened from the dialog starts at the top');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#detail')!.open);
  // By keyboard, a factory link inside the dialog moves focus into the dialog that takes its
  // place, to its first control as on opening (#319), and Escape returns it to the card.
  const opener = page.locator('.factory-card [data-calc-factory]').first();
  const openerId = await opener.getAttribute('data-calc-factory');
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector<HTMLDialogElement>('#detail')!.open);
  const firstControl = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a?.matches('#detail .dialog-head [data-check]') ? 'running' : a?.tagName;
    });
  assert.equal(await firstControl(), 'running', 'opening focuses the Running box');
  const shown = await page.locator('#detail h2').textContent();
  await page.locator('#detail [data-calc-factory]').last().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(t => document.querySelector('#detail h2')?.textContent !== t, shown);
  assert.equal(await firstControl(), 'running', 'the dialog put in its place takes focus');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#detail')!.open);
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-calc-factory')),
    openerId,
    'Escape returns focus to the card that opened the first dialog',
  );
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
  // Drag and drop in the storage room (#208, #292): a container dropped on the position past the
  // end of its bay moves there with its checks, and the bay is drawn again in full. A save as quick
  // as this edition's used to redraw the bay in the middle of dnd-kit's drop, which left it half
  // drawn (the moved container missing, a blank position) until a reload.
  const dragTo = async (from: string, to: string) => {
    const bayA = page.locator('.bay').filter({ has: page.locator('[data-complete-bay="A"]') });
    await bayA.locator('.bay-items').scrollIntoViewIfNeeded();
    const handle = (await page.locator(`[data-drag-slot="${from}"]`).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 10, handle.y + handle.height / 2 + 10, {
      steps: 5,
    });
    const target = (await page.locator(`[data-drop="${to}"]`).boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 20,
    });
    await page.mouse.up();
    await page.locator(`[data-slot="${to}"]`).waitFor();
  };
  const checkDragDrop = async () => {
    await page.locator('[data-toggle-layout]').click();
    const filled = await page
      .locator('.bay')
      .filter({ has: page.locator('[data-complete-bay="A"]') })
      .locator('[data-drag-slot]')
      .evaluateAll(xs => xs.map(x => (x as HTMLElement).dataset.dragSlot ?? ''));
    const [first, second] = filled.slice(-2);
    assert.ok(first && second, 'bay A has two containers to move');
    const names = await Promise.all(
      [first, second].map(id => page.locator(`[data-slot="${id}"] span`).textContent()),
    );
    // Twice: the second drop goes to the position the first one made room for (A10).
    await dragTo(first, 'A09');
    await page.locator('[data-drop="A10"].drop-new').waitFor();
    await dragTo(second, 'A10');
    const shown = async () => ({
      a09: await page.locator('[data-slot="A09"] span').textContent(),
      a10: await page.locator('[data-slot="A10"] span').textContent(),
      left: await page.locator(`[data-slot="${first}"], [data-slot="${second}"]`).count(),
      reserved: await page.locator(`[data-drop="${first}"], [data-drop="${second}"]`).count(),
    });
    assert.deepEqual(await shown(), { a09: names[0], a10: names[1], left: 0, reserved: 2 });
    const s = await api<ProgressState>('/api/state');
    assert.equal(s.checks['slot-A09-verified'], true, 'the checks went along');
    assert.equal(s.checks['slot-A10-verified'], true);
    assert.equal(s.checks[`slot-${first}-verified`], undefined);
    await page.reload();
    await page.locator('[data-slot="A10"]').waitFor();
    // The reload leaves edit mode; reserved positions are drawn outside it too.
    assert.deepEqual(await shown(), { a09: names[0], a10: names[1], left: 0, reserved: 2 });
  };
  await checkDragDrop();
  // A drop let go away from every position puts the card back and saves nothing (#298): in the
  // aisle beside the bay, where the dragged card still overlaps a position, and below the window
  // while the page auto-scrolls, where positions out of sight lie under the pointer.
  const checkStrayDrop = async () => {
    await page.locator('[data-toggle-layout]').click();
    const bayA = page.locator('.bay').filter({ has: page.locator('[data-complete-bay="A"]') });
    const from = (await bayA.locator('[data-drag-slot]').first().getAttribute('data-drag-slot'))!;
    const saved = async () => {
      const s = await api<ProgressState>('/api/state');
      return JSON.stringify([s.checks, s.notes, s.storageEdits]);
    };
    const before = await saved();
    const strayDrop = async (where: 'aisle' | 'below') => {
      // In the middle of the window, away from the edges where the page auto-scrolls.
      await page
        .locator(`[data-drop="${from}"]`)
        .evaluate(cell => cell.scrollIntoView({ block: 'center' }));
      const handle = (await page.locator(`[data-drag-slot="${from}"]`).boundingBox())!;
      // Bay A's fourth position ends its row; the gap to the next bay or the aisle lies beyond.
      const last = (await bayA.locator('[data-drop]').nth(3).boundingBox())!;
      const x = handle.x + handle.width / 2,
        y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y + 10, { steps: 5 });
      if (where === 'aisle') await page.mouse.move(last.x + last.width + 12, y, { steps: 20 });
      else await page.mouse.move(x, page.viewportSize()!.height + 60, { steps: 20 });
      await page.waitForTimeout(800);
      await page.mouse.up();
      await page.waitForTimeout(500);
      assert.equal(await saved(), before, `a drop ${where} saves nothing`);
      await page.locator(`[data-drag-slot="${from}"]`).waitFor();
    };
    await strayDrop('aisle');
    await strayDrop('below');
    await page.reload();
    await page.locator(`[data-slot="${from}"]`).waitFor();
    assert.equal(await saved(), before);
  };
  await checkStrayDrop();
  // While the page scrolls under a pointer held still (an auto-scroll, the wheel), the highlight
  // moves to the position now under the pointer (#303). dnd-kit kept it on the one that had
  // scrolled away until the pointer moved again.
  const checkScrollFollow = async () => {
    await page.locator('[data-toggle-layout]').click();
    const bayA = page.locator('.bay').filter({ has: page.locator('[data-complete-bay="A"]') });
    const from = (await bayA.locator('[data-drag-slot]').first().getAttribute('data-drag-slot'))!;
    // Two positions of bay A, one above the other (a row holds four), neither the one picked up.
    const ids = await bayA
      .locator('[data-drop]')
      .evaluateAll(xs => xs.map(x => (x as HTMLElement).dataset.drop ?? ''));
    const column = [1, 2, 3].find(i => ids[i] !== from && ids[i + 4] && ids[i + 4] !== from)!;
    const [upper, lower] = [ids[column]!, ids[column + 4]!];
    await page
      .locator(`[data-drop="${upper}"]`)
      .evaluate(cell => cell.scrollIntoView({ block: 'center' }));
    const handle = (await page.locator(`[data-drag-slot="${from}"]`).boundingBox())!;
    const cell = (await page.locator(`[data-drop="${upper}"]`).boundingBox())!;
    const x = cell.x + cell.width / 2,
      y = cell.y + cell.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 10, handle.y + handle.height / 2 + 10, {
      steps: 5,
    });
    await page.mouse.move(x, y, { steps: 20 });
    await page.locator(`[data-drop="${upper}"].drop-over`).waitFor();
    const dy = (await page.locator(`[data-drop="${lower}"]`).boundingBox())!.y - cell.y;
    await page.evaluate(dy => scrollBy(0, dy), dy);
    await page.waitForTimeout(300);
    const shown = await page.evaluate(
      ({ x, y }) => ({
        under: [...document.querySelectorAll<HTMLElement>('[data-drop]:not(.dragging)')]
          .filter(c => {
            const r = c.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          })
          .map(c => c.dataset.drop),
        over: [...document.querySelectorAll<HTMLElement>('.drop-over')].map(c => c.dataset.drop),
      }),
      { x, y },
    );
    assert.deepEqual(
      shown.under,
      [lower],
      'the page scrolled the lower position under the pointer',
    );
    assert.deepEqual(shown.over, [lower], 'the highlight followed the scroll');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    // Once the card is back, dnd-kit's stand-in beside it is gone.
    await page.waitForFunction(
      from => document.querySelectorAll(`[data-drag-slot="${from}"]`).length === 1,
      from,
    );
    await page.locator('[data-toggle-layout]').click();
  };
  await checkScrollFollow();
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
  // Side by side, the two panels of a .backup-grid share a top edge (#309): the handbook's
  // resources page has one in this edition, the server's Backup page two.
  await page.goto(base + '#resources');
  await page.locator('.backup-grid > .panel').first().waitFor();
  const gridTops = await page
    .locator('.backup-grid > .panel')
    .evaluateAll(panels => panels.map(p => p.getBoundingClientRect().top));
  assert.equal(gridTops.length, 2);
  assert.equal(gridTops[1], gridTops[0], 'the second grid panel starts level with the first');
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
