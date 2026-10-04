// The toast's placement (public/app/toast-place.ts, #663, #731): at the bottom, unless the
// focused control lies under it there, as a refused factory-group rate's field can at 375 px;
// then at the top. On a phone it also goes to the top whenever a form field has focus, since
// that field's on-screen keyboard covers the bottom of the screen (#731), and so it does on a
// touch screen wider than that, a phone held sideways or a tablet (#803). Shown again with
// nothing under it, it is back at the bottom.
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { toast } from '../../public/app/api.ts';
import { watchToast } from '../../public/app/toast-place.ts';
import { $, page } from './setup.ts';

// happy-dom does no layout: the strip at the bottom of a 375 x 812 window, 16px from each side.
const BOTTOM = new DOMRect(16, 706, 343, 84);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// The window's width as the stylesheet's phone query sees it, and whether its main pointer is
// a finger, set per test.
let phone = false;
let touch = false;
const realMatchMedia = window.matchMedia;

// A media query list matches when any of its comma-separated queries does.
const matchesQuery = (query: string) =>
  query
    .split(',')
    .map(part => part.trim())
    .some(
      part => (part === '(max-width: 720px)' && phone) || (part === '(pointer: coarse)' && touch),
    );

let strip: HTMLElement, field: HTMLInputElement, button: HTMLButtonElement;
let tick: HTMLInputElement, select: HTMLSelectElement;
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: matchesQuery(query),
      media: query,
    }) as MediaQueryList; // only matches is read
  page();
  strip = $('#toast')!;
  strip.getBoundingClientRect = () =>
    strip.dataset.place === 'top' ? new DOMRect(16, 16, 343, 84) : BOTTOM;
  $('#app')!.innerHTML =
    '<input id="rate" type="number"><button id="far">Far</button>' +
    '<input id="tick" type="checkbox"><select id="pick"><option>A</option></select>';
  field = $<HTMLInputElement>('#rate')!;
  button = $<HTMLButtonElement>('#far')!;
  tick = $<HTMLInputElement>('#tick')!;
  select = $<HTMLSelectElement>('#pick')!;
  button.getBoundingClientRect = () => new DOMRect(16, 300, 100, 33);
  tick.getBoundingClientRect = () => new DOMRect(16, 200, 20, 20);
  select.getBoundingClientRect = () => new DOMRect(16, 120, 200, 33);
  watchToast(strip);
});
afterAll(() => {
  window.matchMedia = realMatchMedia;
});

const show = async (focused: HTMLElement | null, message = 'Not saved.') => {
  if (focused) focused.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
  toast(message, true);
  await settle();
  return strip.dataset.place;
};

test('a toast over the focused field goes to the top, and comes back down when it is clear', async () => {
  phone = false;
  field.getBoundingClientRect = () => new DOMRect(179, 720, 130, 33);
  field.focus();
  toast('Enter a rate above 0, or leave the field empty for the whole output or the rest.', true);
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
  assert.equal(await show(field), undefined, 'on a wide screen a field clear of it stays put');
});

test('a focused region, not a control, never moves the toast', async () => {
  for (const narrow of [false, true]) {
    phone = narrow;
    const main = document.createElement('main');
    main.tabIndex = -1;
    main.getBoundingClientRect = () => new DOMRect(0, 0, 375, 812);
    document.body.append(main);
    main.focus();
    toast('Profile opened.');
    await settle();
    assert.equal(strip.dataset.place, undefined);
    main.remove();
  }
});

test('on a phone a focused form field puts the toast at the top, wherever the field is (#731)', async () => {
  phone = true;
  field.getBoundingClientRect = () => new DOMRect(179, 140, 130, 33);
  assert.equal(await show(field), 'top', 'a field near the top: its keyboard hides the bottom');
  assert.equal(await show(select), 'top', 'a select opens its picker over the bottom too');
  field.getBoundingClientRect = () => new DOMRect(179, 720, 130, 33);
  assert.equal(await show(field), 'top', 'a field under the strip still moves it up');
});

test('on a phone a focused button or tick, or no focus, leaves the toast at the bottom (#731)', async () => {
  phone = true;
  assert.equal(await show(button), undefined, 'no keyboard opens for a button');
  assert.equal(await show(tick), undefined, 'nor for a checkbox');
  assert.equal(await show(null), undefined, 'nothing focused');
  button.getBoundingClientRect = () => new DOMRect(16, 720, 100, 33);
  assert.equal(await show(button), 'top', 'a button under the strip still moves it up');
  button.getBoundingClientRect = () => new DOMRect(16, 300, 100, 33);
});

test('on a wide screen a focused field clear of the strip leaves it at the bottom (#731)', async () => {
  phone = false;
  field.getBoundingClientRect = () => new DOMRect(179, 140, 130, 33);
  assert.equal(await show(field), undefined);
  assert.equal(await show(select), undefined);
});

test('on a touch screen wider than a phone a focused form field puts the toast at the top (#803)', async () => {
  // A phone held sideways (852 px) or a tablet: past the 720px breakpoint, but with a keyboard.
  phone = false;
  touch = true;
  try {
    field.getBoundingClientRect = () => new DOMRect(179, 140, 130, 33);
    assert.equal(await show(field), 'top', 'a field near the top: its keyboard hides the bottom');
    assert.equal(await show(select), 'top', 'a select opens its picker over the bottom too');
    assert.equal(await show(button), undefined, 'no keyboard opens for a button');
    assert.equal(await show(tick), undefined, 'nor for a checkbox');
    assert.equal(await show(null), undefined, 'nothing focused');
  } finally {
    touch = false;
  }
  assert.equal(await show(field), undefined, 'with a mouse the same field leaves it at the bottom');
});
