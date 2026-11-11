// The hard-drive ranking that is running (BUG-7, #1332): "Rank alternates" takes up to two minutes,
// so it lives here and not in ui/plan/PayoffPanel.vue, whose component goes when the user leaves
// the plan page. The panel reads this state when it is drawn again, so coming back shows how far
// the ranking is, and finishing while the user is elsewhere still says so (a toast, a polite
// announcement and a line from ADA, ada.ts' `rank-done`).
//
// Progress, per edition (the work is one calculation per alternate in both):
// - Pages edition: the calculator worker reports after each alternate (onRankProgress), and
//   Cancel aborts the request's `stop` signal, which the worker hears between two alternates.
// - Docker edition: the one POST /api/rank-alternates stays open; this polls GET /api/rank-progress
//   (server/profile-routes.ts) for how far the ranking's thread is, and Cancel is POST
//   /api/rank-cancel, after which the POST replies at once with the alternates checked so far.
// Either way a cancelled ranking comes back as an ordinary ranking with `stopped` set, so it is
// stored and shown like one that ran out of time, marked partial. Nothing here is stored: a
// reload forgets that a ranking was cancelled (the stored ranking still says it stopped).
import { browserMode } from '../browser-api.ts';
import { announce } from './announce.ts';
import { navigate, post, request, scopeHeaders, toast } from './api.ts';
import { rankedMessage } from './payoff.ts';
import { currentProfile, setPayoff, stage, view } from './session.ts';
import { render } from './shell.ts';
import { rankLeftOut, rankLive, rankRun } from './ui/plan/rank-state.ts';
import type { RankRun } from './ui/plan/rank-state.ts';
import type { AlternateRanking, RankReply } from '../types/index.ts';

// What a screen reader is told while it runs (rankLive in ui/plan/rank-state.ts): the label, at
// most every LIVE_MS (one update per alternate would be read out every couple of seconds), and at
// once when it starts or is cancelled. The finished ranking is announced by announce() instead.
export const LIVE_MS = 10000;
let liveAt = 0;
// ADA's line for a ranking that finished (ada.ts' `rank-done`): the profile it is for and how it
// ended, until the user looks at the ranking, starts another or opens another profile.
export interface RankDone {
  profileId: string;
  partial: boolean;
  checked: number;
  total: number;
}
export let rankDone: RankDone | null = null;
export function clearRankDone() {
  rankDone = null;
}
// Rankings the user cancelled in this session, by the object the panel shows, so its notice can
// say "you cancelled" rather than guess between that and the time limit.
const cancelledRankings = new WeakSet<AlternateRanking>();
export const wasCancelled = (ranking: AlternateRanking) => cancelledRankings.has(ranking);

const POLL_MS = 1500;
let rankAbort: AbortController | null = null;

// "Checking 12 of 58 alternates…", the words the bar and the live text share.
export function rankLabel(run: RankRun): string {
  if (run.cancelling) return 'Cancelling after this alternate…';
  if (run.queued) return 'Waiting for another ranking to finish…';
  return run.total
    ? `Checking ${run.done.toLocaleString()} of ${run.total.toLocaleString()} alternates…`
    : 'Checking alternates…';
}

function say(run: RankRun, now = Date.now(), force = false) {
  if (!force && now - liveAt < LIVE_MS) return;
  liveAt = now;
  rankLive.value = rankLabel(run);
}
function progress(run: RankRun, done: number, total: number, queued = false) {
  if (rankRun.current !== run) return;
  run.done = done;
  run.total = total;
  run.queued = queued;
  say(run);
}

// Whether the Hard drives tab is on screen now, so a finished ranking needs no pointer to it.
function panelShown(): boolean {
  const panel = document.querySelector<HTMLElement>('[data-plan-panel="hard-drives"]');
  return view === 'plan' && !!panel && !panel.hidden && panel.getClientRects().length > 0;
}
// Opens the plan's Hard drives tab, from wherever the user is.
export function showRanking() {
  clearRankDone();
  render();
  if (view !== 'plan') navigate('plan');
  let tries = 0;
  const open = () => {
    const tab = document.querySelector<HTMLButtonElement>('[data-plan-tab="hard-drives"]');
    if (tab) tab.click();
    else if (tries++ < 20) setTimeout(open, 50);
  };
  setTimeout(open, 0);
}

// Runs the ranking for the phase on screen and every later one, and shows it, unless another
// profile was opened meanwhile (the result is stored with the profile it was run for either way).
export async function startRank(): Promise<void> {
  if (rankRun.current) return;
  const profileId = currentProfile.id;
  const phase = stage();
  rankRun.current = { profileId, phase, done: 0, total: 0, queued: false, cancelling: false };
  const run = rankRun.current;
  clearRankDone();
  say(run, Date.now(), true);
  const stop = (rankAbort = new AbortController());
  const poll = browserMode
    ? undefined
    : setInterval(async () => {
        try {
          const now = await request<{
            running: boolean;
            queued?: boolean;
            done?: number;
            total?: number;
          }>('/api/rank-progress', { headers: scopeHeaders() });
          if (now.running) progress(run, now.done ?? 0, now.total ?? 0, !!now.queued);
        } catch {
          // The next poll tries again; the ranking itself reports a real failure.
        }
      }, POLL_MS);
  try {
    const { leftOut: notes, ...result } = await post<RankReply>(
      '/api/rank-alternates',
      { phase, remaining: true, hunting: true },
      true,
      {
        onRankProgress: (done, total) => progress(run, done, total),
        stop: stop.signal,
      },
    );
    const cancelled = run.cancelling;
    clearInterval(poll);
    rankRun.current = null;
    rankLive.value = '';
    if (currentProfile.id !== profileId) return;
    // Cancelled before a single alternate was checked: nothing was stored, and the ranking the
    // profile had is still the one shown.
    if (result.ranking.stopped && !result.ranking.candidates.length) {
      render();
      const message = 'Ranking cancelled before any alternate was checked.';
      announce(message);
      toast(message);
      return;
    }
    setPayoff(result);
    if (cancelled) cancelledRankings.add(result.ranking);
    rankLeftOut.value = notes?.length ? { payoff: result, notes } : null;
    const message = rankedMessage(result.ranking, cancelled);
    const elsewhere = !panelShown();
    // ADA speaks of it when the user is not already looking at it.
    rankDone = elsewhere
      ? {
          profileId,
          partial: !!result.ranking.stopped,
          checked: result.ranking.candidates.length,
          total: result.ranking.total,
        }
      : null;
    render();
    announce([message, ...(notes ?? [])].join(' '));
    toast(message, false, elsewhere ? { label: 'View ranking', run: showRanking } : null);
  } catch (error) {
    clearInterval(poll);
    rankRun.current = null;
    rankLive.value = '';
    toast((error as Error).message, true);
  } finally {
    clearInterval(poll);
    if (rankRun.current === run) rankRun.current = null;
    rankAbort = null;
  }
}

// Stops the running ranking before its next alternate, keeping what it has checked so far.
export async function cancelRank(): Promise<void> {
  const run = rankRun.current;
  if (!run || run.cancelling) return;
  run.cancelling = true;
  say(run, Date.now(), true);
  rankAbort?.abort();
  if (!browserMode) {
    try {
      await post('/api/rank-cancel', {});
    } catch {
      // The ranking carries on and finishes in full; nothing was lost.
      run.cancelling = false;
    }
  }
}
