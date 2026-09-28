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
import { generated, open as openProfile } from './setup.ts';
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
      // The handbook profile has no calculated plan, so Logistics says what it needs (SP-09).
      ['#logistics', '⇄Logisticsneeds a calculated plan'],
      ['#storage', '▦Storage room'],
      ['#resources', '↗Power & resources'],
      ['#notes', '✎Notes'],
      ['#backup', '⇅Backup'],
    ],
  );
  // Each glyph is shown now (SP-10), and stays out of the link's name.
  const icons = [...document.querySelectorAll('.nav a .navicon')];
  assert.equal(icons.length, 7, 'every page has a glyph, Notes included');
  for (const i of icons) assert.equal(i.getAttribute('aria-hidden'), 'true');
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

// SP-09 (#244): the Logistics link is dimmed, with the reason as a visible second line that is
// its description, while there is nothing to show there; it stays a link either way.
test('Logistics is dimmed with its reason until there is something to show (SP-09)', async () => {
  const link = () => $<HTMLAnchorElement>('.nav a[href="#logistics"]')!;
  const reason = () => {
    const id = link().getAttribute('aria-describedby');
    return id ? document.getElementById(id)!.textContent : null;
  };
  // The handbook profile: no calculated plan.
  render();
  assert.ok(link().classList.contains('dim'));
  assert.equal(reason(), 'needs a calculated plan');
  assert.equal(link().querySelector('.nav-needs')!.getAttribute('aria-hidden'), 'true');
  // A calculated profile without groups.
  openProfile({ calculated: generated(), name: 'Plan' });
  render();
  await nextTick();
  assert.ok(link().classList.contains('dim'));
  assert.equal(reason(), 'needs factory groups');
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
