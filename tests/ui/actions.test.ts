// The controls several components share (public/app/ui/actions.ts): progress checkboxes,
// notes boxes (which save themselves), links to a factory's dialog, the dialog's ×, and "Create a save". Each
// component binds them itself, so these click the real elements, mounted the way the app
// mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openFactory } from '../../public/app/factory-detail.ts';
import { acceptRoute, refreshState, request } from '../../public/app/api.ts';
import { calcStage, setQuery, setWizard, state, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { NOTE_SAVE_DELAY } from '../../public/app/ui/note-draft.ts';
import { answerConfirms, $, $$, generated, go, open, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const plan = generated();

const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};

// /api/update applying a check or note op to the open state, as the server does.
type CheckOrNote = Extract<UpdateOp, { type: 'check' | 'note' }>;
const applying = () =>
  stubFetch<CheckOrNote>({
    '/api/update': (op: CheckOrNote) =>
      op.type === 'check'
        ? { ...state, checks: { ...state.checks, [op.key]: op.value } }
        : { ...state, notes: { ...state.notes, [op.key]: op.value } },
  });

beforeEach(() => {
  page();
  open();
  setQuery('');
});

test('ticking a progress checkbox saves it and redraws the page', async () => {
  const calls = applying();
  go('factories');
  render();
  const box = $<HTMLInputElement>('.factory-card [data-check="factory-3-wire"]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  // Busy rather than disabled, so it keeps focus (#299).
  assert.equal(box.getAttribute('aria-disabled'), 'true', 'the box waits for the write');
  assert.equal(box.disabled, false);
  await settle();
  assert.deepEqual(calls.at(-1), [
    '/api/update',
    { type: 'check', key: 'factory-3-wire', value: true },
  ]);
  assert.equal(state.checks['factory-3-wire'], true);
  const after = $<HTMLInputElement>('.factory-card [data-check="factory-3-wire"]')!;
  assert.equal(after.checked, true);
  assert.equal(after.disabled, false);
  assert.equal(after.getAttribute('aria-disabled'), null);
  assert.ok(after.closest('.factory-card')!.classList.contains('done'));
});

// A server whose session has ended: every write answers 401, and /api/workspace (which is
// answered signed out too) has no user.
const sessionEnded = () => {
  const calls: string[] = [];
  globalThis.fetch = async (path: RequestInfo | URL) => {
    calls.push(String(path));
    return String(path) === '/api/workspace'
      ? new Response(JSON.stringify({ user: null, accountsEnabled: true, saves: [] }))
      : new Response(JSON.stringify({ error: 'Sign in to continue.' }), { status: 401 });
  };
  return calls;
};

test('a write refused because the session ended shows the sign-in screen', async () => {
  const calls = sessionEnded();
  go('factories');
  render();
  const box = $<HTMLInputElement>('.factory-card [data-check="factory-3-wire"]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  await settle();
  assert.deepEqual(calls, ['/api/update', '/api/workspace']);
  assert.ok($('#auth-form'), 'the sign-in form is on screen');
  assert.equal($('.layout'), null, 'the signed-in frame is gone');
});

test('with unsaved notes on screen, an ended session keeps the page and says so', async () => {
  const calls = sessionEnded();
  go('plan');
  render();
  $<HTMLTextAreaElement>('#phase-note')!.value = 'Unsaved thought';
  // Straight through request(): a tick would redraw the page and clear the note first (#110).
  await assert.rejects(request('/api/update', { method: 'POST', body: '{}' }), /Sign in/);
  await settle();
  assert.deepEqual(calls, ['/api/update']);
  assert.ok($('.layout'), 'still on the page');
  assert.equal($<HTMLTextAreaElement>('#phase-note')!.value, 'Unsaved thought');
  assert.match($('#toast')!.textContent, /session has ended/i);
});

test('signed out, a 401 (a wrong password) does not reload the sign-in screen', async () => {
  const calls = sessionEnded();
  open({ workspace: { user: null, accountsEnabled: true } });
  await assert.rejects(request('/api/login', { method: 'POST', body: '{}' }));
  await settle();
  assert.deepEqual(calls, ['/api/login']);
});

test('a 401 from the server password (HTTP Basic) is not taken for an ended session', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (path: RequestInfo | URL) => {
    calls.push(String(path));
    return new Response(JSON.stringify({ error: 'Sign in to the planner.' }), {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Satisfactory Planner", charset="UTF-8"' },
    });
  };
  go('plan');
  render();
  await assert.rejects(
    request('/api/update', { method: 'POST', body: '{}' }),
    /Sign in to the planner/,
  );
  await settle();
  assert.deepEqual(calls, ['/api/update'], 'no re-check of the session');
  assert.ok($('.layout'), 'the page stays');
});

test('a failed tick puts the box back', async () => {
  stubFetch({});
  go('plan');
  render();
  const box = $<HTMLInputElement>('#main .checklist [data-check]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(box.checked, false);
  assert.equal(box.disabled, false);
  assert.deepEqual(state.checks, {});
});

// Notes save themselves (#237, ui/note-draft.ts): NOTE_SAVE_DELAY after typing stops, or at
// once when the box loses focus. `typeInto` types as the browser does: value, then input.
const typeInto = (selector: string, value: string) => {
  const box = $<HTMLTextAreaElement>(selector)!;
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return box;
};
const pause = () => new Promise(r => setTimeout(r, NOTE_SAVE_DELAY + 100));
// Which element has focus, as "tag#id", so a failed check prints it rather than the element.
const focused = () => {
  const el = document.activeElement;
  return el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : 'nothing';
};
const noteWrites = (calls: [string, unknown][]) =>
  calls.filter(([path, body]) => path === '/api/update' && (body as UpdateOp).type === 'note');

test('typing a phase note saves it once, after the pause, and says when', async () => {
  const calls = applying();
  // Each write waits for release(), so "Saving…" can be seen while it is on its way.
  const applied = globalThis.fetch;
  let release = () => {};
  globalThis.fetch = async (path: RequestInfo | URL, options?: RequestInit) => {
    await new Promise<void>(r => (release = r));
    return applied(path, options);
  };
  go('plan');
  render();
  const status = $('#phase-note-status')!;
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.textContent, 'Saves as you type.');
  typeInto('#phase-note', 'Remember');
  typeInto('#phase-note', 'Remember the');
  await settle();
  typeInto('#phase-note', 'Remember the coal');
  await settle();
  // Nothing is being saved yet, so the status line does not say so.
  assert.equal(status.textContent, 'Saves as you type.');
  assert.deepEqual(noteWrites(calls), [], 'nothing is written while typing goes on');
  await pause();
  assert.equal(status.textContent, 'Saving…', 'the write has started');
  release();
  await settle();
  assert.deepEqual(noteWrites(calls), [
    ['/api/update', { type: 'note', key: 'phase-3', value: 'Remember the coal' }],
  ]);
  assert.equal(state.notes['phase-3'], 'Remember the coal');
  await nextTick();
  assert.match($('#phase-note-status')!.textContent, /^Saved · \d{1,2}[:.]\d{2}/);
  assert.equal($<HTMLTextAreaElement>('#phase-note')!.value, 'Remember the coal');
  assert.equal($('[data-note-retry]'), null);
  assert.doesNotMatch($('#toast')!.textContent, /changed while you were editing/);
});

test('leaving a notes box saves it at once, and a later reply does not undo more typing', async () => {
  const calls = applying();
  go('plan');
  render();
  typeInto('#phase-note', 'First').dispatchEvent(new Event('blur'));
  // Typing goes on while the write is on its way: its reply keeps the newer text.
  typeInto('#phase-note', 'First and second');
  await settle();
  assert.deepEqual(noteWrites(calls), [
    ['/api/update', { type: 'note', key: 'phase-3', value: 'First' }],
  ]);
  assert.equal(state.notes['phase-3'], 'First');
  assert.equal($<HTMLTextAreaElement>('#phase-note')!.value, 'First and second');
  assert.doesNotMatch($('#toast')!.textContent, /changed while you were editing/);
  await pause();
  assert.equal(noteWrites(calls).length, 2);
  assert.equal(state.notes['phase-3'], 'First and second');
});

test('a blank note saves without asking about unsaved notes afterwards', async () => {
  // A whitespace-only note is saved by deleting it, as mutate in state.ts does.
  open({ notes: { 'phase-3': 'Old', 'factory-wire': 'Old' } });
  const calls = stubFetch<CheckOrNote>({
    '/api/update': (op: CheckOrNote) => {
      const notes = { ...state.notes };
      delete notes[op.key];
      return { ...state, notes };
    },
  });
  const asked = answerConfirms(false);
  go('plan');
  render();
  history.replaceState(null, '', '#plan');
  acceptRoute();
  typeInto('#phase-note', '  ').dispatchEvent(new Event('blur'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'note', key: 'phase-3', value: '  ' });
  assert.equal(state.notes['phase-3'], undefined);
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), true, 'leaving the plan page after the save');
  history.replaceState(null, '', '#plan');
  acceptRoute();

  go('factories');
  render();
  openFactory('wire');
  typeInto('#detail-note', '  ').dispatchEvent(new Event('blur'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'note', key: 'factory-wire', value: '  ' });
  assert.equal($<HTMLDialogElement>('#detail')!.open, true, 'saving no longer closes the dialog');
  $('#detail .close[data-close]')!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, false);
  await settle();
  assert.equal(asked.length, 0);
});

test('a factory link opens its dialog; the × sends a note still being typed and closes it', async () => {
  const calls = applying();
  const asked = answerConfirms(false);
  go('factories');
  render();
  $('.factory-card button.name[data-factory="wire"]')!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  assert.match($('#detail h2')!.textContent, /Wire/);
  $('#detail .close[data-close]')!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, false);

  openFactory('wire');
  assert.equal($('#detail [data-save-note]')!.id, 'detail-note');
  assert.equal($$('#detail .note-save button').length, 0, 'no "Save notes" button');
  typeInto('#detail-note', 'Needs a second copper line');
  $('#detail .close[data-close]')!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, false, 'nothing to ask: the note is sent');
  await settle();
  assert.equal(asked.length, 0);
  assert.deepEqual(calls.at(-1)![1], {
    type: 'note',
    key: 'factory-wire',
    value: 'Needs a second copper line',
  });
  assert.equal(state.notes['factory-wire'], 'Needs a second copper line');
  await pause();
  assert.equal(noteWrites(calls).length, 1, 'one write, not another after the pause');

  // A link inside a dialog opens the other factory in its place.
  openFactory('reinforced-iron-plate');
  $('#detail [data-factory="wire"]')!.click();
  assert.match($('#detail h2')!.textContent, /Wire/);
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, 'Needs a second copper line');
});

test('a calculated factory link opens that row’s dialog', () => {
  open({ calculated: plan });
  go('factories');
  render();
  const row = calcStage()!.rows!.find(r => r.machines > 0)!;
  $(`.factory-card button.name[data-calc-factory="${row.id}"]`)!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  assert.equal($('#detail h2')!.textContent, row.name);
});

test('"Create a save" on the profiles page starts the wizard', () => {
  go('profiles');
  render();
  $('[data-new-save]')!.click();
  assert.ok(wizard, 'a draft is open');
  assert.equal(wizard.saveId, null, 'for a new save');
});

test('a note refused as stale shows the latest state, keeps the typed text and offers Retry', async () => {
  state.revision = 4;
  const headers: Record<string, string>[] = [];
  const newer = {
    ...state,
    revision: state.revision + 1,
    notes: { 'phase-3': 'From the other tab' },
  };
  let refuse = true;
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    headers.push({ path: String(path), ...(options.headers as Record<string, string>) });
    if (String(path) === '/api/state') return new Response(JSON.stringify(newer));
    if (!refuse) {
      const op = JSON.parse(String(options.body)) as CheckOrNote;
      return new Response(
        JSON.stringify({ ...state, revision: 6, notes: { ...state.notes, [op.key]: op.value } }),
      );
    }
    return new Response(JSON.stringify({ error: 'This profile was changed in another tab.' }), {
      status: 409,
    });
  };
  const asked = answerConfirms(false);
  go('plan');
  render();
  history.replaceState(null, '', '#plan');
  acceptRoute();
  const seen = state.revision;
  typeInto('#phase-note', 'Mine').dispatchEvent(new Event('blur'));
  await settle();
  await settle();
  assert.equal(headers[0]!['X-Planner-Revision'], String(seen), 'the write names what it saw');
  assert.equal(headers[1]!.path, '/api/state', 'the refusal reloads the state');
  assert.equal(state.notes['phase-3'], 'From the other tab');
  assert.equal(state.revision, seen + 1);
  assert.match($('#toast')!.textContent, /changed in another tab/);
  assert.ok($('#toast')!.classList.contains('error'));
  assert.equal($<HTMLTextAreaElement>('#phase-note')!.value, 'Mine', 'the typed note survives');
  assert.equal($('#phase-note-status')!.textContent, 'Not saved —');
  assert.equal($('[data-note-retry]')!.textContent!.trim(), 'Retry');

  // Leaving now would lose it, so the page asks, and stays when the answer is no.
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), false);
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /could not be saved/, 'asked in the app (#confirm)');
  assert.equal(location.hash, '#plan');

  // Retry sends the kept text again; it replaces the other tab's version.
  refuse = false;
  $<HTMLButtonElement>('[data-note-retry]')!.focus();
  $('[data-note-retry]')!.click();
  await settle();
  assert.equal(headers.at(-1)!.path, '/api/update');
  // The button goes once the note is saved; focus goes back to the note, not to <body> (#283).
  assert.equal(focused(), 'textarea#phase-note');
  assert.equal(state.notes['phase-3'], 'Mine');
  assert.match($('#phase-note-status')!.textContent, /^Saved · /);
  assert.equal($('[data-note-retry]'), null);
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), true, 'nothing left to ask about');
  await settle();
  assert.equal(asked.length, 1);
});

test('Retry in a dialog keeps the keyboard in its notes box once the note is saved (#283)', async () => {
  const calls = applying();
  const applied = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async (path: RequestInfo | URL, options?: RequestInit) =>
    fail
      ? new Response(JSON.stringify({ error: 'The disk is full.' }), { status: 500 })
      : applied(path, options);
  go('factories');
  render();
  openFactory('wire');
  typeInto('#detail-note', 'Second copper line').dispatchEvent(new Event('blur'));
  await settle();
  const retry = $<HTMLButtonElement>('#detail [data-note-retry]')!;
  retry.focus();
  assert.equal(focused(), 'button');
  fail = false;
  retry.click();
  await settle();
  assert.deepEqual(noteWrites(calls), [
    ['/api/update', { type: 'note', key: 'factory-wire', value: 'Second copper line' }],
  ]);
  assert.equal(state.notes['factory-wire'], 'Second copper line');
  assert.equal($('#detail [data-note-retry]'), null);
  assert.equal(focused(), 'textarea#detail-note', 'focus stays in the dialog, on the note');
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
});

test('a note whose write fails after its page has gone comes back marked unsaved', async () => {
  let release: () => void = () => {};
  globalThis.fetch = async () => {
    await new Promise<void>(r => (release = r));
    return new Response(JSON.stringify({ error: 'The disk is full.' }), { status: 500 });
  };
  go('plan');
  render();
  history.replaceState(null, '', '#plan');
  acceptRoute();
  typeInto('#phase-note', 'Keep me');
  // Leaving sends the note first and asks nothing: the write is on its way.
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), true);
  go('storage');
  render();
  await settle();
  release();
  await settle();
  assert.match($('#toast')!.textContent, /disk is full/);
  go('plan');
  render();
  await nextTick();
  assert.equal($<HTMLTextAreaElement>('#phase-note')!.value, 'Keep me');
  assert.equal($('#phase-note-status')!.textContent, 'Not saved —');
  assert.ok($('[data-note-retry]'));
});

test('coming back to a tab picks up changes saved elsewhere, unless something is unsaved', async () => {
  state.revision = 4;
  const newer = { ...state, revision: 5, checks: { 'factory-3-wire': true } };
  stubFetch({ '/api/state': newer });
  go('factories');
  render();
  // A note with unsaved text holds the refresh back.
  go('plan');
  render();
  $<HTMLTextAreaElement>('#phase-note')!.value = 'Typing';
  assert.equal(await refreshState(), false);
  assert.equal(state.checks['factory-3-wire'], undefined);
  $<HTMLTextAreaElement>('#phase-note')!.value = '';
  // So does an open wizard, whose typed answers are read only when a step is left.
  const draft = wizard;
  setWizard(draft || ({} as NonNullable<typeof wizard>));
  assert.equal(await refreshState(), false);
  setWizard(null);
  // The listener in listeners.ts calls refreshState on visibilitychange.
  assert.equal(await refreshState(), true);
  assert.equal(state.checks['factory-3-wire'], true);
  assert.equal(await refreshState(), false, 'nothing new the second time');
});
