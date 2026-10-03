// The Vue page frame (public/app/ui/Shell.vue and AdaPanel.vue), mounted the way the app
// mounts it: render() on a page with #app, in happy-dom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, setAdaIndex, setAdaMuted } from '../../public/app/ada-panel.ts';
import { phase, setView, setWorkspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { showSignedOut, unmountShell } from '../../public/app/ui/mount.ts';
import { $$, applyUpdate, generated, handbook, open as openProfile, stubFetch } from './setup.ts';
import type { TaskEdits, WorkspaceSummary } from '../../public/types/index.ts';

const evil = '<x-evil onclick=alert(1)> & "quoted"';
const $ = <E extends Element = HTMLElement>(selector: string) =>
  document.querySelector<E>(selector);

beforeEach(() => {
  unmountShell();
  document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
  setAdaMuted(false);
  setAdaIndex(0);
  adaClearFault();
  setView('plan');
  // A profile migrated from the handbook (#387), whose build plan has a page to draw.
  openProfile();
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

test('the Docker edition shows no backup age: its saves are on the server (SP-40)', () => {
  render();
  assert.equal($('[data-backup-age]'), null);
});

test('the navigation lists Notes between Power & resources and Backup (#243)', () => {
  render();
  assert.deepEqual(
    [...document.querySelectorAll('.nav a')].map(a => [a.getAttribute('href'), a.textContent]),
    [
      ['#plan', '◫Build plan'],
      ['#factories', '▥Factories'],
      // The profile has no factory groups yet, so Logistics says what it needs (SP-09).
      ['#logistics', '⇄Logisticsneeds factory groups'],
      ['#storage', '▦Storage room'],
      ['#resources', '↗Power & resources'],
      ['#notes', '✎Notes'],
      ['#backup', '⇅Backup'],
    ],
  );
  // Each glyph is shown now (SP-10), and stays out of the link's name.
  const icons = [...document.querySelectorAll('.nav a .navicon')];
  assert.equal(icons.length, 7, 'every page has a glyph, Notes included');
  for (const icon of icons) assert.equal(icon.getAttribute('aria-hidden'), 'true');
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
  openProfile({ phase: '4' });
  render();
  const picker = $<HTMLSelectElement>('#phase-picker')!;
  assert.equal(picker.value, '4');
  assert.deepEqual(
    [...picker.options].map(o => o.textContent),
    ['Phase 3', 'Phase 4', 'Phase 5', 'Post Phase 5'],
  );
  assert.equal(picker.disabled, false);
});

// SP-44 (#279): the phase track replaces the breadcrumb's phase and, above 720px, the select:
// radio buttons named "Working phase", one per phase with its checklist's progress, switching
// with the same save and guard. The select stays for phone widths (style.css hides one of them).
test('the phase track shows each phase’s progress and switches phases like the select (SP-44)', async () => {
  const phase4 = handbook.phases['4']!;
  openProfile({ phase: '4', state: { checks: { [phase4[0]!.id]: true } } });
  render();
  const track = $('[data-phase-track]')!;
  assert.equal(track.getAttribute('role'), 'radiogroup');
  assert.equal(track.getAttribute('aria-label'), 'Working phase');
  const radios = () => $$<HTMLInputElement>('[data-phase-track] input[type=radio]');
  assert.deepEqual(
    radios().map(r => [r.value, r.name, r.checked]),
    [
      ['3', 'phase-track', false],
      ['4', 'phase-track', true],
      ['5', 'phase-track', false],
      ['post', 'phase-track', false],
    ],
    'the select’s phases, the working one checked',
  );
  const segment = (phaseId: string) => $(`[data-phase-seg="${phaseId}"]`)!;
  assert.ok(segment('4').classList.contains('current'));
  assert.equal(segment('4').querySelector('.phase-track-name')!.textContent, 'Phase 4');
  const percent = Math.round((1 / phase4.length) * 100);
  assert.equal(
    segment('4').querySelector<HTMLElement>('.phase-track-bar > span')!.style.width,
    percent + '%',
  );
  assert.equal(segment('4').querySelector('.visually-hidden')!.textContent, `, ${percent}% done`);
  assert.equal(
    segment('post').querySelector('.phase-track-bar'),
    null,
    'post-game has no checklist',
  );
  // The breadcrumb names the save only; the phase is the track's (or the select's).
  assert.equal($('.breadcrumbs')!.textContent!.trim(), $('.breadcrumbs a')!.textContent);
  assert.ok($('#phase-picker'), 'the select stays for phone widths');
  // Choosing a segment saves the phase, as the select does, and redraws both.
  const calls = stubFetch<{ type: string; value: string }>({ '/api/update': applyUpdate });
  const pick = async (value: string) => {
    const radio = radios().find(x => x.value === value)!;
    radio.focus();
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  };
  await pick('5');
  assert.deepEqual(calls.at(-1), ['/api/update', { type: 'phase', value: '5' }]);
  assert.equal(phase(), '5');
  assert.equal($<HTMLSelectElement>('#phase-picker')!.value, '5');
  assert.ok(segment('5').classList.contains('current'));
  assert.equal(
    document.activeElement,
    radios().find(x => x.value === '5'),
    'focus stays',
  );
  // A refused save checks the saved phase again.
  stubFetch({});
  await pick('3');
  assert.equal(phase(), '5');
  assert.deepEqual(
    radios()
      .filter(x => x.checked)
      .map(x => x.value),
    ['5'],
  );
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
  // The Docker edition's widest is the empty workspace's (#281).
  assert.equal(sizer.textContent, 'No save yet');
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

test('at phone width ADA is a one-line ticker that unfolds the panel in place (SP-38)', async () => {
  render();
  const ticker = $('[data-ada-ticker]')!;
  assert.equal(ticker.tagName, 'BUTTON');
  assert.equal(ticker.getAttribute('type'), 'button');
  assert.equal(ticker.getAttribute('aria-expanded'), 'false');
  assert.equal(ticker.getAttribute('aria-controls'), 'ada-body');
  assert.ok($('#ada-body')!.contains($('.ada-tools')), 'the tools are in the part it unfolds');
  assert.equal(ticker.querySelector('.ada-mark')!.getAttribute('aria-hidden'), 'true');
  const line = $('#ada-line')!;
  assert.equal(ticker.querySelector('.ada-ticker-text')!.textContent, line.textContent);
  assert.ok(!$('.ada')!.classList.contains('is-open'));
  // Folded, the remark is still the page's live region, so the next one is announced.
  assert.equal(line.getAttribute('aria-live'), 'polite');
  $('[data-ada-next]')!.click();
  await nextTick();
  assert.equal(ticker.querySelector('.ada-ticker-text')!.textContent, $('#ada-line')!.textContent);
  ticker.click();
  await nextTick();
  assert.equal(ticker.getAttribute('aria-expanded'), 'true');
  assert.ok($('.ada')!.classList.contains('is-open'));
  assert.equal(ticker.querySelector('.ada-ticker-text')!.textContent, 'ADA');
  ticker.click();
  await nextTick();
  assert.equal(ticker.getAttribute('aria-expanded'), 'false');
  // Muted is unchanged: one line with Unmute, and no ticker.
  $('[data-ada-mute="on"]')!.click();
  await nextTick();
  assert.equal($('[data-ada-ticker]'), null);
  assert.match($('.ada')!.textContent, /ADA muted/);
  // Unmuting unfolds it, so the Mute that takes focus is on screen.
  $('[data-ada-mute="off"]')!.click();
  await nextTick();
  assert.equal($('[data-ada-ticker]')!.getAttribute('aria-expanded'), 'true');
});

test('the phone ticker keeps the remark announced while folded (style.css, SP-38)', () => {
  const css = fs.readFileSync('public/style.css', 'utf8').replace(/\r/g, '');
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  const rule = (selector: string) => {
    const start = phone.indexOf(`\n  ${selector} {`);
    assert.ok(start > 0, `${selector} at ≤720px`);
    return phone.slice(start, phone.indexOf('}', start));
  };
  assert.match(rule('.ada-ticker'), /display: flex/);
  assert.match(rule('.ada-ticker'), /min-height: 44px/);
  assert.match(rule('.ada-ticker-text'), /text-overflow: ellipsis/);
  // Out of sight but rendered: display: none or visibility: hidden would silence it.
  const folded = rule('.ada:not(.is-open) .ada-line');
  assert.match(folded, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(folded, /display: none|visibility: hidden/);
  // Wider screens never show the ticker.
  assert.match(
    css.slice(0, css.indexOf('@media (max-width: 720px)')),
    /\n\.ada-ticker \{\n  display: none;/,
  );
});

test('ADA repeats a renamed step escaped', async () => {
  render();
  setAdaIndex(0);
  // A profile migrated from the handbook (#387): its guide keeps the handbook's steps.
  const plan = handbook.phases['3']!;
  openProfile({
    state: { taskEdits: { titles: { [plan[0]!.id]: 'Weld the <boat>' } } as TaskEdits },
  });
  render();
  await nextTick();
  assert.match($('#ada-line')!.textContent, /Weld the <boat>/);
  assert.ok($('#ada-line')!.innerHTML.includes('Weld the &lt;boat&gt;'));
});

test('five pokes at the badge stage a transmission fault; the next remark ends it', async () => {
  render();
  for (let i = 0; i < 5; i++) $('.ada-head .ada-mark')!.click();
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
  openProfile();
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

// SP-09 (#244): the Logistics link is dimmed, with the reason as a visible second line that is
// its description, while there is nothing to show there; it stays a link either way.
test('Logistics is dimmed with its reason until there is something to show (SP-09)', async () => {
  const link = () => $<HTMLAnchorElement>('.nav a[href="#logistics"]')!;
  const reason = () => {
    const id = link().getAttribute('aria-describedby');
    return id ? document.getElementById(id)!.textContent : null;
  };
  // A calculated profile without groups.
  openProfile({ calculated: generated(), name: 'Plan' });
  render();
  await nextTick();
  assert.ok(link().classList.contains('dim'));
  assert.equal(reason(), 'needs factory groups');
  assert.equal(link().querySelector('.nav-needs')!.getAttribute('aria-hidden'), 'true');
  // With groups: a normal link, no reason.
  openProfile({
    calculated: generated(),
    name: 'Plan',
    state: { factoryGroups: { groups: [{ id: 'fg-a', name: 'A' }], assignments: {} } },
  });
  render();
  await nextTick();
  assert.ok(!link().classList.contains('dim'));
  assert.equal(link().getAttribute('aria-describedby'), null);
  assert.equal(link().querySelector('.nav-needs'), null);
  // Dimmed, it is still followed, and the page shows its notice.
  openProfile({ calculated: generated(), name: 'Plan' });
  setView('logistics');
  render();
  await nextTick();
  assert.equal(link().getAttribute('aria-current'), 'page');
  assert.ok($('#main [data-logistics-empty="groups"]'), 'the existing notice');
});
