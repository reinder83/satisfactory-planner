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
import { persistence } from '../../public/app/storage-persistence.ts';
import { $, $$, go, open, page } from './setup.ts';

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

// BP-1 (#1338): one save-status card in the sidebar says where the saves live and how old the last
// backup is; "Export backup" only shows when one is due.
test('the sidebar card says where the saves live and how old the backup is, quiet after a backup', async () => {
  go('plan');
  const card = () => $('.sidebar [data-save-card]')!;
  const age = () => card().querySelector('[data-backup-age]')?.textContent;
  const button = () => card().querySelector<HTMLAnchorElement>('[data-export-backup]');
  await withBackup(null);
  assert.equal(card().querySelector('[data-save-card-lead]')!.textContent, 'Only in this browser');
  assert.equal(age(), 'Never backed up');
  assert.ok(card().classList.contains('is-warn'));
  assert.equal(button()!.getAttribute('href'), '#backup');
  assert.equal(button()!.textContent, 'Export backup');
  assert.ok(
    $('.sidebar .save-status')!.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING,
    'just after the save indicator',
  );
  await withBackup(ago(0.2));
  assert.equal(age(), 'Backed up today');
  assert.ok(card().classList.contains('is-ok'), 'green after a backup');
  assert.equal(button(), null, 'nothing to nudge');
  await withBackup(ago(2));
  assert.equal(age(), 'Backed up 2 days ago');
  assert.ok(card().classList.contains('is-quiet'));
  assert.equal(button(), null);
  await withBackup(ago(15));
  assert.ok(card().classList.contains('is-warn'), 'a warning again after a week');
  assert.ok(button());
  assert.equal($$('[data-save-card]').length, 1, 'one card, not three');
});

test('the card says the browser may clear the saves when it has not agreed to keep them', async () => {
  go('plan');
  persistence.value = 'not-kept';
  try {
    await withBackup(ago(0.2));
    const card = $('.sidebar [data-save-card]')!;
    assert.equal(
      card.querySelector('[data-save-card-lead]')!.textContent,
      'Your browser may clear these saves',
    );
    assert.equal(card.querySelector('[data-export-backup]'), null, 'backed up today: no nudge');
    await withBackup(ago(3));
    assert.ok($('.sidebar [data-export-backup]'), 'older than today: nudges an export');
    persistence.value = 'kept';
    await withBackup(ago(3));
    assert.equal(
      $('.sidebar [data-save-card-lead]')!.textContent,
      'Only in this browser',
      'kept: the plain lead',
    );
  } finally {
    persistence.value = 'unknown';
  }
});

test('no page but Backup carries the page-top banner that saves stay in this browser', async () => {
  await withBackup(null);
  for (const page of ['plan', 'profiles', 'notes', 'factories'] as const) {
    go(page);
    render();
    await nextTick();
    assert.equal($('#main .notice.info [href="#backup"]'), null, page);
    assert.doesNotMatch($('#main')!.textContent!, /saves stay in this browser/i, page);
  }
  go('backup');
  render();
  await nextTick();
  assert.match($('#main')!.textContent!, /Your saves stay in this browser/);
});
