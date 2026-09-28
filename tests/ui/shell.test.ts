// The Vue page frame (public/app/ui/Shell.vue and AdaPanel.vue), mounted the way the app
// mounts it: render() on a page with #app, in happy-dom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, setAdaIndex, setAdaMuted } from '../../public/app/ada-panel.ts';
import { setContext, setView, setWorkspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { showSignedOut, unmountShell } from '../../public/app/ui/mount.ts';
import type {
  Handbook,
  Phase,
  ProgressState,
  TaskEdits,
  WorkspaceSummary,
} from '../../public/types/index.ts';

// Vitest runs from the repository root.
const handbook: Handbook = JSON.parse(fs.readFileSync('public/plan.json', 'utf8'));
const evil = '<x-evil onclick=alert(1)> & "quoted"';
const $ = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s);

function open({ name = evil, phase = '3' }: { name?: string; phase?: Phase } = {}) {
  // Partial fixtures: only the fields the frame reads.
  setWorkspace({
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: {},
    saves: [{ id: 's', name, profiles: [{ id: 'original', kind: 'original', name }] }],
  } as WorkspaceSummary);
  const state: Partial<ProgressState> = {
    settings: { phase },
    checks: {},
    notes: {},
    deliveries: {},
    customTasks: [],
  };
  setContext({
    save: { id: 's', name },
    profile: { id: 'original', kind: 'original', name },
    state: state as ProgressState,
    plan: null,
    handbook,
  });
}

beforeEach(() => {
  unmountShell();
  document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
  setAdaMuted(false);
  setAdaIndex(0);
  adaClearFault();
  setView('plan');
  open();
});

test('the frame shows the open save and profile, escaped, around the page', () => {
  render();
  assert.equal($('.breadcrumbs a')!.textContent, evil);
  assert.ok($('.breadcrumbs')!.innerHTML.includes('&lt;x-evil'), 'the save name is escaped');
  // (Not innerHTML: an attribute such as the switcher group's aria-label is serialised with its
  // < as it is.)
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  // The footer is the profile switcher (SP-07): its button names the profile.
  assert.ok(
    $('.sidebar-foot .profile-switcher')!.textContent.startsWith(evil),
    'the footer names the profile',
  );
  assert.equal($('.sidebar-foot .profile-switcher')!.querySelectorAll('br').length, 3);
  // The page itself is drawn into the frame's <main>.
  assert.ok($('#main .heading-row'), 'the plan page is drawn into <main>');
});

test('the navigation lists Notes between Power & resources and Backup (#243)', () => {
  render();
  assert.deepEqual(
    [...document.querySelectorAll('.nav a')].map(a => [a.getAttribute('href'), a.textContent]),
    [
      ['#plan', '◫Build plan'],
      ['#factories', '▥Factories'],
      ['#logistics', '⇄Logistics'],
      ['#storage', '▦Storage room'],
      ['#resources', '↗Power & resources'],
      ['#notes', '✎Notes'],
      ['#backup', '⇅Backup'],
    ],
  );
});

test('navigation marks the current page', async () => {
  render();
  assert.equal($('.nav a.active')!.getAttribute('href'), '#plan');
  assert.equal($('.nav a.active')!.getAttribute('aria-current'), 'page');
  assert.equal($('.nav a[href="#storage"]')!.getAttribute('aria-current'), null);
  setView('storage');
  render();
  await nextTick();
  assert.equal($('.nav a.active')!.getAttribute('href'), '#storage');
});

test('the phase picker offers the profile’s phases and shows the working one', () => {
  open({ phase: '4' });
  render();
  const picker = $<HTMLSelectElement>('#phase-picker')!;
  assert.equal(picker.value, '4');
  assert.deepEqual(
    [...picker.options].map(o => o.textContent),
    ['Phase 3', 'Phase 4', 'Phase 5', 'Post Phase 5'],
  );
  assert.equal(picker.disabled, false);
});

test('the top bar carries a short save status for phone widths, announced politely', () => {
  render();
  const short = $('.topbar .save-status #saved-short')!;
  assert.equal(short.textContent, 'Saved');
  assert.equal(short.getAttribute('role'), 'status');
  assert.equal(short.getAttribute('aria-live'), 'polite');
  // The sidebar's full status is announced the same way; only one is shown at a time.
  assert.equal($('.sidebar .save-status #saved')!.getAttribute('aria-live'), 'polite');
  for (const dot of document.querySelectorAll('.save-status .dot'))
    assert.equal(dot.getAttribute('aria-hidden'), 'true', 'the dot is decorative');
  // The widest label sits hidden in the same cell, so the width never changes.
  const sizer = $('.topbar .save-label [aria-hidden="true"]')!;
  assert.equal(sizer.textContent, 'Saving…');
  assert.equal($('.topbar-tools #phase-picker')!.id, 'phase-picker');
});

test('ADA speaks, cycles, mutes and unmutes', async () => {
  render();
  assert.match($('.ada')!.textContent, /Artificial Directory and Assistant/);
  assert.equal($('.ada')!.dataset.tone, 'calm');
  const first = $('#ada-line')!.textContent;
  $('[data-ada-next]')!.click();
  await nextTick();
  assert.notEqual($('#ada-line')!.textContent, first, 'Another remark shows the next line');
  $('[data-ada-mute="on"]')!.click();
  await nextTick();
  assert.match($('.ada')!.textContent, /ADA muted/);
  assert.equal($('[data-ada-next]'), null, 'a muted assistant says nothing');
  $('[data-ada-mute="off"]')!.click();
  await nextTick();
  assert.ok($('[data-ada-next]'));
});

test('ADA repeats a renamed step escaped', async () => {
  open();
  render();
  setAdaIndex(0);
  const plan = handbook.phases['3']!;
  const state: Partial<ProgressState> = {
    settings: { phase: '3' },
    checks: {},
    notes: {},
    deliveries: {},
    customTasks: [],
    taskEdits: { titles: { [plan[0]!.id]: 'Weld the <boat>' } } as TaskEdits,
  };
  setContext({
    save: { id: 's', name: 'World' },
    profile: { id: 'original', kind: 'original', name: 'Original' },
    state: state as ProgressState,
    plan: null,
    handbook,
  });
  render();
  await nextTick();
  assert.match($('#ada-line')!.textContent, /Weld the <boat>/);
  assert.ok($('#ada-line')!.innerHTML.includes('Weld the &lt;boat&gt;'));
});

test('five pokes at the badge stage a transmission fault; the next remark ends it', async () => {
  render();
  for (let i = 0; i < 5; i++) $('.ada-mark')!.click();
  await nextTick();
  assert.equal($('.ada')!.dataset.tone, 'fault');
  assert.equal($('.ada b')!.textContent, '???');
  assert.match($('.ada')!.textContent, /Transmission fault/);
  $('[data-ada-next]')!.click();
  await nextTick();
  assert.notEqual($('.ada')!.dataset.tone, 'fault');
});

test('the sign-in screen replaces the frame, and the next render brings it back', async () => {
  render();
  setWorkspace({ user: null, registration: false } as WorkspaceSummary);
  showSignedOut($('#app')!);
  assert.equal($('.layout'), null);
  assert.ok($('#auth-form'), 'the sign-in form is shown');
  open();
  render();
  assert.ok($('.layout'), 'the frame is mounted again');
  assert.ok($('#main .heading-row'));
});

// SP-37 (#272): at phone width the sidebar is a drawer behind ☰. The drawer's visibility is
// CSS (the max-width: 720px block), so happy-dom draws it at any width; these check what the
// frame does with it: aria-expanded, a modal dialog that keeps Tab inside, Esc and × close it and
// return focus to ☰, a followed link closes it, and the open page is marked.
const key = (k: string, shift = false) =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }),
  );
const drawerLinks = () => [
  ...document.querySelectorAll<HTMLElement>(
    '#sidebar a[href], #sidebar button:not([disabled]), #sidebar select, #sidebar input',
  ),
];

test('☰ opens the navigation drawer as a modal dialog, with its state on the button (SP-37)', async () => {
  render();
  const toggle = $<HTMLButtonElement>('[data-menu-toggle]')!;
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'sidebar');
  assert.equal(toggle.getAttribute('aria-label'), 'Menu');
  assert.equal($('#sidebar')!.getAttribute('role'), null, 'a plain sidebar while closed');
  toggle.click();
  await nextTick();
  await nextTick();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const drawer = $('#sidebar')!;
  assert.equal(drawer.getAttribute('role'), 'dialog');
  assert.equal(drawer.getAttribute('aria-modal'), 'true');
  assert.ok($('.layout.menu-open'));
  assert.ok($('.drawer-backdrop'));
  assert.equal(document.activeElement, $('[data-menu-close]'), 'focus moves into the drawer');
  // The active page is marked in it; the profile switcher is in it too.
  assert.equal($('#sidebar .nav a[aria-current="page"]')!.getAttribute('href'), '#plan');
  assert.ok($('#sidebar [data-profile-switcher]'));
});

test('the drawer keeps Tab inside it, and Esc or × closes it back to ☰ (SP-37)', async () => {
  render();
  const toggle = $<HTMLButtonElement>('[data-menu-toggle]')!;
  toggle.click();
  await nextTick();
  await nextTick();
  const all = drawerLinks();
  // Shift+Tab on the first wraps to the last, Tab on the last to the first.
  all[0]!.focus();
  key('Tab', true);
  assert.equal(document.activeElement, all.at(-1), 'Shift+Tab wraps to the end');
  key('Tab');
  assert.equal(document.activeElement, all[0], 'Tab wraps to the start');
  key('Escape');
  await nextTick();
  await nextTick();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal($('.layout.menu-open'), null);
  assert.equal(document.activeElement, toggle, 'Esc returns focus to ☰');
  toggle.click();
  await nextTick();
  await nextTick();
  $<HTMLButtonElement>('[data-menu-close]')!.click();
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, toggle, '× returns focus to ☰');
  toggle.click();
  await nextTick();
  $<HTMLElement>('.drawer-backdrop')!.click();
  await nextTick();
  assert.equal($('.layout.menu-open'), null, 'the backdrop closes it');
});

test('a link followed from the drawer closes it (SP-37)', async () => {
  location.hash = 'plan';
  render();
  const toggle = $<HTMLButtonElement>('[data-menu-toggle]')!;
  toggle.click();
  await nextTick();
  await nextTick();
  const storage = $<HTMLAnchorElement>('#sidebar .nav a[href="#storage"]')!;
  storage.focus();
  storage.click();
  await nextTick();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.notEqual(document.activeElement, storage, 'the hidden link lets go of focus');
  // The page already shown opens nothing, so focus goes back to ☰.
  location.hash = 'plan';
  toggle.click();
  await nextTick();
  await nextTick();
  $<HTMLAnchorElement>('#sidebar .nav a[href="#plan"]')!.click();
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, toggle);
});
