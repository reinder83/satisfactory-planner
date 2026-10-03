// Mark done on the lead step moves it to "Done (n)", and focus goes to the next lead's Mark done
// (PlanStep.vue, ui/refocus.ts). Only the lead step has Mark done. When a step comes back above
// the lead while its save is on its way (another tab unticked it, #823), that step is the new
// lead, though it was not among the rows listed when Mark done was pressed: focus still goes to
// its Mark done, not to the "Done (n)" summary (#841). Writes are held until release(), as on a
// slow connection.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, applyUpdate, go, openMigrated, page } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// Every /api/update waits until release() and then answers with the update applied.
function heldUpdates() {
  let waiting: (() => void)[] = [];
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    if (String(path) !== '/api/update')
      return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
    const update: UpdateOp = JSON.parse(String(options.body));
    await new Promise<void>(resolve => waiting.push(resolve));
    return new Response(JSON.stringify(applyUpdate(update)), { status: 200 });
  };
  return {
    release: async () => {
      for (let i = 0; i < 5 && !waiting.length; i++) await settle();
      const now = waiting;
      waiting = [];
      now.forEach(resolve => resolve());
      await settle();
    },
  };
}

const openIds = () => $$('#main [data-open-steps] > .task [data-check]').map(e => e.dataset.check!);
const markDone = () => $<HTMLButtonElement>('#main [data-open-steps] [data-mark-done]')!;
const leadId = () =>
  markDone().closest('.task')?.querySelector<HTMLElement>('[data-check]')?.dataset.check;

beforeEach(async () => {
  page();
  openMigrated();
  go('plan');
  render();
  await nextTick();
});

test('Mark done sends focus to the Mark done of a step that came back above the lead meanwhile', async () => {
  const net = heldUpdates();
  const [first, second] = openIds();
  assert.ok(first && second, 'Phase 3 has at least two open steps');
  assert.equal(leadId(), first);
  markDone().focus();
  markDone().click();
  await net.release();
  assert.equal(state.checks[first], true);
  assert.equal(leadId(), second, 'the second step leads once the first is done');
  markDone().focus();
  markDone().click();
  await settle();
  // Another tab unticked the first step while the second one's save is on its way.
  state.checks[first] = false;
  render();
  await nextTick();
  await net.release();
  assert.equal(state.checks[second], true);
  assert.equal(leadId(), first, 'the first step leads again');
  const focused = document.activeElement as HTMLElement | null;
  assert.ok(focused?.matches('[data-mark-done]'), 'focus is on a Mark done');
  assert.equal(
    focused?.closest('.task')?.querySelector<HTMLElement>('[data-check]')?.dataset.check,
    first,
  );
});
