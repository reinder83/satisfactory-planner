// The reactive state of the hard-drive ranking that is running or just finished (BUG-7, #1332),
// which app/rank-job.ts changes and ui/plan/PayoffPanel.vue reads. It lives in the Vue layer
// because the plain app modules do not import Vue (the interface tests load them without it).
import { reactive, ref, shallowRef } from 'vue';
import { RANK_BUDGET_MS } from '../../../state.ts';
import type { StageKey, StoredPayoff } from '../../../types/index.ts';

// The ranking's time limit in words, the same in both editions (#1257). A ranking started while
// others run may wait for one to finish first (two at once on the server, server/ranking.ts), and
// its limit only starts when it runs.
export const RANK_LIMIT = `${RANK_BUDGET_MS / 60000} minutes`;

// A ranking on its way: the profile and phase it was started for, and how far it is.
export interface RankRun {
  // The save and profile it was started for (and the profile's name, for the toast that says it
  // finished elsewhere): its progress poll and its Cancel name them, so they reach this ranking
  // after the user opens another profile (#1363).
  saveId: string;
  profileId: string;
  profileName: string;
  phase: StageKey;
  done: number;
  total: number;
  // Waiting for a free thread on the server (two rankings run at once there).
  queued: boolean;
  // Cancel was pressed; the ranking stops before its next alternate.
  cancelling: boolean;
}
// null when none runs.
export const rankRun = reactive<{ current: RankRun | null }>({ current: null });
// What a screen reader is told while it runs: the label, throttled by app/rank-job.ts (one update
// per alternate would be read out every couple of seconds). The finished ranking is announced by
// announce() instead.
export const rankLive = ref('');
// The pins the last ranking left out because the game data no longer takes them (#1273, the
// reply's `leftOut`), with the payoff they belong to: shown while that payoff is the one on
// screen. Never stored, so a reload or another ranking forgets them.
export const rankLeftOut = shallowRef<{ payoff: StoredPayoff; notes: string[] } | null>(null);
