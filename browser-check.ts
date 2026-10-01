import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createApp, initialState } from './server.ts';
import { handbookToPlan } from './public/handbook-migration.ts';
import { catalog } from './planner.ts';
import os from 'node:os';
import type { Page } from 'playwright';
import type {
  BrowserWorkspace,
  ContextReply,
  Handbook,
  Recipe,
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
const source = path.dirname(fileURLToPath(import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-browser-check-'));
// The check serves a copy of the build, taken now (#555). `node build.ts` empties and rewrites
// dist/satisfactory-planner, and `npm test` runs it (handbook-server-migration.test.ts), so a
// build in the same checkout during a run answered a reload or a lazy fetch (recipes.json on the
// upgraded page's first open) with 404 until it finished, and a wait timed out after 30 s.
// A build still running when the check starts is waited for: the copy is kept once the build
// holds calculator-worker.js, the last file build.ts writes (a new build first deletes them
// all), and no file was added, removed or rewritten while it was copied.
const root = path.join(temp, 'site');
const built = path.join(source, 'dist', 'satisfactory-planner'),
  served = path.join(root, 'satisfactory-planner');
// Each file of the build with its size and modification time, in a fixed order.
const listing = async () => {
  const names = (await fs.readdir(built, { recursive: true })).sort();
  const files = await Promise.all(
    names.map(async name => {
      const stat = await fs.stat(path.join(built, name));
      return [name, stat.size, stat.mtimeMs] as const;
    }),
  );
  return { names, files: JSON.stringify(files) };
};
for (let attempt = 1; ; attempt++) {
  const copied = await (async () => {
    const before = await listing();
    await fs.rm(served, { recursive: true, force: true });
    await fs.cp(built, served, { recursive: true });
    return (
      before.names.includes('calculator-worker.js') && before.files === (await listing()).files
    );
  })().catch(() => false);
  if (copied) break;
  if (attempt === 60) {
    await fs.rm(temp, { recursive: true, force: true });
    throw Error('No finished browser edition in dist/satisfactory-planner; run `node build.ts`.');
  }
  if (attempt === 1) console.log('Waiting for the build in dist/satisfactory-planner to finish');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
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
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
// Listening on a TCP port, so the address is an AddressInfo.
const port = (listener: http.Server) => (listener.address() as AddressInfo).port;
const base = 'http://127.0.0.1:' + port(server) + '/satisfactory-planner/';
let browser: import('playwright').Browser | undefined, backend: http.Server | undefined;
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
  page.on('response', response => {
    if (response.status() >= 400)
      errors.push('HTTP ' + response.status() + ': ' + new URL(response.url()).pathname);
  });
  page.on('pageerror', error => {
    errors.push(error.message);
    console.log('Browser error:', error.message);
  });
  page.on('console', message => {
    if (message.type() === 'error') console.log('Console:', message.text());
  });
  await page.goto(base);
  await page.locator('#wizard-form').waitFor();
  // Nothing is saved yet, and the status says so rather than claiming a save (#281).
  assert.ok(await page.getByText('Nothing saved yet', { exact: true }).count());
  assert.equal(await page.getByText('Saved in this browser', { exact: true }).count(), 0);
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
  // The notes live on their own page (#243): the plan links there, and following the link
  // puts focus on the Notes heading.
  await page.locator('[data-phase-notes-link]').waitFor({ timeout: 180000 });
  assert.ok(await page.getByText('Saved in this browser', { exact: true }).count());
  // Tick one step, found by its key (#438): a ticked step folds into "Done (n)" (SP-42), so
  // `.first()` would move on to the next unfinished step while check() still verifies it, and
  // Playwright's retries would go on ticking step after step, sometimes the whole phase.
  const key = await page.locator('#main [data-check]').first().getAttribute('data-check');
  const check = page.locator(`#main [data-check="${key}"]`);
  await check.check();
  assert.equal(
    await page.locator('#main [data-check]:checked').count(),
    1,
    'one step ticked, the one chosen',
  );
  await page.waitForTimeout(250);
  await page.locator('[data-phase-notes-link]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#phase-note-1').waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('#main h1')),
    true,
    'the Notes heading takes focus',
  );
  // Notes save themselves after a pause in typing (#237); the status line says so.
  await page.locator('[data-save-note="phase-1"]').fill('Remember my iron site');
  await page
    .locator('#phase-note-1-status')
    .getByText(/^Saved · /)
    .waitFor();
  await page.locator('[data-save-note="global"]').fill('Seed and routes');
  await page
    .locator('#global-note-status')
    .getByText(/^Saved · /)
    .waitFor();
  // A folded phase opens from the keyboard.
  const later = page.locator('[data-phase-notes="2"]');
  assert.equal(await later.evaluate(details => (details as HTMLDetailsElement).open), false);
  await later.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await later.evaluate(details => (details as HTMLDetailsElement).open), true);
  await page.reload();
  await page.locator('#phase-note-1').waitFor();
  assert.equal(await page.locator('#phase-note-1').inputValue(), 'Remember my iron site');
  assert.equal(await page.locator('#global-note').inputValue(), 'Seed and routes');
  await page.goto(base + '#plan');
  // A ticked step folds into "Done (n)" under the list (SP-42): open it from the keyboard, and
  // the step is there, still ticked, while the next one leads the list.
  const done = page.locator('#main .done-group');
  await done.locator('> summary').focus();
  await page.keyboard.press('Enter');
  const ticked = done.locator(`[data-check="${key}"]`);
  await ticked.waitFor();
  assert.ok(await ticked.isChecked());
  assert.notEqual(
    await page.locator('#main .task.lead [data-check]').getAttribute('data-check'),
    key,
    'the next step leads',
  );
  // A long unbroken word in a step's title or details breaks inside the title column, in edit
  // mode and out of it, rather than running past the row at phone width (#659).
  const longTitle = 'Check Supercalifragilisticexpialidocious at the iron site';
  await page.locator('#add-task [name=title]').fill(longTitle);
  await page.locator('#add-task button[type=submit]').click();
  const longStep = page.locator('#main .task', { hasText: longTitle });
  await longStep.waitFor();
  await page.locator('[data-toggle-plan-edit]').first().click();
  await longStep.locator('[data-edit-task]').click();
  await page
    .locator('[data-task-edit] [name=body]')
    .fill('See https://satisfactory.wiki.gg/wiki/Supercalifragilisticexpialidocious_Plate_Factory');
  await page.locator('[data-task-edit] button[type=submit]').click();
  await longStep.locator('[data-edit-task]').waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  for (const mode of ['edit mode', 'view mode']) {
    if (mode === 'view mode') {
      await page.locator('[data-toggle-plan-edit]').first().click();
      await longStep.locator('[data-edit-task]').waitFor({ state: 'detached' });
    }
    const overflow = await longStep.evaluate(row => {
      (row.querySelector('details') as HTMLDetailsElement).open = true;
      return [...row.querySelectorAll<HTMLElement>('summary, details, details p')]
        .filter(el => el.scrollWidth > el.clientWidth)
        .map(el => el.localName + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
    });
    assert.deepEqual(overflow, [], 'a long word stays inside the title column in ' + mode);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await longStep.locator('.delete-task').click();
  await page.locator('#confirm [data-confirm-ok]').click();
  await longStep.waitFor({ state: 'detached' });
  // While a dialog's body scrolls, its hazard stripe and sticky header keep the top of the
  // dialog: no body content shows above the header (#314). The stripe is the dialog's ::before,
  // so a point on it hits the <dialog> itself.
  await page.goto(base + '#factories');
  await page.locator('[data-calc-factory]').first().click();
  await page.waitForFunction(() => document.querySelector<HTMLDialogElement>('#detail')!.open);
  const topOfDialog = await page.locator('#detail').evaluate((dialog: HTMLDialogElement) => {
    dialog.scrollTop = dialog.scrollHeight;
    const box = dialog.getBoundingClientRect();
    const at = (fromTop: number) =>
      document.elementFromPoint(box.left + box.width / 2, box.top + fromTop);
    return {
      scrolled: dialog.scrollTop > 0,
      stripe: at(3) === dialog,
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
  const detailTop = () =>
    page.locator('#detail').evaluate((dialog: HTMLDialogElement) => dialog.scrollTop);
  const scrollDetail = () =>
    page.locator('#detail').evaluate((dialog: HTMLDialogElement) => {
      dialog.scrollTop = dialog.scrollHeight;
      return dialog.scrollTop;
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
  await page.waitForFunction(
    previous => document.querySelector('#detail h2')?.textContent !== previous,
    from,
  );
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
      const focused = document.activeElement;
      return focused?.matches('#detail .dialog-head [data-check]') ? 'running' : focused?.tagName;
    });
  assert.equal(await firstControl(), 'running', 'opening focuses the Running box');
  const shown = await page.locator('#detail h2').textContent();
  await page.locator('#detail [data-calc-factory]').last().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    previous => document.querySelector('#detail h2')?.textContent !== previous,
    shown,
  );
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
      .evaluateAll(slots => slots.map(slot => slot.dataset.completeSlot ?? ''));
    await page.locator('[data-complete-bay="A"]').click();
    // These functions run in the page, which has the button and the dialog.
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>('[data-complete-bay="A"]')!.disabled,
    );
    const progress = await api<ProgressState>('/api/state');
    for (const id of shown)
      for (const step of ['built', 'labelled', 'connected', 'verified'])
        assert.equal(progress.checks['slot-' + id + '-' + step], true);
    await page.locator('[data-complete-slot="A01"]').uncheck();
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-complete-bay="A"]')!.disabled,
    );
    assert.equal(
      await page.locator('#detail').evaluate((dialog: HTMLDialogElement) => dialog.open),
      false,
    );
    await page.locator('[data-slot="A01"]').click();
    await page.locator('#detail [data-save-note]').fill('Storage test note');
    await page
      .locator('#detail-note-status')
      .getByText(/^Saved · /)
      .waitFor();
    assert.equal((await api<ProgressState>('/api/state')).notes['slot-A01'], 'Storage test note');
    assert.equal(
      await page.locator('#detail').evaluate((dialog: HTMLDialogElement) => dialog.open),
      true,
    );
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
      .evaluateAll(handles =>
        handles.map(handle => (handle as HTMLElement).dataset.dragSlot ?? ''),
      );
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
    const progress = await api<ProgressState>('/api/state');
    assert.equal(progress.checks['slot-A09-verified'], true, 'the checks went along');
    assert.equal(progress.checks['slot-A10-verified'], true);
    assert.equal(progress.checks[`slot-${first}-verified`], undefined);
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
      const progress = await api<ProgressState>('/api/state');
      return JSON.stringify([progress.checks, progress.notes, progress.storageEdits]);
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
      .evaluateAll(positions =>
        positions.map(position => (position as HTMLElement).dataset.drop ?? ''),
      );
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
    const distance = (await page.locator(`[data-drop="${lower}"]`).boundingBox())!.y - cell.y;
    await page.evaluate(distance => scrollBy(0, distance), distance);
    await page.waitForTimeout(300);
    const shown = await page.evaluate(
      ({ x, y }) => ({
        under: [...document.querySelectorAll<HTMLElement>('[data-drop]:not(.dragging)')]
          .filter(position => {
            const rect = position.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          })
          .map(position => position.dataset.drop),
        over: [...document.querySelectorAll<HTMLElement>('.drop-over')].map(
          position => position.dataset.drop,
        ),
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
  const write = (target: Page, checkKey: string) =>
    target.evaluate(
      async checkKey =>
        ((await import('./browser-api.js' as string)) as BrowserApi).browserRequest('/api/update', {
          body: JSON.stringify({ type: 'check', key: checkKey, value: true }),
        }),
      checkKey,
    );
  await Promise.all([write(page, 'parallel-one'), write(tab, 'parallel-two')]);
  const state = await api<ProgressState>('/api/state');
  assert.equal(state.checks['parallel-one'], true);
  assert.equal(state.checks['parallel-two'], true);
  // The browser edition, upgraded (#497, #518): a record holding an original profile with its
  // own handbook, as an import from an earlier release stored it, is migrated on the next open
  // into a calculated profile with its ticks, and the record as it was stays under the second
  // key. Seeded at schema version 1 in a fresh browser profile by a tab standing in for the
  // previous release, which stays open: the upgrade to version 2 closes its connection.
  const upgradedContext = await browser.newContext(),
    upgradedPage = await upgradedContext.newPage(),
    earlierTab = await upgradedContext.newPage();
  upgradedPage.on('pageerror', error => errors.push('Upgraded browser: ' + error.message));
  const handbook = JSON.parse(
    await fs.readFile(path.join(source, 'public', 'plan.json'), 'utf8'),
  ) as Handbook;
  const { recipes } = JSON.parse(await fs.readFile(path.join(source, 'recipes.json'), 'utf8')) as {
    recipes: Recipe[];
  };
  const transcribed = handbookToPlan(handbook, recipes, catalog().pureLimits);
  const handbookFactory = handbook.factories.find(f => transcribed.rows['3']![f.id])!;
  const factoryRow = transcribed.rows['3']![handbookFactory.id]!;
  const seeded = {
    version: 1,
    activeSave: 'upgraded-save',
    lastBackup: null,
    saves: [
      {
        id: 'upgraded-save',
        name: 'Upgraded world',
        activeProfile: 'upgraded-original',
        profiles: [
          {
            id: 'upgraded-original',
            name: 'Original · 50× complete automation',
            kind: 'original',
            handbook,
            state: {
              ...initialState(),
              checks: { ['factory-3-' + handbookFactory.id]: true, 'phase-3-survey': true },
              notes: { global: 'Kept through the upgrade' },
              settings: { phase: '3' },
            },
          },
        ],
      },
    ],
  };
  // The page's own IndexedDB, the database and key the planner uses; with `record`, writes it.
  const storedRecord = (target: Page, key: string, record?: unknown) =>
    target.evaluate(
      async ({ key, record }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          // At the version it has: 2 once the planner has opened it.
          const request = indexedDB.open('satisfactory-planner-browser-v1');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<unknown>((resolve, reject) => {
            const transaction = database.transaction(
              'workspace',
              record ? 'readwrite' : 'readonly',
            );
            const store = transaction.objectStore('workspace');
            const request = record ? store.put(record, key) : store.get(key);
            transaction.oncomplete = () => resolve(record ? undefined : request.result);
            transaction.onabort = () => reject(transaction.error);
          });
        } finally {
          database.close();
        }
      },
      { key, record },
    );
  // Any page of the site shares its storage; the favicon runs none of the planner.
  await earlierTab.goto(base + 'favicon.svg');
  await earlierTab.evaluate(
    record =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('satisfactory-planner-browser-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('workspace');
        request.onsuccess = () => {
          const database = request.result,
            earlier = { closed: false };
          Object.assign(window, { earlier });
          // As every release since 2026-09-26 does.
          database.onversionchange = () => {
            earlier.closed = true;
            database.close();
          };
          const transaction = database.transaction('workspace', 'readwrite');
          transaction.objectStore('workspace').put(record, 'main');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      }),
    seeded,
  );
  await upgradedPage.goto(base + '#plan');
  await upgradedPage.locator('#main [data-check="phase-3-survey"]').waitFor({ state: 'attached' });
  assert.equal(
    await upgradedPage
      .locator('#main [data-check="phase-3-survey"]')
      .evaluate(checkbox => (checkbox as HTMLInputElement).checked),
    true,
    'the guide step is still ticked after the upgrade',
  );
  const upgraded = (await storedRecord(upgradedPage, 'main')) as BrowserWorkspace;
  const migratedOriginal = upgraded.saves[0]!.profiles[0]!;
  assert.equal(migratedOriginal.kind, 'calculated');
  assert.equal(migratedOriginal.handbook, undefined);
  assert.equal(migratedOriginal.plan?.engine, 'handbook-' + handbook.version);
  assert.equal(migratedOriginal.state.checks['calc-3-' + factoryRow], true, 'the factory tick');
  assert.equal(migratedOriginal.state.notes.global, 'Kept through the upgrade');
  assert.deepEqual(
    await storedRecord(upgradedPage, 'pre-handbook'),
    seeded,
    'the pre-migration copy',
  );
  // The tab of the previous release heard of the upgrade and closed, so it cannot file a tick
  // under a handbook key on the migrated profile; on a reload it cannot open the database.
  assert.equal(
    await earlierTab.evaluate(() => {
      // Set by the Object.assign above, so the window's type does not know it.
      const earlier: unknown = Reflect.get(window, 'earlier');
      return typeof earlier === 'object' && earlier !== null && 'closed' in earlier
        ? earlier.closed
        : undefined;
    }),
    true,
    'the earlier tab was told of the upgrade',
  );
  assert.equal(
    await earlierTab.evaluate(
      () =>
        new Promise<string>(resolve => {
          const request = indexedDB.open('satisfactory-planner-browser-v1', 1);
          request.onsuccess = () => {
            request.result.close();
            resolve('opened');
          };
          request.onerror = () => resolve(request.error?.name ?? 'error');
        }),
    ),
    'VersionError',
    'the previous release is refused the upgraded database',
  );
  // Opening it again changes nothing.
  await upgradedPage.reload();
  await upgradedPage.locator('#main [data-check="phase-3-survey"]').waitFor({ state: 'attached' });
  assert.deepEqual(await storedRecord(upgradedPage, 'main'), upgraded);
  await upgradedContext.close();
  // The Docker edition, upgraded from an early release: its single-profile progress.json is
  // handbook progress, which migrates into a calculated profile with the guide (#495). A
  // brand-new server would start with no saves (#496). Its export carries that plan and the
  // progress, never accounts or sessions.
  await fs.writeFile(path.join(temp, 'progress.json'), JSON.stringify(initialState()));
  backend = await createApp({ dataDir: temp, password: '' });
  const listening = backend;
  await new Promise<void>(resolve => listening.listen(0, '127.0.0.1', resolve));
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
  const migrated = backup.saves[0]!.profiles[0]!;
  assert.equal(migrated.kind, 'calculated');
  assert.equal(migrated.handbook, undefined);
  assert.ok(migrated.plan?.guide, 'the migrated plan carries the guide');
  assert.equal(backup.users, undefined);
  assert.equal(backup.sessions, undefined);
  await api('/api/import-saves', backup);
  await page.goto(base + '#plan');
  await page.reload();
  await page.getByText('Build the first three iron halls', { exact: true }).waitFor();
  await checkStorage();
  // Side by side, the first two panels of a .backup-grid share a top edge (#309). The profile
  // imported from the server is a migrated calculated one (#495), whose resources page has
  // several grids.
  await page.goto(base + '#resources');
  await page.locator('.backup-grid > .panel').first().waitFor();
  const gridTops = await page
    .locator('.backup-grid > .panel')
    .evaluateAll(panels => panels.map(p => p.getBoundingClientRect().top));
  assert.ok(gridTops.length >= 2, gridTops.length + ' grid panels');
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
    'Browser checks passed: wizard, WASM calculator, IndexedDB reload, profile isolation, tabs, handbook upgrade, export/import, Docker roundtrip.',
  );
} finally {
  await browser?.close();
  const opened = backend;
  if (opened) await new Promise<void>(resolve => opened.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
  await fs.rm(temp, { recursive: true, force: true });
}
