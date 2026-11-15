// The "?" help popover (X-3, #1333, ui/HelpPopover.vue): the long explanation behind a button, in
// the glossary's popup (ui/tip-popup.ts). It opens with its text, Escape and a tap elsewhere close
// it, focus stays on the "?", the button is named "Help: <topic>", and the two pages that used a
// paragraph for it (the Build sequence intro, the saves and profiles help) no longer show it
// inline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import HelpPopover from '../../public/app/ui/HelpPopover.vue';
import { markIntroSeen, resetIntroSeen } from '../../public/app/sessions.ts';
import { helpText } from '../../public/preferences.ts';
import { $, $$, generated, go, open, page } from './setup.ts';

beforeEach(() => {
  page();
  localStorage.clear();
  resetIntroSeen();
});
// A help left mounted would still hear the next test's taps.
const mounted: VueWrapper[] = [];
afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()));

function help(name = 'buildIntro', topic = 'Build sequence') {
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
  assert.equal(button.getAttribute('aria-label'), 'Help: Build sequence');
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

test('the Build sequence intro is a "?" beside the heading, not a paragraph once it was seen', async () => {
  markIntroSeen();
  open({ calculated: generated(), phase: '3' });
  go('plan');
  render();
  await nextTick();
  const button = $<HTMLButtonElement>('#main .section-head [data-help=buildIntro]')!;
  assert.equal(button.getAttribute('aria-label'), 'Help: Build sequence');
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
  assert.equal(button.getAttribute('aria-label'), 'Help: Saves & profiles');
  assert.ok(!$$('#main p').some(p => p.textContent!.includes('Edit settings recalculates')));
  button.click();
  await nextTick();
  const text = document.querySelector('[role=tooltip]')!.textContent!;
  assert.match(text, /Restore this version/);
  assert.match(text, /frozen calculation/);
});

// #1355: a help that fits neither above nor below its button (a long text, the button halfway down
// a phone) is capped to the roomier side and scrolls, so its last line is not below the screen.
// happy-dom has no layout, so the boxes' sizes are stubbed.
function placed(buttonTop: number, tipHeight: number) {
  const { button, tip } = help('flowGraphHelp', 'Flow graph');
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, left: 20, right: 40, width: 20, height }) as DOMRect;
  button.getBoundingClientRect = () => rect(buttonTop, 24);
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: 800,
    configurable: true,
  });
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.matches('[role="tooltip"]') ? rect(0, tipHeight) : original.call(this);
  };
  return {
    show: async () => {
      button.click();
      await nextTick();
      await nextTick();
      return tip()!;
    },
    restore: () => {
      HTMLElement.prototype.getBoundingClientRect = original;
      Reflect.deleteProperty(document.documentElement, 'clientHeight');
    },
  };
}

test('a help too tall for the room below or above is capped to the roomier side', async () => {
  const scene = placed(380, 550);
  try {
    const box = await scene.show();
    const top = parseInt(box.style.top);
    const cap = parseInt(box.style.maxHeight);
    assert.ok(cap > 0 && cap < 550, 'capped, so it scrolls inside itself');
    assert.ok(top >= 8, 'not above the window');
    assert.ok(top + cap <= 800 - 8, 'its bottom edge is inside the window');
  } finally {
    scene.restore();
  }
});

test('a help that fits below the button, or only above it, is not capped', async () => {
  let scene = placed(100, 300);
  try {
    const box = await scene.show();
    assert.equal(box.style.maxHeight, '');
    assert.equal(parseInt(box.style.top), 128, 'below the button');
  } finally {
    scene.restore();
  }
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  scene = placed(700, 300);
  try {
    const box = await scene.show();
    assert.equal(box.style.maxHeight, '');
    assert.equal(parseInt(box.style.top), 700 - 4 - 300, 'above the button');
  } finally {
    scene.restore();
  }
});

test('every help button is named by words a sighted user reads, capitalised like them', () => {
  // A topic written in lower case ("the flow graph") is read out as a different phrase from the
  // heading beside the button; each literal topic starts with a capital.
  const dir = path.join(process.cwd(), 'public/app/ui');
  const sources = fs
    .readdirSync(dir, { recursive: true })
    .filter(file => String(file).endsWith('.vue'))
    .map(file => fs.readFileSync(path.join(dir, String(file)), 'utf8'));
  const topics = sources.flatMap(source => [...source.matchAll(/(?<![:\w])topic="([^"]+)"/g)]);
  assert.ok(topics.length > 20, 'the scan found the help buttons');
  assert.deepEqual(
    topics.map(match => match[1]!).filter(topic => !/^[A-Z]/.test(topic)),
    [],
  );
});
