// The browser edition's backup age (SP-40, #275): a status on the Backup page and a short
// version under the sidebar's save indicator, from workspace.lastBackup (public/app/views/
// backup.ts). browserMode is fixed when browser-api.ts loads, so this file sets the Pages
// build's flag before anything is imported.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { PLANNER_BROWSER?: unknown }).PLANNER_BROWSER = true;
});

import { browserMode } from '../../public/browser-api.ts';
import { setWorkspace, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { backupAge, STALE_BACKUP_DAYS } from '../../public/app/views/backup.ts';
import { $, go, open, page } from './setup.ts';

const DAY = 86400000;
const now = Date.parse('2026-09-28T12:00:00Z');
const ago = (days: number) => new Date(now - days * DAY).toISOString();
const withBackup = (lastBackup: string | null) => {
  setWorkspace({ ...workspace, browser: true, lastBackup });
  render();
  return nextTick();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  page();
  open();
});
afterEach(() => vi.useRealTimers());

test('the backup age reads in days, and is stale after a week or with no backup', () => {
  assert.deepEqual(backupAge(null, now), {
    days: null,
    text: 'Never backed up',
    short: 'Never backed up',
    stale: true,
  });
  assert.equal(backupAge(ago(0.2), now).text, 'Backed up today');
  assert.equal(backupAge(ago(1.5), now).text, 'Backed up yesterday');
  assert.equal(backupAge(ago(15), now).text, 'Backed up 15 days ago');
  assert.equal(backupAge(ago(15), now).short, 'Backed up 15d ago');
  assert.equal(backupAge(ago(STALE_BACKUP_DAYS), now).stale, false, 'a week old is still fine');
  assert.equal(backupAge(ago(STALE_BACKUP_DAYS + 1), now).stale, true);
  assert.equal(backupAge('not a date', now).days, null, 'an unreadable time counts as none');
  // A clock that runs behind the export never shows a negative age.
  assert.equal(backupAge(new Date(now + DAY).toISOString(), now).text, 'Backed up today');
});

test('the Backup page shows the age as a status, warn-toned when stale (SP-40)', async () => {
  assert.equal(browserMode, true);
  go('backup');
  await withBackup(null);
  const status = () => $('[data-backup-status]')!;
  assert.ok(status().classList.contains('notice'));
  assert.ok(status().classList.contains('warn'));
  assert.equal(status().querySelector('b')!.textContent, 'Never backed up');
  await withBackup(ago(3));
  assert.ok(status().classList.contains('info'));
  assert.ok(!status().classList.contains('warn'));
  assert.equal(status().querySelector('b')!.textContent, 'Backed up 3 days ago');
  assert.match(status().textContent!, /Last full export /);
  await withBackup(ago(15));
  assert.ok(status().classList.contains('warn'));
  assert.equal(status().querySelector('b')!.textContent, 'Backed up 15 days ago');
  // The age moves on with the clock at the next render, without a new workspace.
  vi.setSystemTime(now + 2 * DAY);
  render();
  await nextTick();
  assert.equal(status().querySelector('b')!.textContent, 'Backed up 17 days ago');
});

test('the sidebar repeats a short backup age under the save indicator, linking to Backup', async () => {
  go('plan');
  await withBackup(ago(2));
  const link = () => $<HTMLAnchorElement>('.sidebar [data-backup-age]')!;
  assert.equal(link().getAttribute('href'), '#backup');
  assert.equal(link().textContent, 'Backed up 2d ago');
  assert.ok(!link().classList.contains('is-stale'));
  assert.ok(
    $('.sidebar .save-status')!.compareDocumentPosition(link()) & Node.DOCUMENT_POSITION_FOLLOWING,
    'just after the save indicator',
  );
  await withBackup(null);
  assert.equal(link().textContent, 'Never backed up');
  assert.ok(link().classList.contains('is-stale'));
});
