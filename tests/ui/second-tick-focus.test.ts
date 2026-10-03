// Ticking a build-plan step moves it to "Done (n)", and focus goes to the same control in the step
// that took its place (PlanStep.vue, ui/refocus.ts, SP-42). When a second step is ticked while the
// first one's save is still on its way, the first step is gone from the list by the time the
// second save lands, so the second step's place is found again by its neighbours, not by the
// position it had before the first step left (#822). Writes are held until release(), as on a
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
const box = (id: string) => $<HTMLInputElement>(`#main [data-open-steps] [data-check="${id}"]`)!;
// A tick as the keyboard or a click makes it: the box takes focus, then changes.
const tick = (id: string) => {
  const el = box(id);
  el.focus();
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(async () => {
  page();
  openMigrated();
  go('plan');
  render();
  await nextTick();
});

test('a second step ticked while the first saves sends focus to the step that took its place', async () => {
  const net = heldUpdates();
  const [first, second, third, fourth] = openIds();
  assert.ok(first && second && third && fourth, 'Phase 3 has at least four open steps');
  tick(first);
  await settle();
  tick(second);
  await settle();
  await net.release();
  await net.release();
  assert.equal(state.checks[first], true);
  assert.equal(state.checks[second], true);
  assert.equal(openIds()[0], third, 'the step after the second one leads now');
  assert.equal(
    (document.activeElement as HTMLElement | null)?.dataset.check,
    third,
    'focus is on the step that took the second one’s place, not the one after it',
  );
});

test('a single tick still sends focus to the next step', async () => {
  const net = heldUpdates();
  const [first, second] = openIds();
  tick(first!);
  await net.release();
  assert.equal(state.checks[first!], true);
  assert.equal((document.activeElement as HTMLElement | null)?.dataset.check, second);
});

test('the last open step ticked sends focus to the one before it', async () => {
  const net = heldUpdates();
  const ids = openIds();
  const [before, last] = ids.slice(-2);
  tick(last!);
  await net.release();
  assert.equal(state.checks[last!], true);
  assert.equal((document.activeElement as HTMLElement | null)?.dataset.check, before);
});
