// After a progress backup is restored, the Backup page says how many records the restore newly
// kept for review in Notes, under "From the original plan" (#760, restoreMessage in
// public/app/views/backup.ts). A restore that keeps none there says only "Backup restored."
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, answerConfirms, go, open, page, stubFetch } from './setup.ts';
import type { HandbookOrigin, ProgressState } from '../../public/types/index.ts';

const origin = (checks: Record<string, boolean>): HandbookOrigin => ({
  version: '2026-09-13',
  unmapped: { checks, notes: {}, assignments: {} },
});

beforeEach(() => {
  page();
  // A profile moved from the original plan, with one tick already waiting for review.
  open({
    calculated: true,
    state: { version: 12, handbookOrigin: origin({ 'factory-3-wire': true }) },
  });
});

// Restores a backup whose /api/import reply is `reply`, and returns the toast's text.
async function restore(reply: (sent: ProgressState) => ProgressState) {
  stubFetch({ '/api/import': () => reply(state) });
  answerConfirms(true);
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state: {} })],
    'b.json',
  );
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => assert.match($('#toast')!.textContent!, /Backup restored/));
  return $('#toast')!.textContent;
}

test('a restore that keeps records for review says how many, and that they are in Notes', async () => {
  const text = await restore(before => ({
    ...structuredClone(before),
    handbookOrigin: origin({
      'factory-3-wire': true,
      'factory-3-plastic': true,
      'factory-4-rubber': false,
    }),
  }));
  // The tick that was already waiting is not counted again.
  assert.equal(text, 'Backup restored. 2 items from the original plan need your review in Notes.');
  assert.equal(Object.keys(state.handbookOrigin!.unmapped.checks).length, 3);
});

test('a restore that keeps nothing new for review says only "Backup restored."', async () => {
  assert.equal(await restore(before => structuredClone(before)), 'Backup restored.');
});
