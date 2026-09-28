// The live estimate beside All settings steps 3 (Goals) and 4 (Resources) (SP-33, #268):
// buildings, power and the tightest resource of the plan the settings on screen would give, so
// a budget that does not fit shows before Calculate plan. ui/wizard/EstimatePanel.vue draws it.
//
// Each edit reads the form into the draft (readWizard, as moving between steps does) and
// restarts a short timer; when it runs out the settings go to /api/preview?estimate=1,
// the same calculation Review uses (the server, or the browser edition's worker), so input is
// never blocked. With whole machines on (the default), it runs in two passes: first with exact
// ratios, a quick solve (under half a second even for a heavy plan) shown as a quick estimate,
// then as the settings stand, which replaces it, since rounding to whole machines can decide
// whether a phase fits. One estimate runs at a time: an edit made meanwhile waits for the pass
// under way, skips any pass still to come, and then estimates the latest settings. Cancelling (leaving the step, pausing, or a newer edit taking
// over) drops the running one's result; on the server edition its request is aborted too, while
// the browser's worker finishes its solve (a few hundred milliseconds) and the answer is ignored.
import { post } from '../api.ts';
import { draft } from '../session.ts';
import { invalidate } from '../ui/bridge.ts';
import { readWizard } from './wizard.ts';
import type { StoredCalculatedPlan } from '../../types/index.ts';

// The pause after the last edit before estimating. With the quick pass the first figures show
// within a second of the last edit, even for a heavy plan (every alternate recipe at a 50× goal),
// whose whole-machine solve alone takes about a second. The panel says "Estimating…" from the
// edit on, so it is never shown stale.
export const ESTIMATE_DELAY = 300;

export const estimate: {
  status: 'idle' | 'running' | 'done' | 'error';
  plan: StoredCalculatedPlan | null;
  // The plan shown is the exact-ratio pass; the whole-machine one is still being solved.
  quick: boolean;
  error: string;
  paused: boolean;
} = { status: 'idle', plan: null, quick: false, error: '', paused: false };

let timer: ReturnType<typeof setTimeout> | undefined;
// Which estimate is current: a result from an older serial is dropped.
let serial = 0;
let running = false,
  again = false;
let controller: AbortController | null = null;

// An edit on the step's form: read it, then estimate once the edits pause.
export function scheduleEstimate(form: HTMLFormElement, delay = ESTIMATE_DELAY) {
  if (estimate.paused) return;
  readWizard(form);
  clearTimeout(timer);
  timer = setTimeout(runEstimate, delay);
  // The figures on screen are now of older settings, quick pass or not.
  if (estimate.status !== 'running' || estimate.quick) {
    Object.assign(estimate, { status: 'running', quick: false });
    invalidate();
  }
}

async function runEstimate() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  const id = ++serial;
  const abort = (controller = new AbortController());
  estimate.status = 'running';
  invalidate();
  const solve = (settings: object) =>
    // Marked in the address, which the server's estimate allowance reads before the body (#413).
    post<StoredCalculatedPlan>('/api/preview?estimate=1', { settings }, true, {
      signal: abort.signal,
    });
  try {
    const settings = draft().settings;
    if (settings.wholeMachines !== false) {
      const plan = await solve({ ...settings, wholeMachines: false });
      if (id !== serial || again) return;
      Object.assign(estimate, { plan, quick: true, error: '' });
      invalidate();
    }
    const plan = await solve(settings);
    if (id === serial && !again)
      Object.assign(estimate, { plan, quick: false, error: '', status: 'done' });
  } catch (err) {
    if (id === serial && !again)
      Object.assign(estimate, { error: (err as Error).message, quick: false, status: 'error' });
  } finally {
    running = false;
    controller = null;
    if (again && !estimate.paused) {
      again = false;
      void runEstimate();
    }
    invalidate();
  }
}

// Stops what is pending or running and forgets its result; `reset` also clears the last
// estimate, for a step left behind.
export function cancelEstimate(reset = false) {
  clearTimeout(timer);
  timer = undefined;
  again = false;
  serial++;
  controller?.abort();
  if (estimate.status === 'running') estimate.status = estimate.plan ? 'done' : 'idle';
  if (reset) Object.assign(estimate, { status: 'idle', plan: null, quick: false, error: '' });
  invalidate();
}

// "Pause live estimate": cancels the running one and ignores edits until resumed, which
// estimates the settings as they are then.
export function setEstimatePaused(paused: boolean, form: HTMLFormElement | null) {
  estimate.paused = paused;
  if (paused) cancelEstimate();
  else if (form) scheduleEstimate(form, 0);
  invalidate();
}
