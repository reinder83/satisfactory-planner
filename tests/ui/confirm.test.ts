// The in-app confirmation (public/app/ui/confirm.ts and ConfirmDialog.vue, #241), which
// replaced the browser's confirm(): its answers, focus, dismissal and stacking above #detail.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { confirmAction } from '../../public/app/ui/confirm.ts';
import { openFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { $, evil, go, open, page } from './setup.ts';

const dialog = () => $<HTMLDialogElement>('#confirm')!;
const ask = (danger?: boolean) =>
  confirmAction({ title: 'Remove this?', body: 'It goes.', confirmLabel: 'Remove', danger });

beforeEach(() => {
  page();
  open();
});

test('the confirm button answers yes and Cancel no, and the dialog closes and empties', async () => {
  const yes = ask(true);
  assert.equal(dialog().open, true);
  assert.equal($('#confirm-title')!.textContent, 'Remove this?');
  assert.equal($('#confirm-body')!.textContent, 'It goes.');
  assert.equal($('#confirm [data-confirm-ok]')!.textContent!.trim(), 'Remove');
  assert.ok($('#confirm [data-confirm-ok]')!.classList.contains('danger'));
  $('#confirm [data-confirm-ok]')!.click();
  assert.equal(await yes, true);
  assert.equal(dialog().open, false);
  assert.equal(dialog().querySelector('button'), null, 'unmounted');
  const declined = ask(true);
  $('#confirm [data-confirm-cancel]')!.click();
  assert.equal(await declined, false);
});

test('focus starts on Cancel for a destructive action, on the confirm button otherwise, and goes back', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const danger = ask(true);
  assert.equal(document.activeElement, $('#confirm [data-confirm-cancel]'));
  $('#confirm [data-confirm-cancel]')!.click();
  await danger;
  assert.equal(document.activeElement, trigger, 'back on the button that asked');
  const plain = ask(false);
  assert.equal(document.activeElement, $('#confirm [data-confirm-ok]'));
  assert.ok($('#confirm [data-confirm-ok]')!.classList.contains('primary'));
  $('#confirm [data-confirm-ok]')!.click();
  await plain;
  assert.equal(document.activeElement, trigger);
});

test('Escape and a click on the backdrop answer no', async () => {
  const escape = ask(true);
  const cancel = new Event('cancel', { cancelable: true });
  dialog().dispatchEvent(cancel);
  assert.equal(await escape, false);
  assert.equal(dialog().open, false);
  const backdrop = ask(true);
  // A click pressed and released on the <dialog> itself outside its box is a click on the
  // backdrop (tests/ui/backdrop.test.ts covers the clicks that are not).
  for (const type of ['mousedown', 'click'])
    dialog().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: -5, clientY: -5 }));
  assert.equal(await backdrop, false);
  assert.equal(dialog().open, false);
});

test('it opens above the factory dialog and answering leaves that dialog open', async () => {
  go('factories');
  render();
  openFactory('wire');
  const detail = $<HTMLDialogElement>('#detail')!;
  assert.equal(detail.open, true);
  const inside = detail.querySelector<HTMLElement>('.close')!;
  inside.focus();
  const answer = ask(true);
  assert.equal(dialog().open, true);
  assert.equal(detail.open, true);
  // Escape reaches the topmost dialog only: the question.
  dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  assert.equal(await answer, false);
  await nextTick();
  assert.equal(detail.open, true, 'the factory dialog stays');
  assert.equal(document.activeElement, inside, 'focus is back inside it');
});

test('a name in the question stays text', async () => {
  const answer = confirmAction({
    title: `Hide ${evil}?`,
    body: `Remove "${evil}" and its progress?`,
    confirmLabel: evil,
    danger: true,
  });
  assert.equal(document.querySelector('x-evil'), null);
  assert.equal($('#confirm-title')!.textContent, `Hide ${evil}?`);
  $('#confirm [data-confirm-cancel]')!.click();
  assert.equal(await answer, false);
});
