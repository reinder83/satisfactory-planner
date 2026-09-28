// The live estimate beside All settings steps 3 (Goals) and 4 (Resources) (SP-33, #268):
// buildings, power and the tightest resource of the plan the settings on screen would give, so
// a budget that does not fit shows before Calculate plan. ui/wizard/EstimatePanel.vue draws it.
//
// Each edit reads the form into the draft (readWizard, as moving between steps does) and
// restarts a short timer; when it runs out the settings go to /api/preview marked `estimate`,
// the same calculation Review uses (the server, or the browser edition's worker), so input is
// never blocked. One estimate runs at a time: an edit made meanwhile waits for it and then
// estimates the latest settings. Cancelling (leaving the step, pausing, or a newer edit taking
// over) drops the running one's result; on the server edition its request is aborted too, while
// the browser's worker finishes its solve (a few hundred milliseconds) and the answer is ignored.
import { post } from '../api.ts';
import { draft } from '../session.ts';
import { invalidate } from '../ui/bridge.ts';
import { readWizard } from './wizard.ts';
import type { StoredCalculatedPlan } from '../../types/index.ts';

// The pause after the last edit before estimating. With the solve it stays under a second for
// most settings; a heavy plan (every alternate recipe at a 50× goal) takes about a second to
// solve on its own. The panel says "Estimating…" from the edit on, so it is never shown stale.
export const ESTIMATE_DELAY = 300;

export const estimate: {
  status: 'idle' | 'running' | 'done' | 'error';
  plan: StoredCalculatedPlan | null;
  error: string;
  paused: boolean;
} = { status: 'idle', plan: null, error: '', paused: false };

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
  if (estimate.status !== 'running') {
    estimate.status = 'running';
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
  try {
    const plan = await post<StoredCalculatedPlan>(
      '/api/preview',
      { settings: draft().settings, estimate: true },
      true,
      { signal: abort.signal },
    );
    if (id === serial) Object.assign(estimate, { plan, error: '', status: 'done' });
  } catch (err) {
    if (id === serial) Object.assign(estimate, { error: (err as Error).message, status: 'error' });
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
  if (reset) Object.assign(estimate, { status: 'idle', plan: null, error: '' });
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
