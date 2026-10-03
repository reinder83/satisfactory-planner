// Beside the phone layout ADA is a one-line ticker in the top bar, so a long remark never grows
// the sidebar and makes it scroll (#738). At phone width she stays in the menu drawer (SP-38).
// Shell.vue picks the place from matchMedia('(min-width: 721px)'), stubbed here.
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

// A matchMedia whose (min-width: 721px) answer the test sets, and can change as a resize would.
let wide = true;
let listeners: ((event: MediaQueryListEvent) => void)[] = [];
const realMatchMedia = globalThis.matchMedia;
function stubMatchMedia() {
  // A partial MediaQueryList: Shell.vue reads `matches` and listens for `change`.
  globalThis.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return wide;
      },
      addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
        listeners.push(listener);
      },
      removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
        listeners = listeners.filter(l => l !== listener);
      },
    }) as MediaQueryList;
}
function resize(toWide: boolean) {
  wide = toWide;
  // A partial event: Shell.vue reads only `matches`.
  for (const listener of listeners) listener({ matches: toWide } as MediaQueryListEvent);
}

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
  wide = true;
  listeners = [];
  stubMatchMedia();
  unmountShell();
  document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
  setAdaMuted(false);
  setAdaIndex(0);
  adaClearFault();
  setView('plan');
  open();
});

afterEach(() => {
  unmountShell();
  globalThis.matchMedia = realMatchMedia;
});

test('beside the phone layout ADA is a ticker in the top bar, not in the sidebar (#738)', async () => {
  render();
  await nextTick();
  const ada = $('.ada')!;
  assert.ok($('.topbar')!.contains(ada), 'ADA is in the top bar');
  assert.equal($('#sidebar .ada'), null, 'the sidebar has no ADA panel');
  assert.equal($('#sidebar #ada-line'), null, 'the sidebar has no remark');
  const remark = $('#ada-line')!.textContent!.trim();
  assert.ok(remark.length > 0);
  assert.ok(!$('#sidebar')!.textContent!.includes(remark), 'the remark text is not in the sidebar');
  // Between the save name and the phase picker.
  assert.equal(ada.previousElementSibling, $('.topbar .breadcrumbs'));
  assert.equal(ada.nextElementSibling, $('.topbar .topbar-tools'));
  // One line: the ticker shows the remark, folded.
  const ticker = $('[data-ada-ticker]')!;
  assert.equal(ticker.querySelector('.ada-ticker-text')!.textContent, $('#ada-line')!.textContent);
  assert.equal(ticker.getAttribute('aria-expanded'), 'false');
  assert.ok(!ada.classList.contains('is-open'));
  // Screen readers: the remark is still a polite live region, once in the page.
  assert.equal(document.querySelectorAll('#ada-line').length, 1);
  assert.equal($('#ada-line')!.getAttribute('role'), 'status');
  assert.equal($('#ada-line')!.getAttribute('aria-live'), 'polite');
});

test('the whole remark is one keyboard press away, and the tools work there (#738)', async () => {
  render();
  await nextTick();
  const ticker = $<HTMLButtonElement>('[data-ada-ticker]')!;
  // A real button in the tab order, which Enter and Space press.
  assert.equal(ticker.tagName, 'BUTTON');
  assert.equal(ticker.getAttribute('type'), 'button');
  assert.equal(ticker.getAttribute('tabindex'), null);
  assert.equal(ticker.getAttribute('aria-controls'), 'ada-body');
  ticker.focus();
  ticker.click();
  await nextTick();
  assert.equal(document.activeElement, ticker, 'focus stays on the ticker');
  assert.equal(ticker.getAttribute('aria-expanded'), 'true');
  assert.ok($('.ada')!.classList.contains('is-open'), 'the full remark is unfolded');
  assert.ok($('#ada-body')!.contains($('#ada-line')));
  assert.ok($('#ada-body')!.contains($('.ada-tools')), 'Another remark and Mute are in it');
  assert.equal(ticker.querySelector('.ada-ticker-text')!.textContent, 'ADA', 'her name');
  assert.match($('#ada-body')!.textContent!, /Artificial Directory and Assistant/);
  // Another remark.
  const first = $('#ada-line')!.textContent;
  $('[data-ada-next]')!.click();
  await nextTick();
  assert.notEqual($('#ada-line')!.textContent, first, 'Another remark shows the next line');
  // Mute: nothing said, Unmute in the top bar, and focus on it.
  $<HTMLButtonElement>('[data-ada-mute="on"]')!.focus();
  $('[data-ada-mute="on"]')!.click();
  await nextTick();
  await nextTick();
  assert.equal($('#ada-line'), null, 'a muted assistant says nothing');
  assert.equal($('[data-ada-ticker]'), null);
  assert.ok($('.topbar')!.contains($('.ada.is-muted')));
  assert.equal(document.activeElement, $('[data-ada-mute="off"]'));
  // Unmute unfolds her, so the Mute that takes focus is on screen.
  $('[data-ada-mute="off"]')!.click();
  await nextTick();
  await nextTick();
  assert.equal($('[data-ada-ticker]')!.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, $('[data-ada-mute="on"]'));
  // Folded again with the same button.
  $<HTMLButtonElement>('[data-ada-ticker]')!.click();
  await nextTick();
  assert.equal($('[data-ada-ticker]')!.getAttribute('aria-expanded'), 'false');
});

test('in the top bar the ticker’s ◈ takes the five pokes without folding (#738)', async () => {
  render();
  await nextTick();
  const mark = $('[data-ada-ticker] .ada-mark')!;
  assert.equal(mark.getAttribute('aria-hidden'), 'true', 'decoration, not a control');
  for (let i = 0; i < 5; i++) mark.click();
  await nextTick();
  assert.equal($('.ada')!.dataset.tone, 'fault');
  assert.equal($('[data-ada-ticker]')!.getAttribute('aria-expanded'), 'false', 'still folded');
  $<HTMLButtonElement>('[data-ada-ticker]')!.click();
  await nextTick();
  assert.equal($('.ada-ticker-text')!.textContent, '???');
  assert.match($('#ada-body')!.textContent!, /Transmission fault/);
  $('[data-ada-next]')!.click();
  await nextTick();
  assert.notEqual($('.ada')!.dataset.tone, 'fault');
});

test('at phone width ADA stays in the drawer, and a resize moves her (SP-38, #738)', async () => {
  wide = false;
  render();
  await nextTick();
  assert.ok($('#sidebar')!.contains($('.ada')), 'in the drawer');
  assert.equal($('.topbar .ada'), null);
  // The drawer's ticker has no easter egg: its ◈ unfolds the panel like the rest of it.
  $('[data-ada-ticker] .ada-mark')!.click();
  await nextTick();
  assert.equal($('[data-ada-ticker]')!.getAttribute('aria-expanded'), 'true');
  assert.notEqual($('.ada')!.dataset.tone, 'fault');
  resize(true);
  await nextTick();
  assert.ok($('.topbar')!.contains($('.ada')), 'widened: in the top bar');
  assert.equal($('#sidebar .ada'), null);
  assert.equal(document.querySelectorAll('#ada-line').length, 1, 'one live region');
  resize(false);
  await nextTick();
  assert.ok($('#sidebar')!.contains($('.ada')), 'narrowed: back in the drawer');
  assert.equal(document.querySelectorAll('#ada-line').length, 1);
});

test('the ticker is drawn the same in both places, never cut to lines (style.css, #738)', () => {
  const css = fs.readFileSync('public/style.css', 'utf8').replace(/\r/g, '');
  // Top-level rules are not indented; those in a media query are.
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    assert.ok(start > 0, `${selector} as a top-level rule`);
    return css.slice(start, css.indexOf('}', start));
  };
  assert.match(rule('.ada-ticker'), /display: flex/);
  assert.match(rule('.ada-ticker-text'), /text-overflow: ellipsis/);
  // Folded, out of sight but rendered: display: none or visibility: hidden would silence it.
  const folded = rule('.ada:not(.is-open) .ada-line');
  assert.match(folded, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(folded, /display: none|visibility: hidden/);
  // Folded, her role line and tools are hidden; only the ticker line shows.
  assert.match(
    css,
    /\n\.ada:not\(\.is-open\) \.ada-head,\n\.ada:not\(\.is-open\) \.ada-tools \{\n  display: none;/,
  );
  // In the top bar it takes the room between the name and the phase picker, and its own row
  // when unfolded.
  assert.match(rule('.topbar .ada'), /min-width: 0/);
  assert.match(rule('.topbar .ada.is-open'), /flex-basis: 100%/);
  // No More/Less cut and no short-window clamp any more.
  assert.doesNotMatch(css, /line-clamp/);
});
