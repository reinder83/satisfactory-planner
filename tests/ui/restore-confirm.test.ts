// #1217: "Restore this profile…" asks before it replaces anything, with the open profile's
// progress and the file's (backupQuestion in public/app/import-summary.ts). Cancel sends nothing
// and changes nothing; Replace progress restores as before; a file /api/import would refuse is
// refused with its message and nothing is asked.
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, answerConfirms, evil, go, open, page, stubFetch } from './setup.ts';

beforeEach(() => {
  page();
  open({ calculated: true, profileId: 'p', state: { checks: { 'unlock-hub-1': true } } });
});

// Chooses `backup` as the file to restore and waits for the page to settle.
async function choose(backup: unknown) {
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File([JSON.stringify(backup)], 'b.json');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 40));
}
const backupOf = (fileState: unknown, extra: object = {}) => ({
  format: 'satisfactory-planner-backup',
  exportedAt: '2026-10-21T12:05:00.000Z',
  saveName: 'Coop world',
  profileName: 'Main',
  profileId: 'p',
  state: fileState,
  ...extra,
});

test('the restore asks with the progress now and in the file, and Cancel changes nothing', async () => {
  const calls = stubFetch({ '/api/import': () => state });
  const before = structuredClone(state);
  const asked = answerConfirms(false);
  const fileState = { ...structuredClone(state), checks: {}, notes: { global: 'From the file' } };
  await choose(backupOf(fileState));
  assert.equal(asked.length, 1);
  assert.equal(asked[0], `This replaces the progress of “${evil}”: 1 ticked now, 0 in the file.`);
  assert.deepEqual(calls, [], 'nothing was sent');
  assert.deepEqual(state, before, 'the progress is as it was');
  assert.equal($('#toast')!.textContent, '');
});

test('Replace progress restores the backup as before', async () => {
  const fileState = { ...structuredClone(state), checks: {}, notes: { global: 'From the file' } };
  const calls = stubFetch({ '/api/import': () => fileState });
  const asked = answerConfirms(true);
  await choose(backupOf(fileState));
  await vi.waitFor(() => assert.match($('#toast')!.textContent!, /Backup restored/));
  assert.equal(asked.length, 1);
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/api/import'],
  );
  assert.equal(state.notes.global, 'From the file');
});

test('a backup /api/import would refuse is refused with its message, and nothing is asked', async () => {
  const calls = stubFetch({ '/api/import': () => state });
  const asked = answerConfirms(true);
  const refusals: [unknown, RegExp][] = [
    [backupOf(state, { profileId: 'someone-else' }), /^This backup belongs to another profile\./],
    [backupOf(state, { format: 'satisfactory-planner-ticks' }), /^Wrong backup format\.$/],
    [backupOf({ ...state, version: 99 }), /newer planner/],
  ];
  for (const [file, message] of refusals) {
    await choose(file);
    assert.match($('#toast')!.textContent!, message);
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});
