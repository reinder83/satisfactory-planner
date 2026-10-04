// A note changed in another tab or on another device while this tab's box held other text
// (#1052): the box shows both versions and saves nothing until the user picks one, "Keep mine",
// "Keep theirs" or "Keep both". The stand-in server below refuses a write as both editions do
// (checkBase, then mutate, in public/state/mutate.ts), so the box meets the real refusal.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { acceptRoute } from '../../public/app/api.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { NOTE_SAVE_DELAY } from '../../public/app/ui/note-draft.ts';
import { checkBase, mutate } from '../../public/state.ts';
import { answerConfirms, $, evil, go, open, page } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const pause = () => new Promise(resolve => setTimeout(resolve, NOTE_SAVE_DELAY + 100));
const typeInto = (selector: string, value: string) => {
  const box = $<HTMLTextAreaElement>(selector)!;
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return box;
};
const focused = () => {
  const el = document.activeElement;
  return el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : 'nothing';
};

// The saved profile on the stand-in server, and the note writes this tab sent to it, in order.
let saved: ProgressState;
let writes: UpdateOp[];
function server() {
  saved = structuredClone(state);
  writes = [];
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const route = String(path);
    if (route === '/api/state') return new Response(JSON.stringify(saved));
    if (route !== '/api/update') return new Response('{"error":"unexpected"}', { status: 500 });
    const update = JSON.parse(String(options.body)) as UpdateOp;
    writes.push(update);
    try {
      const revision = (options.headers as Record<string, string>)['X-Planner-Revision'];
      checkBase(saved, update, revision);
      const next = mutate(structuredClone(saved), update);
      next.revision = saved.revision + 1;
      saved = next;
      return new Response(JSON.stringify(saved));
    } catch (error) {
      const status = (error as { status?: number }).status ?? 400;
      return new Response(JSON.stringify({ error: (error as Error).message }), { status });
    }
  };
}
// Another tab or device saves the note: only the server's copy changes.
const elsewhere = (key: string, value: string) => {
  saved = { ...saved, revision: saved.revision + 1, notes: { ...saved.notes, [key]: value } };
};
const conflictShown = () => $('[data-note-conflict="global"]');
const theirs = () => $<HTMLTextAreaElement>('#global-note-theirs')?.value;
const box = () => $<HTMLTextAreaElement>('#global-note')!;

beforeEach(() => {
  page();
  open({ notes: { global: 'Shared start' } });
  answerConfirms(true);
  go('notes');
  server();
  render();
});

// Types over the saved note while another tab saves its own text, then lets the box save.
async function clash(mine = 'Mine') {
  elsewhere('global', 'Theirs ' + evil);
  typeInto('#global-note', mine).dispatchEvent(new Event('blur'));
  await settle();
}

test('a refused note write shows both versions and saves nothing more until a choice', async () => {
  await clash();
  // The write named the text it was typed over, and the server refused it.
  assert.deepEqual(writes, [{ type: 'note', key: 'global', value: 'Mine', base: 'Shared start' }]);
  assert.equal(saved.notes.global, 'Theirs ' + evil, 'the other version is kept');
  assert.ok(conflictShown(), 'both versions are shown');
  assert.equal(box().value, 'Mine', 'my text stays in the box');
  assert.equal(theirs(), 'Theirs ' + evil, 'the other version, as text');
  assert.ok($<HTMLTextAreaElement>('#global-note-theirs')!.readOnly);
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  assert.equal($('#global-note-status')!.dataset.noteStatus, 'conflict');
  assert.match($('#global-note-status')!.textContent!, /changed elsewhere/);
  assert.match($('#toast')!.textContent!, /Both versions are shown under the note/);
  assert.equal($('[data-note-retry]'), null, 'no Retry that would overwrite it');
  // ADA leads with it (a warning).
  adaClearFault();
  setAdaIndex(0);
  assert.equal(adaCurrent()!.id, 'note-conflict');
  // The choices are named for a screen reader: a group labelled by the notice's sentence.
  const group = conflictShown()!;
  assert.equal(group.getAttribute('role'), 'group');
  assert.match($('#' + group.getAttribute('aria-labelledby'))!.textContent!, /another device/);
  assert.deepEqual(
    [...group.querySelectorAll('button')].map(button => button.textContent!.trim()),
    ['Keep mine', 'Keep theirs', 'Keep both'],
  );
  // Typing on, blurring and pausing save nothing.
  typeInto('#global-note', 'Mine, and more');
  box().dispatchEvent(new Event('blur'));
  await pause();
  await settle();
  assert.equal(writes.length, 1, 'no keystroke overwrites the other version');
  assert.equal(saved.notes.global, 'Theirs ' + evil);
});

test('Keep mine saves my text over the other version, as shown', async () => {
  await clash();
  typeInto('#global-note', 'Mine, and more');
  $('[data-note-keep="mine"]')!.click();
  await settle();
  assert.deepEqual(writes.at(-1), {
    type: 'note',
    key: 'global',
    value: 'Mine, and more',
    base: 'Theirs ' + evil,
  });
  assert.equal(saved.notes.global, 'Mine, and more');
  assert.equal(conflictShown(), null);
  assert.equal(focused(), 'textarea#global-note', 'focus goes back to the note');
  assert.match($('#global-note-status')!.textContent!, /^Saved · /);
  // Typing again saves as usual.
  typeInto('#global-note', 'Mine, edited').dispatchEvent(new Event('blur'));
  await settle();
  assert.equal(saved.notes.global, 'Mine, edited');
});

test('Keep theirs puts the other version in the box and writes nothing', async () => {
  await clash();
  $('[data-note-keep="theirs"]')!.click();
  await settle();
  assert.equal(writes.length, 1, 'only the refused write');
  assert.equal(box().value, 'Theirs ' + evil);
  assert.equal(saved.notes.global, 'Theirs ' + evil);
  assert.equal(conflictShown(), null);
  assert.equal(focused(), 'textarea#global-note');
  // Nothing is left to ask about when leaving.
  history.replaceState(null, '', '#notes');
  acceptRoute();
  history.replaceState(null, '', '#plan');
  assert.equal(acceptRoute(), true);
  // An edit from there is typed over the other version and saves.
  history.replaceState(null, '', '#notes');
  acceptRoute();
  typeInto('#global-note', 'Theirs, edited').dispatchEvent(new Event('blur'));
  await settle();
  assert.equal(saved.notes.global, 'Theirs, edited');
});

test('Keep both saves the other version and mine in one note', async () => {
  await clash();
  $('[data-note-keep="both"]')!.click();
  await settle();
  assert.equal(saved.notes.global, 'Theirs ' + evil + '\n\nMine');
  assert.equal(box().value, 'Theirs ' + evil + '\n\nMine');
  assert.equal(writes.at(-1)!.type, 'note');
  assert.equal((writes.at(-1) as { base?: string }).base, 'Theirs ' + evil);
  assert.equal(conflictShown(), null);
});

test('Keep both is unavailable when the two together are too long for a note', async () => {
  elsewhere('global', 'x'.repeat(5000));
  typeInto('#global-note', 'y'.repeat(1500)).dispatchEvent(new Event('blur'));
  await settle();
  const both = $<HTMLButtonElement>('[data-note-keep="both"]')!;
  assert.equal(both.disabled, true);
  assert.match($('#' + both.getAttribute('aria-describedby'))!.textContent!, /6,000 characters/);
  // Shortening my text makes it available.
  typeInto('#global-note', 'short');
  await settle();
  assert.equal($<HTMLButtonElement>('[data-note-keep="both"]')!.disabled, false);
});

test('a choice made over a version that changed again asks again', async () => {
  await clash();
  elsewhere('global', 'Third version');
  $('[data-note-keep="mine"]')!.click();
  await settle();
  assert.equal(saved.notes.global, 'Third version', 'nothing replaced it');
  assert.ok(conflictShown());
  assert.equal(theirs(), 'Third version');
  assert.equal(box().value, 'Mine');
});

test('a note changed underneath a draft by another write’s reply asks too', async () => {
  // A phase note typed, then a tick's reply (here: the save-wide note's own) brings the other
  // tab's phase note before the draft is sent.
  typeInto('#phase-note-3', 'My phase plan');
  elsewhere('phase-3', 'Their phase plan');
  typeInto('#global-note', 'Seed 4242').dispatchEvent(new Event('blur'));
  await settle();
  assert.ok($('[data-note-conflict="phase-3"]'), 'the phase note asks');
  assert.equal($<HTMLTextAreaElement>('#phase-note-3-theirs')!.value, 'Their phase plan');
  await pause();
  await settle();
  assert.deepEqual(
    writes.map(write => (write as { key: string }).key),
    ['global'],
    'the phase draft waits for a choice',
  );
  assert.equal(saved.notes['phase-3'], 'Their phase plan');
});

test('leaving with a conflict open asks first', async () => {
  const asked = answerConfirms(false);
  history.replaceState(null, '', '#notes');
  acceptRoute();
  await clash();
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), false);
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /could not be saved/);
  assert.equal(saved.notes.global, 'Theirs ' + evil);
});

test('a note saved elsewhere into an untouched box simply shows, and my own replies never ask', async () => {
  // My own writes, one after the other while the first is on its way, never count as a change.
  typeInto('#global-note', 'One').dispatchEvent(new Event('blur'));
  typeInto('#global-note', 'One two').dispatchEvent(new Event('blur'));
  await settle();
  assert.equal(saved.notes.global, 'One two');
  assert.equal(conflictShown(), null);
  // An untouched phase box takes the other tab's note without asking.
  elsewhere('phase-4', 'Phase 4 from elsewhere');
  typeInto('#global-note', 'One two three').dispatchEvent(new Event('blur'));
  await settle();
  assert.equal($<HTMLTextAreaElement>('#phase-note-4')!.value, 'Phase 4 from elsewhere');
  assert.equal($('[data-note-conflict="phase-4"]'), null);
});

test('a note refused after its page has gone comes back asking which to keep', async () => {
  // The write waits until released; meanwhile the page changes and another tab saves the note.
  const answer = globalThis.fetch;
  let release: () => void = () => {};
  globalThis.fetch = async (path: RequestInfo | URL, options?: RequestInit) => {
    if (String(path) === '/api/update') await new Promise<void>(resolve => (release = resolve));
    return answer(path, options);
  };
  history.replaceState(null, '', '#notes');
  acceptRoute();
  typeInto('#global-note', 'Mine');
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), true, 'the note is on its way, so nothing is asked');
  go('storage');
  render();
  await settle();
  elsewhere('global', 'Theirs');
  release();
  await settle();
  assert.equal(saved.notes.global, 'Theirs', 'refused');
  go('notes');
  render();
  await settle();
  assert.equal(box().value, 'Mine');
  assert.ok(conflictShown());
  assert.equal(theirs(), 'Theirs');
});
