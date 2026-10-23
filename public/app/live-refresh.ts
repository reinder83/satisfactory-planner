// Live refresh of the open profile's progress on the Docker edition (#1210, co-op slice 4 of
// #1077): while the tab is visible it asks the server for the profile's progress every
// LIVE_REFRESH_MS, naming the ETag of the last reply, so an unchanged profile answers 304 without
// a body (progressState in server/profile-routes.ts). When another tab or device saved a change,
// the page takes the server's state and redraws, as coming back to the tab does (refreshState in
// api.ts): this tab saves each change at once, so the server's copy already holds everything done
// here. While the player is in the middle of something a redraw could disturb (playerBusy: a
// write on its way, a dialog, a text field, a step's edit form, an unsaved note or choice, an edit
// mode), the change is held instead and ui/LiveChangeNotice.vue says so, with Refresh; a later
// poll takes it once the page is quiet again. Nothing is saved or recalculated here, and nothing
// is stored: the tag and the held change are this tab's memory. A tick's Undo (its toast) unticks
// only the steps that tick changed, so it never takes back the other device's ticks.
//
// The browser edition has no server and never polls (startLiveRefresh); its co-op path stays the
// tick merge from a file (#1160).
import { browserMode } from '../browser-api.ts';
import {
  hasUnsavedChoices,
  hasUnsavedNotes,
  pending,
  planHeader,
  recalculatedNotice,
  refreshState,
  requestIfChanged,
  scopeHeaders,
  toast,
  writeQueue,
} from './api.ts';
import {
  currentProfile,
  currentSave,
  editingTask,
  factoryEditing,
  layoutEditing,
  planEditing,
  setState,
  state,
  stateLoaded,
  wizard,
} from './session.ts';
import { render } from './shell.ts';
import { invalidate } from './ui/bridge.ts';
import { refocusAfterRefresh } from './ui/refocus.ts';
import type { ProgressState } from '../types/index.ts';

// How often a visible tab asks: often enough that a partner's tick shows up while you look, and
// cheap, since an unchanged profile answers 304.
export const LIVE_REFRESH_MS = 12000;

// The open save and profile ("save/profile"), which the tag and a held change belong to.
const liveScope = () =>
  currentSave?.id && currentProfile?.id ? currentSave.id + '/' + currentProfile.id : '';

// The ETag of the last state the server sent this tab for a profile.
let liveTag: { scope: string; tag: string } | null = null;
// A change found while the player was busy: the server's newer state, or null when the profile
// was recalculated elsewhere (the server answered 409, checkPlan), which opens the new plan.
let liveHeld: { scope: string; state: ProgressState | null } | null = null;
let liveStarted = false;
let livePolling = false;
let liveTimer: ReturnType<typeof setTimeout> | undefined;

// Whether a change from elsewhere waits for Refresh on the profile this tab shows, for
// ui/LiveChangeNotice.vue.
export const liveChangeHeld = () => !!liveHeld && liveHeld.scope === liveScope();

// A field a redraw could take a half-typed value from. A checkbox (a step just ticked), a radio,
// a button or a select (which saves as it changes, such as the phase picker) is not one.
const TEXT_FIELD =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable]';

// Whether the player is in the middle of something a redraw under them could disturb.
export function playerBusy(): boolean {
  if (pending || hasUnsavedNotes() || hasUnsavedChoices() || editingTask || wizard) return true;
  if (layoutEditing || factoryEditing || planEditing) return true;
  if (document.querySelector('dialog[open]')) return true;
  return !!document.activeElement?.closest?.(TEXT_FIELD);
}

// Whether `next` is a later state than `shown`: the revision counts accepted writes and only
// grows (a recalculation or a restore moves it past the previous one).
const laterState = (next: ProgressState, shown: ProgressState) =>
  typeof next.revision === 'number' && typeof shown.revision === 'number'
    ? next.revision > shown.revision
    : next.revision !== shown.revision;

// One poll: asks for the open profile's progress and takes a change, or holds it while the
// player is busy. Returns whether the page was redrawn with a change. Does nothing in the
// browser edition, while hidden, with no profile open, in the wizard or while a poll is on its
// way.
export async function pollProgress(): Promise<boolean> {
  const scope = liveScope();
  if (browserMode || livePolling || !stateLoaded || !scope || wizard) return false;
  if (document.visibilityState === 'hidden') return false;
  livePolling = true;
  try {
    return await pollScope(scope);
  } finally {
    livePolling = false;
  }
}

async function pollScope(scope: string): Promise<boolean> {
  if (liveHeld && liveHeld.scope !== scope) liveHeld = null;
  const asked = state;
  let reply: Awaited<ReturnType<typeof requestIfChanged<ProgressState>>>;
  try {
    reply = await requestIfChanged<ProgressState>(
      '/api/state',
      liveTag?.scope === scope ? liveTag.tag : null,
      { ...scopeHeaders(), ...planHeader() },
    );
  } catch (error) {
    if ((error as { status?: number }).status !== 409 || liveScope() !== scope) throw error;
    return offerChange(scope, null);
  }
  if (liveScope() !== scope) return false;
  if (reply) {
    // The page changed while asking (a save's reply): compare again next time, in full.
    if (state !== asked) {
      liveTag = null;
      return false;
    }
    liveTag = reply.tag ? { scope, tag: reply.tag } : null;
    if (!laterState(reply.data, state)) {
      dropHeld();
      return false;
    }
    return offerChange(scope, reply.data);
  }
  // Unchanged since the last reply: a change held back is taken once the page is quiet, unless
  // this tab has caught up meanwhile (a save's reply already holds it).
  if (!liveHeld) return false;
  if (liveHeld.state && !laterState(liveHeld.state, state)) {
    dropHeld();
    return false;
  }
  return offerChange(scope, liveHeld.state);
}

// Takes a change now, or holds it for the notice while the player is busy.
async function offerChange(scope: string, next: ProgressState | null): Promise<boolean> {
  if (playerBusy()) {
    const shown = liveChangeHeld();
    liveHeld = { scope, state: next };
    if (!shown) invalidate();
    return false;
  }
  liveHeld = null;
  // Focus goes to the page's heading if the redraw takes away the control that had it (a step
  // ticked elsewhere moves to "Done"), as after coming back to the tab (#809).
  const refocus = refocusAfterRefresh(document.activeElement);
  if (next) {
    setState(next);
    render();
  } else if (!(await refreshState())) {
    invalidate();
    return false;
  }
  await refocus();
  return true;
}

function dropHeld() {
  if (!liveHeld) return;
  liveHeld = null;
  invalidate();
}

// The notice's Refresh: once the writes on their way have landed, loads the profile's progress
// as it is saved now and redraws (refreshState, forced: the player asked for it). A profile
// recalculated elsewhere opens its new plan, and the toast says so.
export async function refreshHeldChange(): Promise<void> {
  const recalculated = liveHeld?.state === null;
  await writeQueue;
  liveHeld = null;
  const changed = await refreshState(true).catch(() => false);
  if (!changed) invalidate();
  else if (recalculated) toast(recalculatedNotice);
}

// Starts polling (app.ts, once). The browser edition has no server to ask.
export function startLiveRefresh() {
  if (browserMode) return;
  liveStarted = true;
  resumeLiveRefresh();
}

// Schedules the next poll while the tab is visible; a hidden tab asks nothing until it is visible
// again (the visibilitychange listener in listeners.ts calls this both ways).
export function resumeLiveRefresh() {
  clearTimeout(liveTimer);
  if (!liveStarted || document.visibilityState !== 'visible') return;
  liveTimer = setTimeout(() => {
    void pollProgress()
      .catch(() => false)
      .finally(resumeLiveRefresh);
  }, LIVE_REFRESH_MS);
}
