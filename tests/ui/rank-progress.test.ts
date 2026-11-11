// "Rank alternates" shows its progress, can be cancelled and keeps a partial ranking (BUG-7,
// #1332): ui/plan/PayoffPanel.vue on the Docker edition's requests (the server's progress poll
// and cancel route), over app/rank-job.ts, which outlives the panel.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { rankRun } from '../../public/app/ui/plan/rank-state.ts';
import { setPayoff } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, catalog, generated as makeGenerated, go, open, page } from './setup.ts';
import type {
  AlternatePayoff,
  StoredCalculatedPlan,
  StoredPayoff,
} from '../../public/types/index.ts';

const generated = makeGenerated();
const alternates = catalog().alternates;
const entry = (i: number): AlternatePayoff => ({
  id: alternates[i]!.id,
  name: 'Alt ' + i,
  machine: 'Constructor',
  phase: 2,
  status: 'better',
  buildings: -(i + 1),
  raw: {},
  rawTotal: 0,
  powerMW: 0,
  hours: 0,
});
// A ranking of 58 alternates of which `checked` were checked; the rest were not.
const ranked = (checked: number, stopped: boolean): StoredPayoff => ({
  planCreatedAt: generated.createdAt,
  rankedAt: '2026-11-11T12:00:00Z',
  ranking: {
    phase: '3',
    base: { buildings: 100, rawTotal: 1000, requiredMW: 400, hours: 10 },
    candidates: Array.from({ length: checked }, (_, i) => entry(i)),
    total: 58,
    stopped,
    elapsedMs: 1200,
  },
});

// A server whose ranking stays open until the test finishes it, with the progress the poll reads.
function server() {
  const state = {
    calls: [] as string[],
    progress: { running: true, queued: false, done: 0, total: 58 } as Record<string, unknown>,
    finish: (_reply: StoredPayoff) => {},
    partial: ranked(3, true),
  };
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = String(input);
    state.calls.push(path);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path.startsWith('/api/rank-alternates'))
      return new Promise<Response>(resolve => {
        state.finish = result => resolve(reply(result));
      });
    if (path.startsWith('/api/rank-progress')) return reply(state.progress);
    if (path.startsWith('/api/rank-cancel')) {
      state.finish(state.partial);
      return reply({ cancelled: true });
    }
    return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
  };
  return state;
}
const settle = async () => {
  await vi.advanceTimersByTimeAsync(20);
  await nextTick();
};
// One progress poll (every 1.5 s in app/rank-job.ts).
const poll = async () => {
  await vi.advanceTimersByTimeAsync(1600);
  await nextTick();
};
const label = () => $('[data-payoff-label]')?.textContent?.trim();

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
  });
  page();
  setAdaIndex(0);
  adaClearFault();
  setPayoff(null);
  open({
    calculated: structuredClone(generated) as StoredCalculatedPlan,
    workspace: { catalog: catalog() },
  });
  go('plan');
  render();
});
afterEach(() => {
  vi.useRealTimers();
});

test('before ranking, the empty state says in a line or two what the ranking gives', () => {
  const text = $('[data-payoff-empty]')!.textContent!.replace(/\s+/g, ' ').trim();
  assert.match(
    text,
    /^Shows which alternate recipe saves the most buildings, raw resources, power or delivery time from Phase 3 on/,
  );
  assert.match(text, /what each recipe you are hunting would save once found/);
  assert.ok(text.length < 260, 'short: ' + text.length);
  assert.ok(!$('[data-payoff-progress]'));
});

test('progress reads "Checking 12 of 58 alternates…" with a bar and Cancel, and announces rarely', async () => {
  const state = server();
  $('[data-rank-alternates]')!.click();
  await settle();
  assert.equal(label(), 'Checking alternates…');
  // Before the first figure the bar is indeterminate.
  assert.equal($<HTMLProgressElement>('[data-payoff-bar]')!.getAttribute('value'), null);
  state.progress = { running: true, queued: false, done: 12, total: 58 };
  await poll();
  assert.equal(label(), 'Checking 12 of 58 alternates…');
  const bar = $<HTMLProgressElement>('[data-payoff-bar]')!;
  assert.equal(bar.tagName, 'PROGRESS');
  assert.equal(bar.value, 12);
  assert.equal(bar.max, 58);
  assert.equal(bar.getAttribute('aria-labelledby'), 'payoff-run-label');
  assert.equal(document.getElementById('payoff-run-label')!.textContent!.trim(), label());
  // Cancel is a real button, reachable and pressable from the keyboard.
  const cancel = $<HTMLButtonElement>('[data-rank-cancel]')!;
  assert.equal(cancel.tagName, 'BUTTON');
  assert.equal(cancel.type, 'button');
  assert.equal(cancel.textContent!.trim(), 'Cancel');
  assert.equal(cancel.disabled, false);
  // The visible label is not a live region; a hidden status line is, and it is throttled: the
  // 12 of 58 reached the bar, but a screen reader hears the first line only so far.
  assert.equal($('[data-payoff-label]')!.closest('[aria-live]'), null);
  const live = $('[data-payoff-live]')!;
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.textContent, 'Checking alternates…');
  state.progress = { running: true, queued: false, done: 30, total: 58 };
  await vi.advanceTimersByTimeAsync(10000);
  await nextTick();
  assert.equal(live.textContent, 'Checking 30 of 58 alternates…', 'updated after the interval');
  // Waiting behind other rankings is said, not shown as 0 of 58.
  state.progress = { running: true, queued: true, done: 0, total: 0 };
  await vi.advanceTimersByTimeAsync(10000);
  await nextTick();
  assert.equal(label(), 'Waiting for another ranking to finish…');
  state.finish(ranked(58, false));
  await settle();
  assert.ok(!$('[data-payoff-progress]'));
});

test('Cancel stops the ranking and keeps a partial ranking, marked partial', async () => {
  const state = server();
  $('[data-rank-alternates]')!.click();
  await settle();
  state.progress = { running: true, queued: false, done: 3, total: 58 };
  await poll();
  $<HTMLButtonElement>('[data-rank-cancel]')!.click();
  await nextTick();
  assert.equal(label(), 'Cancelling after this alternate…');
  assert.equal($('[data-rank-cancel]')!.getAttribute('aria-disabled'), 'true');
  await settle();
  assert.ok(state.calls.includes('/api/rank-cancel'));
  assert.ok(!$('[data-payoff-progress]'), 'the progress is gone');
  assert.equal(rankRun.current, null);
  // The three alternates checked are ranked, and the ranking says it is partial.
  assert.equal($$('[data-payoff-row]').length, 3);
  assert.equal($('[data-payoff-partial]')!.textContent, 'Partial');
  assert.match($('[data-payoff-summary]')!.textContent!, /3 of 58 alternates checked/);
  const notice = $('[data-payoff-stopped]')!.textContent!.replace(/\s+/g, ' ');
  assert.match(
    notice,
    /You cancelled the ranking: the 3 alternates checked are ranked below, the other 55 are not\./,
  );
  assert.match(
    $('#toast')!.textContent!,
    /Ranking cancelled, partial results kept: 3 of 58 alternates checked for Phase 3\./,
  );
  // Focus goes back to the button that started it, not to <body>.
  assert.equal(document.activeElement, $('[data-rank-alternates]'));
});

test('a ranking cancelled before any alternate was checked keeps the ranking the profile had', async () => {
  const state = server();
  state.partial = ranked(0, true);
  setPayoff(ranked(20, false));
  render();
  await nextTick();
  assert.equal($$('[data-payoff-row]').length, 20);
  $('[data-rank-alternates]')!.click();
  await settle();
  $<HTMLButtonElement>('[data-rank-cancel]')!.click();
  await settle();
  assert.equal($$('[data-payoff-row]').length, 20, 'the earlier ranking is still shown');
  assert.match($('#toast')!.textContent!, /cancelled before any alternate was checked/);
});

test('leaving the page keeps the ranking going; coming back shows it, and finishing says so', async () => {
  const state = server();
  $('[data-rank-alternates]')!.click();
  await settle();
  state.progress = { running: true, queued: false, done: 12, total: 58 };
  await poll();
  // Away from the plan page: the panel is gone, the ranking is not.
  go('factories');
  render();
  await nextTick();
  assert.ok(!$('[data-payoff]'));
  state.progress = { running: true, queued: false, done: 20, total: 58 };
  await poll();
  go('plan');
  render();
  await nextTick();
  assert.equal(label(), 'Checking 20 of 58 alternates…', 'the same ranking, further on');
  assert.equal($('[data-rank-alternates]')!.getAttribute('aria-disabled'), 'true');
  // Away again, it finishes: a toast, a polite announcement and a line from ADA.
  go('factories');
  render();
  await nextTick();
  state.finish(ranked(58, false));
  await settle();
  assert.match(
    $('#toast')!.textContent!,
    /Ranking done: 58 of 58 alternates checked for Phase 3\./,
  );
  assert.equal($('#toast')!.classList.contains('show'), true);
  assert.ok($('#toast .toast-action'), 'with a way to the ranking');
  await vi.advanceTimersByTimeAsync(150);
  assert.equal(
    $('#announce')!.textContent,
    'Ranking done: 58 of 58 alternates checked for Phase 3.',
  );
  const line = adaCurrent();
  assert.equal(line?.id, 'rank-done');
  assert.match(line!.text, /^Alternate recipe priorities logged: 58 checked\./);
  assert.match(line!.text, /Hard drives tab/);
  // Back on the page, the ranking is there and ADA has said her piece.
  go('plan');
  render();
  await nextTick();
  assert.equal($$('[data-payoff-row]').length, 58);
  assert.notEqual(adaCurrent()?.id, 'rank-done');
});
