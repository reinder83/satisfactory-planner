// Requests to the server (or the browser-only adapter), the serialized save queue,
// toasts, and navigation that guards unsaved notes. Edits to the open profile go through
// save(); other POSTs (profiles, imports, account) use post(); both use request().
import { appRoot } from '../app-root.ts';
import { browserMode, browserRequest } from '../browser-api.ts';
import { required } from './format.ts';
import { entryPlace, placeEntry, placedState, startPlace } from './history-place.ts';
import {
  boot,
  currentProfile,
  currentSave,
  editingTask,
  setState,
  setView,
  setWorkspace,
  state,
  stateLoaded,
  wizard,
  workspace,
  type View,
} from './session.ts';
import { render } from './shell.ts';
import { invalidate } from './ui/bridge.ts';
import { confirmAction } from './ui/confirm.ts';
import { refocusAfterRefresh } from './ui/refocus.ts';
import { listNames } from '../wording.ts';
import type { ProgressState, UpdateOp, WorkspaceSummary } from '../types/index.ts';

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
// browser-api.ts answers it from IndexedDB. Static files (progression.json, ...) are fetched
// relative to appRoot there, because GitHub Pages serves the app under a subpath.
// The caller names the reply's type (T); it is not checked at run time.
export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  if (browserMode && path.startsWith('/api/')) return browserRequest(path, options) as Promise<T>;
  const response = await fetch(browserMode ? new URL('.' + path, appRoot) : path, {
    cache: 'no-store',
    ...options,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  // The server's own password (HTTP Basic, server.ts) also answers 401, with a
  // WWW-Authenticate challenge the browser handles; only the app's 401 means a session ended.
  if (response.status === 401 && !response.headers.has('WWW-Authenticate')) sessionEnded();
  // The status goes with the error, so a caller can tell a conflict (409) from a refusal.
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
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

// The statuses with which both editions refuse a write they read and judged against the saved
// state: 400 from mutate/validateState, 409 from checkBase. After either, queuedWrite reloads
// the state, because the refusal may be about a change another tab or device made.
const refusedStatuses = [400, 409];

// Saves one progress change. `operation` is an operation for mutate() in state.ts, e.g.
// { type: 'check', key, value }; the server or browser adapter applies it and returns the
// profile's full new state. Does not render: callers render() after it resolves. On failure
// it shows an error toast and rejects, and callers usually just restore their control
// instead of rendering.
export function save(operation: UpdateOp): Promise<ProgressState> {
  return queuedWrite('/api/update', operation).catch((error: Error) => {
    toast(error.message, true);
    throw error;
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
    } catch (error) {
      // Refused as stale (409) or by mutate (400, such as a bay letter another device has
      // taken meanwhile, #722): load the latest state so the page shows what is saved now and
      // what the refusal is talking about, then reject with the explanation for save() to
      // show. refreshState only redraws when the saved revision moved, so a refusal of this
      // tab's own mistake leaves the page alone; a network failure (no status) never redraws.
      // Focus goes to the page's heading if the redraw takes away the control that had it.
      if (refusedStatuses.includes((error as { status?: number }).status ?? 0)) {
        const refocus = refocusAfterRefresh(document.activeElement);
        if (await refreshState(true).catch(() => false)) await refocus();
      }
      throw error;
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
// again (listeners.ts) and after a refused write (`force`, queuedWrite). Without force it leaves
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

// Asks for the workspace summary again when the tab comes back into use (listeners.ts: the
// window gains focus or the tab becomes visible), so a tab learns that the user opened another
// save or profile in another tab or on another device, and says so (groupMoved in session.ts,
// ui/GroupMovedNotice.vue, #1052). It only redraws; nothing is opened or saved. At most once
// every few seconds; never while signed out or with no save open, and a reply for someone else
// (signed out or in as another user meanwhile) is left for the next boot(). Returns whether the
// summary was replaced.
const WORKSPACE_REFRESH_MS = 5000;
let workspaceAsked = -Infinity;
export async function refreshWorkspace(): Promise<boolean> {
  if (!stateLoaded || !currentSave?.id || !workspace?.user) return false;
  if (Date.now() - workspaceAsked < WORKSPACE_REFRESH_MS) return false;
  workspaceAsked = Date.now();
  const next = await request<WorkspaceSummary>('/api/workspace');
  if (!next.user || next.user.id !== workspace.user?.id) return false;
  setWorkspace(next);
  invalidate();
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
// Pass scope=false for workspace-wide calls, or a save and profile to act on one other than the
// open one (renaming any save or profile in place, SP-31); `extra` adds request options (such as
// the onProgress callback from calcProgress() that the browser calculator reports to). The
// server refuses a POST without X-Planner-Request and a JSON content type (a CSRF guard).
export async function post<T = unknown>(
  endpoint: string,
  data: unknown,
  scope: boolean | { save: string; profile: string } = true,
  extra: RequestOptions = {},
): Promise<T> {
  return request<T>(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Planner-Request': '1',
      ...(scope === true
        ? scopeHeaders()
        : scope
          ? { 'X-Save-Id': scope.save, 'X-Profile-Id': scope.profile }
          : {}),
    },
    body: JSON.stringify(data),
    ...extra,
  });
}

// The address hash and history place (history-place.ts) of the page on screen, which
// acceptRoute() goes back to when the user keeps their unsaved notes. navigating is set while
// navigate() changes the hash itself, or acceptRoute() steps on to the address the user agreed
// to leave for; undoing from acceptRoute() stepping back until that step's hashchange arrives.
let shownHash = location.hash;
let shownPlace = startPlace();
let navigating = false;
let undoing = false;

// Rewrites the address of the page on screen to `route` (the hash without its #), as render()
// in shell.ts does to keep a group's flow page's address naming the phase shown (#926), and
// records it as the page on screen, so keeping unsaved notes on a later Back puts this address
// back rather than the one it replaced (acceptRoute). replaceState adds no history entry and,
// in a browser, fires no hashchange, so the hashchange listener never records it. The entry
// keeps its state, and with it its place.
export function replaceShownRoute(route: string) {
  history.replaceState(history.state, '', '#' + route);
  shownHash = location.hash;
}

// Goes to a route. Changing the hash triggers the hashchange listener in
// listeners.ts, which renders; an unchanged hash would not, so render directly.
// A route change from here is not checked for unsaved notes: the callers that leave a page
// with notes on it (switching profile, starting the wizard) have already asked allowSwitch().
export function navigate(nextView: View) {
  setView(nextView);
  if (location.hash === '#' + nextView) render();
  else {
    navigating = true;
    location.hash = nextView;
  }
}

// The hashchange listener's check (listeners.ts): a sidebar link, a typed address, Back or
// Forward leaves the page, so ask about unsaved notes first. While the question is open, and
// when the user keeps the notes, the page stays and this returns false, so nothing is redrawn.
// The move is taken back without rewriting the history (#980): history.go() steps back to the
// page still on screen, by the places of the two entries, so the entry the user tried to reach
// stays where it was (after a typed address or a link, as the next entry, which Forward
// reaches), and the hashchange of that step is passed over, with no question, redraw or scroll
// to the top. Leaving anyway steps to the address asked for again, without asking again. With
// no other entry to step to, the address is put back in place.
export function acceptRoute() {
  const steppingBack = undoing;
  undoing = false;
  // The step back arriving on the page on screen, also when Leave anyway was pressed before it
  // arrived (navigating stays set for the step forward that follows it).
  if (steppingBack && location.hash === shownHash) {
    shownPlace = entryPlace() ?? shownPlace;
    return false;
  }
  const asked = navigating || location.hash === shownHash ? true : allowSwitch();
  if (asked === true) {
    navigating = false;
    showEntry();
    return true;
  }
  const target = location.hash;
  const steps = stepsTaken();
  if (steps === 0) {
    history.replaceState(
      placedState(shownPlace),
      '',
      shownHash || location.pathname + location.search,
    );
    void asked.then(ok => {
      if (!ok || location.hash === target) return;
      navigating = true;
      location.hash = target;
    });
    return false;
  }
  undoing = true;
  history.go(-steps);
  void asked.then(ok => {
    if (!ok) return;
    navigating = true;
    history.go(steps);
  });
  return false;
}

// Records the current entry as the page on screen. An entry without a place is a new one,
// straight after the page it was reached from, and is given that place.
function showEntry() {
  const place = entryPlace();
  if (place !== undefined) shownPlace = place;
  else {
    if (location.hash !== shownHash) shownPlace++;
    placeEntry(shownPlace);
  }
  shownHash = location.hash;
}

// How many entries the user moved from the page on screen to the current one: back (below zero)
// or forward. An entry without a place is a new address, one forward, and is given that place,
// so a later Forward to it is known. 0 when there is no other entry to step to (a history of
// one entry, where the interface tests change the address in place) or no way to tell.
function stepsTaken() {
  if (history.length < 2) return 0;
  const place = entryPlace();
  if (place !== undefined) return place - shownPlace;
  placeEntry(shownPlace + 1);
  return 1;
}

// Notes save themselves after a pause in typing (ui/note-draft.ts). Each notes box on screen
// registers here, so the checks below can see its text and send a waiting one at once. `el`
// is its textarea while mounted; `flush` sends text still waiting for the pause in typing;
// `unsaved` is true while the box shows text the saved note does not have yet (being typed,
// on its way, or refused); `unsent` is true when no write carries that text either (a write
// failed, or nothing has sent it yet), so leaving would lose it. `conflict` is true while the
// box asks which version to keep, because the note was changed elsewhere meanwhile (#1052).
export type NoteBox = {
  el: () => Element | null | undefined;
  flush: () => void;
  unsaved: () => boolean;
  unsent: () => boolean;
  conflict?: () => boolean;
};
export const noteBoxes = new Set<NoteBox>();
const boxesIn = (root: ParentNode) =>
  [...noteBoxes].filter(box => {
    const el = box.el();
    return !!el && root.contains(el);
  });

// Sends every note in `root` that is still waiting for its pause, before the page, profile or
// dialog showing it goes away. save() queues the write at once with the current save and
// profile, so it lands there even when the page changes before it finishes.
export function flushNotes(root: ParentNode = document) {
  for (const box of boxesIn(root)) box.flush();
}

// How many notes boxes on screen ask which version to keep (#1052), for ADA.
export const noteConflicts = () =>
  [...noteBoxes].filter(box => box.el() && box.conflict?.()).length;

// Whether a notes box in `root` shows text that is not saved yet. Holds back refreshing the
// page and closing the tab, and keeps the page when a session ends. `root` narrows the
// check, to the dialog when only the dialog is closing.
export function hasUnsavedNotes(root: ParentNode = document) {
  return boxesIn(root).some(b => b.unsaved());
}

// A choice only an explicit Save stores, unlike a note: the Factories page's "Made on site"
// picker (ui/factories/OnSitePicker.vue, #930), whose ticks save nothing until Save (#854,
// #856), and a build-plan step's edit form (ui/plan/StepEditForm.vue, #969), whose text only
// Save step stores. Each one on screen registers here, so nothing that takes it away drops a
// choice without a word, and nothing saves one by itself. `el` is its element while mounted;
// `label` names it in a question ("Made on site in Alpha", or the step's title); `edits` is set
// for a step's form, so the question speaks of edits to that step; `unsaved` is true while it
// shows a choice that is not saved; `hold` says so beside it and offers Save and Discard (a
// step's form: Save step and Cancel), bringing it into view with focus on its Save when `focus`
// is set; `discard` puts the saved choice back.
export type ChoiceDraft = {
  el: () => Element | null | undefined;
  label: () => string;
  edits?: boolean;
  unsaved: () => boolean;
  hold: (focus: boolean) => void;
  discard: () => void;
};
export const choiceDrafts = new Set<ChoiceDraft>();
const unsavedChoicesIn = (root: ParentNode) =>
  [...choiceDrafts].filter(choice => {
    const el = choice.el();
    return !!el && root.contains(el) && choice.unsaved();
  });

// Whether `root` shows a choice that is not saved yet: the close-tab warning asks then.
export function hasUnsavedChoices(root: ParentNode = document) {
  return unsavedChoicesIn(root).length > 0;
}

// Before a part of the page goes away while the user stays on the page (Done editing, folding a
// group): when it shows an unsaved choice, each such choice says so and offers Save and Discard,
// with focus on the first one's Save, and this returns true, so the caller keeps that part.
// Nothing is saved or dropped here: the user picks one, then goes on.
export function holdUnsavedChoices(root: ParentNode = document): boolean {
  const held = unsavedChoicesIn(root);
  held.forEach((choice, i) => choice.hold(i === 0));
  return held.length > 0;
}

// What is not saved, for the question below: 'your choice in "Made on site in Alpha" is not
// saved yet', 'your edits to the step "Smelt iron" are not saved yet' (#969), or both joined.
function unsavedText(choices: ChoiceDraft[]) {
  const quoted = (drafts: ChoiceDraft[]) =>
    listNames(drafts.map(choice => '"' + choice.label() + '"'));
  const picks = choices.filter(choice => !choice.edits),
    steps = choices.filter(choice => choice.edits);
  const parts = [
    picks.length > 1 ? 'your choices in ' + quoted(picks) : '',
    picks.length === 1 ? 'your choice in ' + quoted(picks) : '',
    steps.length
      ? 'your edits to the ' + (steps.length > 1 ? 'steps ' : 'step ') + quoted(steps)
      : '',
  ].filter(Boolean);
  const plural = picks.length > 1 || steps.length > 0 || parts.length > 1;
  return { text: parts.join(' and ') + (plural ? ' are' : ' is') + ' not saved yet', plural };
}

// The question allowSwitch() asks: about notes a write could not carry, choices not saved, or
// both. The names come from the user (group names, step titles); the dialog draws them as text.
function leaveQuestion(notes: boolean, choices: ChoiceDraft[]) {
  if (!choices.length)
    return {
      title: 'Leave without saving notes?',
      body: 'You have notes that could not be saved. Leave without saving those edits?',
    };
  const { text: choiceText, plural } = unsavedText(choices);
  return notes
    ? {
        title: 'Leave without saving?',
        body:
          'You have notes that could not be saved, and ' +
          choiceText +
          '. Leave without saving those edits?',
      }
    : {
        title: 'Leave without saving?',
        body:
          choiceText[0]!.toUpperCase() +
          choiceText.slice(1) +
          '. Leave without saving ' +
          (plural ? 'them?' : 'it?'),
      };
}

// Whether it is fine to leave the current page (or, with `root`, that part of it). Notes
// waiting for their pause are sent first, and a write already on its way finishes by itself,
// so this asks only when a note would be lost: its write failed (the box says "Not saved"),
// or no write carries its text; or when a choice is not saved (choiceDrafts above: a "Made on
// site" pick, #930, or a step's edit form, #969). It is
// true at once when there is nothing to ask, otherwise the answer of the in-app confirmation
// (ui/confirm.ts), true when the user agrees to drop those notes and choices; the choices then
// show their saved state again, since a phase change keeps the page they are on. So a caller
// that must act in the same event (Escape on the dialog, the hash route) can tell "nothing to
// ask" apart; the others await it. Checked before switching profile, starting the wizard,
// signing out, changing the working phase, following the hash route and closing or replacing
// the detail dialog.
export function allowSwitch(root: ParentNode = document): true | Promise<boolean> {
  flushNotes(root);
  const notes = boxesIn(root).some(b => b.unsent()),
    choices = unsavedChoicesIn(root);
  if (!notes && !choices.length) return true;
  return confirmAction({
    ...leaveQuestion(notes, choices),
    confirmLabel: 'Leave without saving',
    danger: true,
  }).then(ok => {
    if (ok) for (const choice of choices) choice.discard();
    return ok;
  });
}

// Offers `data` as a .json file download (exports and shared profiles).
export function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
