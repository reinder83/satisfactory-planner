// The "?" help popover (X-3, #1333, ui/HelpPopover.vue): the long explanation behind a button, in
// the glossary's popup (ui/tip-popup.ts). It opens with its text, Escape and a tap elsewhere close
// it, focus stays on the "?", the button is named "Help: <topic>", and the two pages that used a
// paragraph for it (the Build sequence intro, the saves and profiles help) no longer show it
// inline.
import assert from 'node:assert/strict';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import HelpPopover from '../../public/app/ui/HelpPopover.vue';
import { helpText } from '../../public/preferences.ts';
import { $, $$, generated, go, open, page } from './setup.ts';

beforeEach(() => page());
// A help left mounted would still hear the next test's taps.
const mounted: VueWrapper[] = [];
afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()));

function help(name = 'buildIntro', topic = 'the build sequence') {
  const host = document.createElement('div');
  document.body.append(host);
  const wrapper = mount(HelpPopover, { props: { name, topic }, attachTo: host });
  mounted.push(wrapper);
  const button = document.querySelector<HTMLButtonElement>('[data-help]')!;
  const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]');
  return { wrapper, button, tip };
}

const tap = (target: Element) =>
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));

test('the "?" is a button named "Help: <topic>", and the text is not in the page until it opens', async () => {
  const { button, tip } = help();
  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('aria-label'), 'Help: the build sequence');
  assert.equal(button.textContent!.trim(), '?');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(tip(), null);
  button.click();
  await nextTick();
  assert.equal(tip()!.textContent, helpText.buildIntro, 'the whole text, nothing cut');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-describedby'), tip()!.id, 'a screen reader gets the text');
  assert.ok(tip()!.classList.contains('term-tip'), 'the glossary popup, with its look');
});

test('Escape closes it and focus stays on the "?"; a tap elsewhere closes it too', async () => {
  const { button, tip } = help();
  button.focus();
  await nextTick();
  assert.ok(tip(), 'keyboard focus opens it');
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  assert.equal(tip(), null);
  assert.equal(document.activeElement, button, 'focus is still on the "?"');
  button.click();
  await nextTick();
  assert.ok(tip());
  tap(document.body);
  await nextTick();
  assert.equal(tip(), null, 'outside click closes it');
  // A tap on the popup's own text keeps it open.
  button.click();
  await nextTick();
  tap(tip()!);
  await nextTick();
  assert.ok(tip());
});

test('a name without a help text draws nothing', () => {
  help('noSuchHelp', 'nothing');
  assert.equal(document.querySelector('[data-help]'), null);
});

test('the Build sequence intro is a "?" beside the heading, not a paragraph', async () => {
  open({ calculated: generated(), phase: '3' });
  go('plan');
  render();
  await nextTick();
  const button = $<HTMLButtonElement>('#main .section-head [data-help=buildIntro]')!;
  assert.equal(button.getAttribute('aria-label'), 'Help: the build sequence');
  assert.ok(!$$('#main p').some(p => p.textContent!.includes('Start with construction stock')));
  button.click();
  await nextTick();
  assert.match(
    document.querySelector('[role=tooltip]')!.textContent!,
    /^Start with construction stock/,
  );
});

test('the saves and profiles help is a "?" beside the actions, not a paragraph at the end', async () => {
  go('profiles');
  render();
  await nextTick();
  const button = $<HTMLButtonElement>('#main [data-help=profilesHelp]')!;
  assert.equal(button.getAttribute('aria-label'), 'Help: saves and profiles');
  assert.ok(!$$('#main p').some(p => p.textContent!.includes('Edit settings recalculates')));
  button.click();
  await nextTick();
  const text = document.querySelector('[role=tooltip]')!.textContent!;
  assert.match(text, /Restore this version/);
  assert.match(text, /frozen calculation/);
});
