// The controls several components share (public/app/ui/actions.ts): progress checkboxes,
// "Save notes", links to a factory's dialog, the dialog's ×, and "Create a save". Each
// component binds them itself, so these click the real elements, mounted the way the app
// mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openFactory } from '../../public/app/factory-detail.ts';
import { acceptRoute, refreshState, request } from '../../public/app/api.ts';
import { calcStage, setQuery, setWizard, state, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { answerConfirms, $, generated, go, open, page, stubFetch } from './setup.ts';
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
  assert.equal(box.disabled, true, 'the box waits for the write');
  await settle();
  assert.deepEqual(calls.at(-1), [
    '/api/update',
    { type: 'check', key: 'factory-3-wire', value: true },
  ]);
  assert.equal(state.checks['factory-3-wire'], true);
  const after = $<HTMLInputElement>('.factory-card [data-check="factory-3-wire"]')!;
  assert.equal(after.checked, true);
  assert.equal(after.disabled, false);
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

test('"Save notes" saves the phase notes on the plan page', async () => {
  const calls = applying();
  go('plan');
  render();
  $<HTMLTextAreaElement>('#phase-note')!.value = 'Remember the coal';
  $('[data-save-note="phase-3"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1), [
    '/api/update',
    { type: 'note', key: 'phase-3', value: 'Remember the coal' },
  ]);
  assert.match($('#toast')!.textContent, /Notes saved/);
});

test('a blank note saves without asking about unsaved notes afterwards', async () => {
  // A whitespace-only note is saved by deleting it, as mutate in state.ts does.
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
  $<HTMLTextAreaElement>('#phase-note')!.value = '  ';
  $('[data-save-note="phase-3"]')!.click();
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
  $<HTMLTextAreaElement>('#detail-note')!.value = '  ';
  $('#detail [data-save-note]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'note', key: 'factory-wire', value: '  ' });
  assert.equal($<HTMLDialogElement>('#detail')!.open, false, 'the saved dialog closes');
  assert.equal(asked.length, 0);
});

test('a factory link opens its dialog; saving its notes or the × closes it', async () => {
  const calls = applying();
  go('factories');
  render();
  $('.factory-card button.name[data-factory="wire"]')!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  assert.match($('#detail h2')!.textContent, /Wire/);
  $('#detail .close[data-close]')!.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, false);

  openFactory('wire');
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Needs a second copper line';
  $('#detail-note')!.dispatchEvent(new Event('input'));
  $('#detail [data-save-note]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'note',
    key: 'factory-wire',
    value: 'Needs a second copper line',
  });
  assert.equal(
    $<HTMLDialogElement>('#detail')!.open,
    false,
    'a saved dialog note closes the dialog',
  );

  // A link inside a dialog opens the other factory in its place.
  openFactory('reinforced-iron-plate');
  $('#detail [data-factory="wire"]')!.click();
  assert.match($('#detail h2')!.textContent, /Wire/);
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

test('a note refused as stale shows the latest state, keeps the typed text and says why', async () => {
  state.revision = 4;
  const headers: Record<string, string>[] = [];
  const newer = {
    ...state,
    revision: state.revision + 1,
    notes: { 'phase-3': 'From the other tab' },
  };
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    headers.push({ path: String(path), ...(options.headers as Record<string, string>) });
    if (String(path) === '/api/state') return new Response(JSON.stringify(newer));
    return new Response(JSON.stringify({ error: 'This profile was changed in another tab.' }), {
      status: 409,
    });
  };
  go('plan');
  render();
  const seen = state.revision;
  const box = $<HTMLTextAreaElement>('#phase-note')!;
  box.value = 'Mine';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  $('[data-save-note="phase-3"]')!.click();
  await settle();
  assert.equal(headers[0]!['X-Planner-Revision'], String(seen), 'the write names what it saw');
  assert.equal(headers[1]!.path, '/api/state', 'the refusal reloads the state');
  assert.equal(state.notes['phase-3'], 'From the other tab');
  assert.equal(state.revision, seen + 1);
  assert.match($('#toast')!.textContent, /changed in another tab/);
  assert.ok($('#toast')!.classList.contains('error'));
  assert.equal($<HTMLTextAreaElement>('#phase-note')!.value, 'Mine', 'the typed note survives');
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
