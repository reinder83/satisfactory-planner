// While a notes box says "Not saved" (a failed write, or a version to choose after a note was
// changed elsewhere, #1052), the save status in the sidebar and the top bar says so too, rather
// than "Saved on server" / "Saved": public/AGENTS.md, never show a successful save after a failed
// write. It counted only the writes on their way before. At 390 px the toast about a conflict
// moved off the conflict notice, which it covered for as long as it showed. The stand-in server
// refuses a stale note as both editions do (checkBase, then mutate), or is offline.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { watchToast } from '../../public/app/toast-place.ts';
import { checkBase, mutate } from '../../public/state.ts';
import { $, answerConfirms, go, open, page } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const typeInto = (selector: string, value: string) => {
  const box = $<HTMLTextAreaElement>(selector)!;
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('blur'));
};
// The save status as the sidebar and the top bar show it, and whether it is in the error tone.
const status = () => ({
  sidebar: $('#saved')!.textContent!.trim(),
  topBar: $('#saved-short')!.textContent!.trim(),
  notSaved: $('#saved')!.closest('.save-status')!.classList.contains('is-not-saved'),
});
const SAVED = { sidebar: 'Saved on server', topBar: 'Saved', notSaved: false };
const NOT_SAVED = { sidebar: 'Note not saved', topBar: 'Not saved', notSaved: true };

let saved: ProgressState;
let offline = false;
function server() {
  saved = structuredClone(state);
  offline = false;
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    if (offline) throw new TypeError('Failed to fetch');
    const route = String(path);
    if (route === '/api/state') return new Response(JSON.stringify(saved));
    if (route !== '/api/update') return new Response('{"error":"unexpected"}', { status: 500 });
    const update = JSON.parse(String(options.body)) as UpdateOp;
    try {
      const revision = (options.headers as Record<string, string>)['X-Planner-Revision'];
      checkBase(saved, update, revision);
      const next = mutate(structuredClone(saved), update);
      next.revision = saved.revision + 1;
      saved = next;
      return new Response(JSON.stringify(saved));
    } catch (error) {
      const code = (error as { status?: number }).status ?? 400;
      return new Response(JSON.stringify({ error: (error as Error).message }), { status: code });
    }
  };
}
// Another tab or device saves the note: only the server's copy changes.
const elsewhere = (key: string, value: string) => {
  saved = { ...saved, revision: saved.revision + 1, notes: { ...saved.notes, [key]: value } };
};

beforeEach(async () => {
  page();
  open({ notes: { global: 'Shared start' } });
  answerConfirms(true);
  go('notes');
  server();
  render();
  await settle();
});

test('a failed note write says "Not saved" in the save status until Retry saves it', async () => {
  assert.deepEqual(status(), SAVED);
  offline = true;
  typeInto('#global-note', 'Coal by the river');
  await settle();
  assert.match($('#global-note-status')!.textContent!, /^Not saved/);
  assert.deepEqual(status(), NOT_SAVED, 'not "Saved on server" after a failed write');
  // Back online, Retry saves it.
  offline = false;
  $<HTMLButtonElement>('[data-note-retry]')!.click();
  await settle();
  assert.equal(saved.notes.global, 'Coal by the river');
  assert.deepEqual(status(), SAVED);
});

test('two notes not saved are counted', async () => {
  offline = true;
  typeInto('#global-note', 'Coal by the river');
  typeInto('#phase-note-3', 'Steel first');
  await settle();
  assert.deepEqual(status(), { ...NOT_SAVED, sidebar: '2 notes not saved' });
});

test('a note waiting for a choice says "Not saved" in the save status until one is made', async () => {
  elsewhere('global', 'Theirs');
  typeInto('#global-note', 'Mine');
  await settle();
  assert.ok($('[data-note-conflict="global"]'), 'the box asks which version to keep');
  assert.deepEqual(status(), NOT_SAVED);
  $<HTMLButtonElement>('[data-note-keep="mine"]')!.click();
  await settle();
  assert.equal(saved.notes.global, 'Mine');
  assert.deepEqual(status(), SAVED);
});

test('Keep theirs, which saves nothing, also ends it', async () => {
  elsewhere('global', 'Theirs');
  typeInto('#global-note', 'Mine');
  await settle();
  assert.deepEqual(status(), NOT_SAVED);
  $<HTMLButtonElement>('[data-note-keep="theirs"]')!.click();
  await settle();
  assert.deepEqual(status(), SAVED);
});

// happy-dom lays nothing out: a 390 x 844 window, the toast strip 16px from each side at the
// bottom, or at the top, and the conflict notice drawn down to the bottom of the window.
test('at 390 px the toast about a conflict moves off the conflict notice', async () => {
  const toast = $('#toast')!;
  watchToast(toast);
  toast.getBoundingClientRect = () =>
    toast.dataset.place === 'top' ? new DOMRect(16, 16, 358, 100) : new DOMRect(16, 722, 358, 100);
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.matches('.note-conflict') ? new DOMRect(16, 470, 358, 374) : realRect.call(this);
  };
  try {
    elsewhere('global', 'Theirs');
    typeInto('#global-note', 'Mine');
    (document.activeElement as HTMLElement | null)?.blur();
    await settle();
    assert.ok($('[data-note-conflict="global"]'));
    assert.ok(toast.classList.contains('show'), 'the toast says what happened');
    assert.equal(toast.dataset.place, 'top', 'not over the notice and its choices');
  } finally {
    HTMLElement.prototype.getBoundingClientRect = realRect;
  }
});
