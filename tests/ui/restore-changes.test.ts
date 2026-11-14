// X-6 (#1352): after "Restore this profile…" the Backup page says what changed, from the progress
// just before and the progress the restore left (public/app/restore-changes.ts, ui/backup/
// RestoreChanges.vue): its heading takes focus, the list names the lines now running and the parts
// delivered, ADA says the same in her words, and Dismiss clears both and puts focus back on the
// button that restored. Cancel shows nothing; leaving the page clears ADA's line.
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { deliveryKey } from '../../public/progression.ts';
import { $, answerConfirms, go, migratedPlan, open, page, stubFetch } from './setup.ts';
import type { ProgressState } from '../../public/types/index.ts';

const plan = migratedPlan();
const phase = '3';
const stage = plan.stages[phase]!;
const rows = stage.rows!;
const part = 'Modular Engine';
// A delivery the plan holds for the phase, whatever the migration put there.
stage.delivery = { [part]: { target: 12000, rate: 10 } };
const key = deliveryKey(phase, part);

beforeEach(() => {
  page();
  open({
    calculated: plan,
    state: {
      checks: { [`calc-${phase}-${rows[0]!.id}`]: true },
      deliveries: { [key]: 4200 },
    },
  });
});

// Restores a backup whose /api/import reply is `reply`.
async function restore(reply: (sent: ProgressState) => ProgressState) {
  stubFetch({ '/api/import': () => reply(state) });
  answerConfirms(true);
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state })],
    'b.json',
  );
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => assert.match($('#toast')!.textContent!, /Backup restored/));
}
const adaText = () => $('#ada-line')?.textContent ?? '';

test('a restore lists what changed, takes focus on the heading and ADA says it too', async () => {
  await restore(before => ({
    ...structuredClone(before),
    checks: {
      ...before.checks,
      [`calc-${phase}-${rows[1]!.id}`]: true,
      [`calc-${phase}-${rows[2]!.id}`]: true,
    },
    deliveries: { [key]: 9800 },
  }));
  const panel = $('[data-restore-changes]')!;
  assert.ok(panel, 'the summary is on the page');
  const heading = panel.querySelector('h2')!;
  assert.equal(heading.id, 'restore-changes-title');
  assert.equal(panel.getAttribute('aria-labelledby'), heading.id);
  assert.equal(document.activeElement, heading, 'the heading has focus');
  const items = [...panel.querySelectorAll('li')].map(li => li.textContent);
  assert.match(items[0]!, /^2 lines now running \(3 of \d+ in the plan\)$/);
  assert.equal(items[1], 'Modular Engine, Phase 3: 4,200 → 9,800 of 12,000 delivered');
  assert.ok(panel.querySelector('.help-pop button'), 'the "?" explains how it is counted');
  assert.match(adaText(), /2 lines now running\. Modular Engine went from 4,200 to 9,800\./);
  assert.match(adaText(), /I will allow it\.$/);
});

test('an identical restore says nothing changed; Dismiss clears it and refocuses the button', async () => {
  await restore(before => structuredClone(before));
  assert.match($('[data-restore-changes-none]')!.textContent!.trim(), /^Nothing changed/);
  assert.match(adaText(), /^The backup matched this profile/);
  $<HTMLButtonElement>('[data-restore-changes-dismiss]')!.click();
  await vi.waitFor(() => assert.equal($('[data-restore-changes]'), null));
  assert.equal(document.activeElement, $('[data-restore-backup]'));
  assert.doesNotMatch(adaText(), /The backup matched/);
});

test('declining the confirmation shows no summary', async () => {
  stubFetch({ '/api/import': () => state });
  answerConfirms(false);
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state })],
    'b.json',
  );
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal($('[data-restore-changes]'), null);
});
