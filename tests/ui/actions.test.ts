// The controls several components share (public/app/ui/actions.ts): progress checkboxes,
// "Save notes", links to a factory's dialog, the dialog's ×, and "Create a save". Each
// component binds them itself, so these click the real elements, mounted the way the app
// mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openFactory } from '../../public/app/factory-detail.ts';
import { calcStage, setQuery, state, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generated, go, open, page, stubFetch } from './setup.ts';
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
