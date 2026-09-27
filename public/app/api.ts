// Requests to the server (or the browser-only adapter), the serialized save queue,
// toasts, and navigation that guards unsaved notes. Edits to the open profile go through
// save(); other POSTs (profiles, imports, account) use post(); both use request().
import { appRoot } from '../app-root.ts';
import { browserMode, browserRequest } from '../browser-api.ts';
import { required } from './format.ts';
import {
  boot,
  currentProfile,
  currentSave,
  editingTask,
  setState,
  setView,
  state,
  stateLoaded,
  wizard,
  workspace,
  type View,
} from './session.ts';
import { render } from './shell.ts';
import { invalidate } from './ui/bridge.ts';
import { confirmAction } from './ui/confirm.ts';
import type { ProgressState, UpdateOp } from '../types/index.ts';

// Request options: fetch's, plus the browser edition's calculation progress callback
// (calcProgress in wizard/wizard.ts), which browser-api.ts calls with each phase it solves, and
// its payoff ranking progress (candidates done of the total, ui/plan/PayoffPanel.vue).
export type RequestOptions = RequestInit & {
  onProgress?: (phase: number) => void;
  onRankProgress?: (done: number, total: number) => void;
};

// Number of queued writes still in flight (queuedWrite: save() and restoring a progress
// backup); drives the "Saving…" indicator and the close-tab warning.
export let pending = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// Shows a message in the #toast strip. Errors stay up longer than confirmations.
export function toast(message: string, error = false) {
  const el = required('#toast');
  el.textContent = message;
  el.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), error ? 9000 : 3500);
}

// The one request path for the whole UI. Resolves to the parsed JSON body; rejects with
// the server's error message. In the browser edition /api/* never reaches the network:
// browser-api.ts answers it from IndexedDB. Static files (plan.json, ...) are fetched
// relative to appRoot there, because GitHub Pages serves the app under a subpath.
// The caller names the reply's type (T); it is not checked at run time.
export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  if (browserMode && path.startsWith('/api/')) return browserRequest(path, options) as Promise<T>;
  const r = await fetch(browserMode ? new URL('.' + path, appRoot) : path, {
    cache: 'no-store',
    ...options,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  // The server's own password (HTTP Basic, server.ts) also answers 401, with a
  // WWW-Authenticate challenge the browser handles; only the app's 401 means a session ended.
  if (r.status === 401 && !r.headers.has('WWW-Authenticate')) sessionEnded();
  // The status goes with the error, so a caller can tell a conflict (409) from a refusal.
  if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: r.status });
  return data;
}

// A 401 while signed in means the session expired or was ended in another tab. boot()
// then asks /api/workspace again, which answers signed out too, and shows the sign-in
// screen. That screen replaces the page, so with unsaved notes on it the page stays and a
// toast says what happened instead. Signed out already (a wrong password on the sign-in
// screen is a 401 too), nothing changes. Runs once.
let ending = false;
function sessionEnded() {
  if (ending || !workspace?.user) return;
  if (hasUnsavedNotes()) {
    setTimeout(() =>
      toast('Your session has ended. Copy your unsaved notes, then reload to sign in.', true),
    );
    return;
  }
  ending = true;
  boot().finally(() => (ending = false));
}

// The tail of the save chain. Anything that switches save/profile or replaces data awaits
// it first (loadContext, imports, profile removal) so no queued write lands elsewhere.
export let writeQueue: Promise<unknown> = Promise.resolve();

// Saves one progress change. `op` is an operation for mutate() in state.ts, e.g.
// { type: 'check', key, value }; the server or browser adapter applies it and returns the
// profile's full new state. Does not render: callers render() after it resolves. On failure
// it shows an error toast and rejects, and callers usually just restore their control
// instead of rendering.
export function save(op: UpdateOp): Promise<ProgressState> {
  return queuedWrite('/api/update', op).catch((e: Error) => {
    toast(e.message, true);
    throw e;
  });
}

// A write that replies with the profile's full new state: save() and restoring a progress
// backup (/api/import). Writes run one at a time in call order, and count as pending ("Saving…"
// and the close-tab warning in listeners.ts) until they finish. The save/profile is captured
// now, so a write made before a profile switch still goes to its own profile, and its reply
// only replaces `state` if that profile is still open. Rejects with the request's error.
export function queuedWrite(endpoint: string, body: unknown): Promise<ProgressState> {
  const scope = { ...scopeHeaders() };
  pending++;
  saveIndicator();
  const stillOpen = () =>
    scope['X-Save-Id'] === currentSave.id && scope['X-Profile-Id'] === currentProfile.id;
  const run = writeQueue.then(async () => {
    // An update names the revision this tab's state has now, after the writes queued before
    // it, so a whole-value write made on stale data is refused instead of undoing another
    // tab's change (checkBase in state.ts, #165). Omitted once another profile is open.
    const base: Record<string, string> =
      endpoint === '/api/update' && stillOpen() && typeof state.revision === 'number'
        ? { 'X-Planner-Revision': String(state.revision) }
        : {};
    try {
      const next = await request<ProgressState>(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Planner-Request': '1',
          ...scope,
          ...base,
        },
        body: JSON.stringify(body),
      });
      // Ignore the reply if the user has since opened another save or profile.
      if (stillOpen()) setState(next);
      return next;
    } catch (e) {
      // Refused as stale: load the latest state so the page shows what is saved now, then
      // reject with the explanation for save() to show.
      if ((e as { status?: number }).status === 409) await refreshState(true).catch(() => {});
      throw e;
    }
  });
  // A failed write must not block the writes queued after it.
  writeQueue = run.catch(() => {});
  return run.finally(() => {
    pending--;
    saveIndicator();
  });
}

// Reloads the open profile's progress if another tab or device changed it, so this tab does
// not keep showing (and writing from) an old copy (#165). Called when the tab becomes visible
// again (listeners.ts) and after a write refused as stale (`force`). Without force it leaves
// the page alone while a write is pending, a note has unsaved text, a step is being edited or
// the wizard is open, so nothing typed is redrawn away. Returns whether the state changed.
export async function refreshState(force = false): Promise<boolean> {
  const quiet = () => !pending && !hasUnsavedNotes() && !editingTask && !wizard;
  if (!stateLoaded || !currentSave?.id || (!force && !quiet())) return false;
  const scope = { ...scopeHeaders() };
  const next = await request<ProgressState>('/api/state', { headers: scope });
  const same = scope['X-Save-Id'] === currentSave.id && scope['X-Profile-Id'] === currentProfile.id;
  if (!same || next.revision === state.revision || (!force && !quiet())) return false;
  setState(next);
  render();
  return true;
}

// Refreshes the sidebar save status ("Saving…" while a write is pending), which
// ui/Shell.vue reads from `pending`.
export function saveIndicator() {
  invalidate();
}

// Headers that name the save and profile a request applies to. Both editions read them
// before falling back to the stored active save/profile, so another tab that switched
// profile cannot redirect this tab's writes.
export function scopeHeaders(): { 'X-Save-Id': string; 'X-Profile-Id': string } {
  return { 'X-Save-Id': currentSave?.id || '', 'X-Profile-Id': currentProfile?.id || '' };
}

// JSON POST outside the save queue (profiles, rename, import, account, preview...).
// Pass scope=false for workspace-wide calls; `extra` adds request options (such as the
// onProgress callback from calcProgress() that the browser calculator reports to). The server
// refuses a POST without X-Planner-Request and a JSON content type (a CSRF guard).
export async function post<T = unknown>(
  endpoint: string,
  data: unknown,
  scope = true,
  extra: RequestOptions = {},
): Promise<T> {
  return request<T>(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Planner-Request': '1',
      ...(scope ? scopeHeaders() : {}),
    },
    body: JSON.stringify(data),
    ...extra,
  });
}

// The address hash of the page on screen, which acceptRoute() puts back when the user keeps
// their unsaved notes. navigating is set while navigate() changes the hash itself.
let shownHash = location.hash;
let navigating = false;

// Goes to a route. Changing the hash triggers the hashchange listener in
// listeners.ts, which renders; an unchanged hash would not, so render directly.
// A route change from here is not checked for unsaved notes: the callers that leave a page
// with notes on it (switching profile, starting the wizard) have already asked allowSwitch().
export function navigate(v: View) {
  setView(v);
  if (location.hash === '#' + v) render();
  else {
    navigating = true;
    location.hash = v;
  }
}

// The hashchange listener's check (listeners.ts): a sidebar link, a typed address or Back
// leaves the page, so ask about unsaved notes first. While the question is open, and when the
// user keeps the notes, the address goes back to the page still on screen (replaceState fires
// no hashchange) and this returns false, so nothing is redrawn. Leaving anyway goes to the
// address asked for, as navigate() would, without asking again.
export function acceptRoute() {
  const asked = navigating || location.hash === shownHash ? true : allowSwitch();
  if (asked !== true) {
    const target = location.hash;
    history.replaceState(history.state, '', shownHash || location.pathname + location.search);
    void asked.then(ok => {
      if (!ok || location.hash === target) return;
      navigating = true;
      location.hash = target;
    });
    return false;
  }
  navigating = false;
  shownHash = location.hash;
  return true;
}

// Notes are saved with an explicit button, not on typing. A notes textarea is unsaved
// when its text differs from the saved note its paired data-input button writes. A blank
// note is saved by deleting it (mutate in state.ts), so whitespace compares as empty.
// `root` narrows the check, to the dialog when only the dialog is closing.
export function hasUnsavedNotes(root: ParentNode = document) {
  return [...root.querySelectorAll<HTMLTextAreaElement>('textarea.notes')].some(el => {
    const button = root.querySelector<HTMLElement>(`[data-input="${el.id}"]`);
    const text = el.value.trim() ? el.value : '';
    return button && text !== (state.notes[button.dataset.saveNote || ''] || '');
  });
}

// Whether it is fine to leave the current page (or, with `root`, that part of it): true at
// once when there are no unsaved notes, otherwise the answer of the in-app confirmation
// (ui/confirm.ts), true when the user agrees to drop them. So a caller that must act in the
// same event (Escape on the dialog, the hash route) can tell "nothing to ask" apart; the
// others await it. Checked before switching profile, starting the wizard, signing out,
// changing the working phase, following the hash route and closing or replacing the detail
// dialog.
export function allowSwitch(root: ParentNode = document): true | Promise<boolean> {
  if (!hasUnsavedNotes(root)) return true;
  return confirmAction({
    title: 'Leave without saving notes?',
    body: 'You have notes that have not been saved. Leave without saving those edits?',
    confirmLabel: 'Leave without saving',
    danger: true,
  });
}

// Offers `data` as a .json file download (exports and shared profiles).
export function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
