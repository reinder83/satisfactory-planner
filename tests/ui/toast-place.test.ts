// The toast's placement (public/app/toast-place.ts, #663): at the bottom, unless the focused
// control lies under it there, as a refused factory-group rate's field can at 375 px; then at
// the top. Shown again with nothing under it, it is back at the bottom.
import assert from 'node:assert/strict';
import { beforeAll, test } from 'vitest';
import { toast } from '../../public/app/api.ts';
import { watchToast } from '../../public/app/toast-place.ts';
import { $, page } from './setup.ts';

// happy-dom does no layout: the strip at the bottom of a 375 x 812 window, 16px from each side.
const BOTTOM = new DOMRect(16, 706, 343, 84);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

let strip: HTMLElement, field: HTMLInputElement, button: HTMLButtonElement;
beforeAll(() => {
  page();
  strip = $('#toast')!;
  strip.getBoundingClientRect = () =>
    strip.dataset.place === 'top' ? new DOMRect(16, 16, 343, 84) : BOTTOM;
  $('#app')!.innerHTML = '<input id="rate" type="number"><button id="far">Far</button>';
  field = $<HTMLInputElement>('#rate')!;
  button = $<HTMLButtonElement>('#far')!;
  button.getBoundingClientRect = () => new DOMRect(16, 300, 100, 33);
  watchToast(strip);
});

test('a toast over the focused field goes to the top, and comes back down when it is clear', async () => {
  field.getBoundingClientRect = () => new DOMRect(179, 720, 130, 33);
  field.focus();
  toast(
    'Enter a rate above 0, or leave the field empty for the whole output or the remainder.',
    true,
  );
  await settle();
  assert.equal(strip.dataset.place, 'top', 'the field under the bottom strip moves it up');

  button.focus();
  toast('Saved.');
  await settle();
  assert.equal(
    strip.dataset.place,
    undefined,
    'a control clear of the strip leaves it at the bottom',
  );

  // The field beside the strip's top edge, but not under it.
  field.getBoundingClientRect = () => new DOMRect(179, 640, 130, 33);
  field.focus();
  toast('Not saved.', true);
  await settle();
  assert.equal(strip.dataset.place, undefined);
});

test('a focused region, not a control, never moves the toast', async () => {
  const main = document.createElement('main');
  main.tabIndex = -1;
  main.getBoundingClientRect = () => new DOMRect(0, 0, 375, 812);
  document.body.append(main);
  main.focus();
  toast('Profile opened.');
  await settle();
  assert.equal(strip.dataset.place, undefined);
  main.remove();
});
