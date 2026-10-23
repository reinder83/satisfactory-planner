// #1210 (co-op slice 4): the Docker edition asks for the open profile's progress every few
// seconds while the tab is visible, naming the ETag of the last reply, so an unchanged profile
// costs a 304. A tick saved on another device shows up here without a reload; while a dialog or
// a text field is open, the page is not redrawn under the player and a quiet notice offers
// Refresh instead. Nothing is saved or recalculated.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import {
  LIVE_REFRESH_MS,
  liveChangeHeld,
  pollProgress,
  resumeLiveRefresh,
  startLiveRefresh,
} from '../../public/app/live-refresh.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, ProgressState } from '../../public/types/index.ts';

let phaseOnePlan: CurrentCalculatedPlan | undefined;
const phaseOne = () => structuredClone((phaseOnePlan ??= generatedWith({ phase: '1' })));
const IRON = 'calc-1-Recipe_IngotIron_C';
const box = (id: string) => $<HTMLInputElement>(`#main [data-check="${id}"]`);
const notice = () => $('[data-live-change]');
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};

// The stand-in server: the profile's progress as saved, with an ETag of its revision, and each
// /api/state request with the tag it named.
let saved: ProgressState;
let asked: { tag: string | undefined; status: number }[];
function serve() {
  asked = [];
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const headers = (options.headers ?? {}) as Record<string, string>;
    if (String(path) !== '/api/state')
      return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
    const tag = `"r${saved.revision}"`;
    const status = headers['If-None-Match'] === tag ? 304 : 200;
    asked.push({ tag: headers['If-None-Match'], status });
    if (status === 304) return new Response(null, { status, headers: { ETag: tag } });
    return new Response(JSON.stringify(saved), { headers: { ETag: tag } });
  };
}
// Another device ticks a step: the saved progress moves on.
function tickElsewhere(key: string) {
  saved = structuredClone(saved);
  saved.checks[key] = true;
  saved.revision++;
}

async function show() {
  open({ calculated: phaseOne(), phase: '1' });
  go('plan');
  render();
  await nextTick();
  saved = structuredClone(state);
  serve();
}

beforeEach(() => {
  page();
});
afterEach(() => {
  const detail = document.querySelector<HTMLDialogElement>('#detail');
  if (detail?.open) detail.close();
  vi.useRealTimers();
});

test('a step ticked on another device shows up here, and an unchanged profile costs a 304', async () => {
  await show();
  assert.equal(box(IRON)!.checked, false);
  // Nothing changed yet: the first poll learns the tag, the next one names it and gets 304.
  assert.equal(await pollProgress(), false);
  assert.equal(await pollProgress(), false);
  assert.deepEqual(asked, [
    { tag: undefined, status: 200 },
    { tag: '"r0"', status: 304 },
  ]);
  tickElsewhere(IRON);
  assert.equal(await pollProgress(), true, 'the change is taken');
  await settle();
  assert.equal(state.checks[IRON], true);
  assert.equal(box(IRON)!.checked, true, 'the page shows the other device’s tick');
  assert.equal(notice(), null, 'no notice while nothing was open');
  assert.equal(await pollProgress(), false);
  assert.equal(asked.at(-1)!.status, 304);
});

test('with a dialog open the page is not redrawn; a notice offers Refresh', async () => {
  await show();
  await pollProgress();
  document.querySelector<HTMLDialogElement>('#detail')!.showModal();
  tickElsewhere(IRON);
  assert.equal(await pollProgress(), false, 'held while the dialog is open');
  await settle();
  assert.equal(state.checks[IRON], undefined, 'nothing was redrawn under the player');
  assert.equal(box(IRON)!.checked, false);
  const shown = notice()!;
  assert.ok(shown, 'the notice says a change is waiting');
  assert.ok(shown.classList.contains('info'), 'a quiet notice');
  assert.match(shown.textContent!, /Progress changed on another device\./);
  assert.equal(shown.closest('[role="status"]')?.getAttribute('aria-live'), 'polite');
  // Still held on the next poll (304) while the dialog stays open.
  assert.equal(await pollProgress(), false);
  assert.equal(asked.at(-1)!.status, 304);
  assert.ok(liveChangeHeld());
  // Refresh loads the progress as saved now.
  document.querySelector<HTMLDialogElement>('#detail')!.close();
  $<HTMLButtonElement>('[data-live-refresh]')!.click();
  await settle();
  assert.equal(state.checks[IRON], true);
  assert.equal(box(IRON)!.checked, true);
  assert.equal(notice(), null, 'the notice goes once the change is shown');
});

test('a change held back is taken by a later poll once the page is quiet', async () => {
  await show();
  await pollProgress();
  // Typing in a text field (the search box) holds the change too.
  const field = document.createElement('input');
  field.type = 'search';
  document.querySelector('#main')!.append(field);
  field.focus();
  tickElsewhere(IRON);
  assert.equal(await pollProgress(), false);
  await settle();
  assert.ok(notice());
  field.blur();
  field.remove();
  assert.equal(await pollProgress(), true, 'taken on the next poll');
  await settle();
  assert.equal(box(IRON)!.checked, true);
  assert.equal(notice(), null);
});

test('a change this tab already has (its own save’s reply) shows no notice', async () => {
  await show();
  await pollProgress();
  // This tab's own tick: the save's reply is the server's state, which the poll then sends.
  tickElsewhere(IRON);
  open({ calculated: phaseOne(), phase: '1', state: structuredClone(saved) });
  render();
  assert.equal(await pollProgress(), false);
  await settle();
  assert.equal(notice(), null);
  assert.equal(box(IRON)!.checked, true);
});

test('the timer asks only while the tab is visible', async () => {
  await show();
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('visible');
  startLiveRefresh();
  await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
  assert.equal(asked.length, 1, 'one poll after the interval');
  // Hidden: the listener in listeners.ts pauses it, and nothing is asked.
  visibility.mockReturnValue('hidden');
  resumeLiveRefresh();
  await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);
  assert.equal(asked.length, 1, 'no poll while hidden');
  // Visible again: polling resumes.
  visibility.mockReturnValue('visible');
  resumeLiveRefresh();
  await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
  assert.equal(asked.length, 2);
  visibility.mockReturnValue('hidden');
  resumeLiveRefresh();
  visibility.mockRestore();
});
