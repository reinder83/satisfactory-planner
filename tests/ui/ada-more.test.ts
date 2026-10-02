// ADA's remark is cut to a few lines beside the phone drawer, so the sidebar fits a laptop
// screen without scrolling (#738). More shows the whole remark and Less cuts it again; it is
// only offered when the cut hides something (AdaPanel.vue), which happy-dom cannot lay out, so
// these tests give the line a height.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { adaClearFault, setAdaIndex, setAdaMuted } from '../../public/app/ada-panel.ts';
import { setContext, setView, setWorkspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { $, handbook } from './setup.ts';
import type { ProgressState, WorkspaceSummary } from '../../public/types/index.ts';

// How tall #ada-line's text is against its box: cut when the text is taller.
let textHeight = 0;
let boxHeight = 0;
const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

// A new remark is measured after it is drawn, and More follows in the render after that.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function open() {
  // Partial fixtures: only the fields the frame reads.
  setWorkspace({
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: {},
    saves: [{ id: 's', name: 'Save', profiles: [{ id: 'original', kind: 'original', name: 'P' }] }],
  } as WorkspaceSummary);
  const state: Partial<ProgressState> = {
    settings: { phase: '3' },
    checks: {},
    notes: {},
    deliveries: {},
    customTasks: [],
  };
  setContext({
    save: { id: 's', name: 'Save' },
    profile: { id: 'original', kind: 'original', name: 'P' },
    state: state as ProgressState,
    plan: null,
    handbook,
  });
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this.id === 'ada-line' ? textHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return this.id === 'ada-line' ? boxHeight : 0;
    },
  });
  unmountShell();
  document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
  setAdaMuted(false);
  setAdaIndex(0);
  adaClearFault();
  setView('plan');
  open();
});

afterEach(() => {
  if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight);
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
});

test('a remark that fits offers no More', async () => {
  textHeight = boxHeight = 58;
  render();
  await nextTick();
  assert.equal($('[data-ada-more]'), null);
  assert.ok($('[data-ada-next]'), 'Another remark is still there');
});

test('a cut remark offers More, which shows all of it and keeps focus (#738)', async () => {
  textHeight = 173;
  boxHeight = 77;
  render();
  await nextTick();
  const more = $('[data-ada-more]')!;
  assert.equal(more.tagName, 'BUTTON');
  assert.equal(more.getAttribute('type'), 'button');
  assert.equal(more.textContent!.trim(), 'More');
  assert.equal(more.getAttribute('aria-controls'), 'ada-line');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.ok($('.ada-tools')!.contains(more), 'beside Another remark and Mute');
  // The whole remark is always in the live region; the cut is only drawn.
  const line = $('#ada-line')!;
  assert.equal(line.getAttribute('aria-live'), 'polite');
  assert.ok(!line.classList.contains('is-full'));
  more.focus();
  more.click();
  await nextTick();
  assert.equal($('[data-ada-more]'), more, 'the same button, so focus stays on it');
  assert.equal(document.activeElement, more);
  assert.equal(more.textContent!.trim(), 'Less');
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.ok(line.classList.contains('is-full'));
  // Less cuts it again, still on the same button.
  more.click();
  await nextTick();
  assert.equal($('[data-ada-more]'), more);
  assert.equal(document.activeElement, more);
  assert.equal(more.textContent!.trim(), 'More');
  assert.ok(!line.classList.contains('is-full'));
});

test('another remark starts cut, and mute and unmute still work around More', async () => {
  textHeight = 173;
  boxHeight = 77;
  render();
  await nextTick();
  $('[data-ada-more]')!.click();
  await nextTick();
  assert.ok($('#ada-line')!.classList.contains('is-full'));
  const first = $('#ada-line')!.textContent;
  $('[data-ada-next]')!.click();
  await settle();
  assert.notEqual($('#ada-line')!.textContent, first, 'Another remark shows the next line');
  assert.ok(!$('#ada-line')!.classList.contains('is-full'), 'the new remark is cut');
  assert.equal($('[data-ada-more]')!.textContent!.trim(), 'More');
  $('[data-ada-mute="on"]')!.click();
  await nextTick();
  assert.equal($('[data-ada-more]'), null, 'a muted assistant offers nothing');
  $('[data-ada-mute="off"]')!.click();
  await settle();
  assert.equal($('[data-ada-more]')!.getAttribute('aria-expanded'), 'false');
  // A remark that fits takes More away.
  textHeight = 58;
  boxHeight = 58;
  $('[data-ada-next]')!.click();
  await settle();
  assert.equal($('[data-ada-more]'), null);
});

test('the cut is drawn beside the phone drawer only (style.css, #738)', () => {
  const css = fs.readFileSync('public/style.css', 'utf8').replace(/\r/g, '');
  const wide = css.indexOf('\n@media (min-width: 721px) {\n  .ada-line {');
  assert.ok(wide > 0, 'the clamp sits in a min-width: 721px block');
  const block = css.slice(wide, css.indexOf('\n}\n', wide));
  assert.match(block, /line-clamp: 4/);
  assert.match(block, /\.ada-line\.is-full \{[^}]*line-clamp: none/);
  // The phone drawer's own ADA rules never clamp.
  const phone = css.slice(css.indexOf('@media (max-width: 720px) {\n  .layout {'));
  assert.doesNotMatch(phone.slice(0, phone.indexOf('\n}\n')), /line-clamp/);
});
