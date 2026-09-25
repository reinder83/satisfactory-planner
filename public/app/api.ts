// Requests to the server (or the browser-only adapter), the serialized save queue,
// toasts, and navigation that guards unsaved notes. Edits to the open profile go through
// save(); other POSTs (profiles, imports, account) use post(); both use request().
import { appRoot } from '../app-root.ts';
import { browserMode, browserRequest } from '../browser-api.ts';
import { required } from './format.ts';
import { currentProfile, currentSave, setState, setView, state, type View } from './session.ts';
import { render } from './shell.ts';
import { invalidate } from './ui/bridge.ts';
import type { ProgressState, UpdateOp } from '../types/index.ts';

// Request options: fetch's, plus the browser edition's calculation progress callback
// (calcProgress in wizard/wizard.ts), which browser-api.ts calls with each phase it solves.
export type RequestOptions = RequestInit & { onProgress?: (phase: number) => void };

// Number of save() calls still in flight; drives the "Saving…" indicator.
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
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// The tail of the save chain. Anything that switches save/profile or replaces data awaits
// it first (loadContext, imports, profile removal) so no queued write lands elsewhere.
export let writeQueue: Promise<unknown> = Promise.resolve();

// Saves one progress change. `op` is an operation for mutate() in state.ts, e.g.
// { type: 'check', key, value }; the server or browser adapter applies it and returns the
// profile's full new state. Writes run one at a time in call order. The save/profile is
// captured now, so a write made before a profile switch still goes to its own profile, and
// its reply only replaces `state` if that profile is still open. Does not render: callers
// render() after it resolves. On failure it shows an error toast and rejects, and callers
// usually just restore their control instead of rendering.
export function save(op: UpdateOp): Promise<ProgressState> {
  const scope = { ...scopeHeaders() };
  pending++;
  saveIndicator();
  const run = writeQueue.then(async () => {
    const next = await request<ProgressState>('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...scope },
      body: JSON.stringify(op),
    });
    // Ignore the reply if the user has since opened another save or profile.
    if (scope['X-Save-Id'] === currentSave.id && scope['X-Profile-Id'] === currentProfile.id)
      setState(next);
    return next;
  });
  // A failed write must not block the writes queued after it.
  writeQueue = run.catch(() => {});
  return run
    .catch((e: Error) => {
      toast(e.message, true);
      throw e;
    })
    .finally(() => {
      pending--;
      saveIndicator();
    });
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

// Goes to a route. Changing the hash triggers the hashchange listener in
// listeners.ts, which renders; an unchanged hash would not, so render directly.
export function navigate(v: View) {
  setView(v);
  if (location.hash === '#' + v) render();
  else location.hash = v;
}

// Notes are saved with an explicit button, not on typing. A notes textarea is unsaved
// when its text differs from the saved note its paired data-input button writes.
function hasUnsavedNotes() {
  return [...document.querySelectorAll<HTMLTextAreaElement>('textarea.notes')].some(el => {
    const button = document.querySelector<HTMLElement>(`[data-input="${el.id}"]`);
    return button && el.value !== (state.notes[button.dataset.saveNote || ''] || '');
  });
}

// True when it is fine to leave the current page: no unsaved notes, or the user agreed
// to drop them. Checked before switching profile, starting the wizard, signing out, etc.
export function allowSwitch() {
  return (
    !hasUnsavedNotes() ||
    confirm('You have notes that have not been saved. Leave without saving those edits?')
  );
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
