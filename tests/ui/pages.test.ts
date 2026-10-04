// The pages that are Vue components (public/app/ui/pages/), mounted through render() the way
// the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, h, nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { pending, save } from '../../public/app/api.ts';
import { boot, currentSave, setContext, state, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { num } from '../../public/app/format.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { invalidate } from '../../public/app/ui/bridge.ts';
import { showSignedOut } from '../../public/app/ui/mount.ts';
import { vuePage } from '../../public/app/ui/pages.ts';
import { phaseProgress } from '../../public/state.ts';
import CalculatedResourcesPage from '../../public/app/ui/pages/CalculatedResourcesPage.vue';
import { resourceUse, tightestFirst } from '../../public/app/views/resources.ts';
import {
  answerConfirms,
  applyUpdate,
  $,
  $$,
  evil,
  generated,
  go,
  migratedPlan,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type {
  Catalog,
  ProfileSummary,
  StoredCalculatedPlan,
  UpdateOp,
  WorkspaceSummary,
} from '../../public/types/index.ts';

// User text inserted as markup would create an <x-evil> element. (innerHTML cannot tell:
// a textarea's contents are serialised unescaped.)
const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');

// A profile migrated from the handbook (#387), which kept its id 'original'.
beforeEach(() => {
  page();
  open({ profileId: 'original' });
});

// #418: the page's tick counts and phases came from the summary loaded at start. Opening it now
// asks for the summary again, after any write still queued, and shows that.
test('Saves & profiles asks for a fresh summary when it opens, after pending writes', async () => {
  let written = false;
  const calls = stubFetch({
    '/api/update': () => ((written = true), { ...state, checks: { a: true } }),
    '/api/workspace': () => ({
      ...workspace,
      saves: workspace.saves.map(saveSummary => ({
        ...saveSummary,
        profiles: saveSummary.profiles.map(profile =>
          profile.id === 'p' ? { ...profile, completed: written ? 6 : 5, phase: '5' } : profile,
        ),
      })),
    }),
  });
  void save({ type: 'check', key: 'a', value: true });
  go('profiles');
  render();
  // Until the reply, the summary it had.
  assert.match($$('.profile-card')[1]!.textContent!, /5 checks complete · Phase 4/);
  await vi.waitFor(() =>
    assert.match($$('.profile-card')[1]!.textContent!, /6 checks complete · Phase 5/),
  );
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/api/update', '/api/workspace'],
    'the summary is asked for once the queued write has landed',
  );
});

// SP-32 (#267): the workspace summary's per-phase counts (both editions use phaseProgress) and
// the segmented bar on a calculated profile's card, with its reading in words.
test('phaseProgress counts each planned phase’s lines ticked Running, from the start phase', () => {
  const plan = generated();
  const from = Number(plan.settings.phase);
  const rows = plan.stages[String(from) as '3'].rows!;
  const checks = { [`calc-${from}-${rows[0]!.id}`]: true, [`calc-${from}-${rows[1]!.id}`]: true };
  const got = phaseProgress(plan, checks)!;
  assert.deepEqual(
    got.map(progress => progress.phase),
    ['1', '2', '3', '4', '5'].filter(phase => Number(phase) >= from),
  );
  assert.deepEqual(got[0], { phase: String(from), done: 2, total: rows.length });
  assert.equal(got[1]!.done, 0);
  assert.equal(phaseProgress(null, checks), undefined, 'none without a calculated plan');
});

test('a calculated profile card shows a segmented phase bar that reads in words (SP-32)', () => {
  const workspace = {
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'original',
        profiles: [
          { id: 'original', kind: 'calculated', name: 'No counts', completed: 2, phase: '3' },
          {
            id: 'p',
            kind: 'calculated',
            name: 'Plan',
            completed: 5,
            phase: '4',
            phases: [
              { phase: '3', done: 10, total: 10 },
              { phase: '4', done: 2, total: 9 },
              { phase: '5', done: 0, total: 12 },
            ],
          },
          {
            id: 'q',
            kind: 'calculated',
            name: 'Late',
            completed: 9,
            phase: 'post',
            phases: [
              { phase: '4', done: 5, total: 5 },
              { phase: '5', done: 3, total: 4 },
            ],
          },
        ],
      },
    ],
  } satisfies Partial<WorkspaceSummary>;
  open({ workspace });
  go('profiles');
  render();
  assert.equal($('[data-phase-bar="original"]'), null, 'no bar without per-phase counts');
  const bar = $('[data-phase-bar="p"]')!;
  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(bar.getAttribute('aria-label'), 'Phase 4 of 5, 22%');
  assert.deepEqual(
    [...bar.querySelectorAll<HTMLElement>('.phase-seg')].map(segment => [
      segment.dataset.phaseSeg,
      segment.classList.contains('done')
        ? 'done'
        : segment.classList.contains('current')
          ? 'current'
          : 'later',
      (segment.firstElementChild as HTMLElement).style.width,
    ]),
    [
      ['3', 'done', '100%'],
      ['4', 'current', '22%'],
      ['5', 'later', '0%'],
    ],
  );
  // Post Phase 5 works on Phase 5's lines.
  assert.equal($('[data-phase-bar="q"]')!.getAttribute('aria-label'), 'Post Phase 5, 75%');
});

// The issue's reproduction (#667): a Phase 1 profile working on Phase 3 with every Phase 1 line
// ticked opens on Phase 2 (phaseToOpen, #570), so its card must not draw Phase 2 as finished.
test('a profile card fills earlier phases with their real share of ticked lines (#667)', () => {
  const workspace = {
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'p',
        profiles: [
          {
            id: 'p',
            kind: 'calculated',
            name: 'Plan',
            completed: 6,
            phase: '3',
            phases: [
              { phase: '1', done: 6, total: 6 },
              { phase: '2', done: 2, total: 5 },
              { phase: '3', done: 0, total: 8 },
              { phase: '4', done: 0, total: 9 },
              { phase: '5', done: 0, total: 12 },
            ],
          },
        ],
      },
    ],
  } satisfies Partial<WorkspaceSummary>;
  open({ workspace });
  go('profiles');
  render();
  const bar = $('[data-phase-bar="p"]')!;
  assert.equal(bar.getAttribute('aria-label'), 'Phase 3 of 5, 0%; Phase 2 is 40% done');
  assert.deepEqual(
    [...bar.querySelectorAll<HTMLElement>('.phase-seg')].map(segment => [
      segment.dataset.phaseSeg,
      (segment.firstElementChild as HTMLElement).style.width,
    ]),
    [
      ['1', '100%'],
      ['2', '40%'],
      ['3', '0%'],
      ['4', '0%'],
      ['5', '0%'],
    ],
  );
});

// The card fills each phase with its build-plan steps ticked when the summary has them (#746),
// and a phase with an open step never reads 100%: one open step of 200 is 99%, not a rounded
// 100%, both in the label and in the segment.
test('a profile card counts steps, and an unfinished phase reads at most 99% (#746)', () => {
  const workspace = {
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'p',
        profiles: [
          {
            id: 'p',
            kind: 'calculated',
            name: 'Plan',
            completed: 230,
            phase: '3',
            phases: [
              { phase: '1', done: 13, total: 13, steps: { done: 199, total: 200 } },
              { phase: '2', done: 2, total: 5, steps: { done: 20, total: 20 } },
              { phase: '3', done: 1, total: 8, steps: { done: 399, total: 400 } },
              { phase: '4', done: 0, total: 9, steps: { done: 0, total: 30 } },
            ],
          },
        ],
      },
    ],
  } satisfies Partial<WorkspaceSummary>;
  open({ workspace });
  go('profiles');
  render();
  const bar = $('[data-phase-bar="p"]')!;
  assert.equal(bar.getAttribute('aria-label'), 'Phase 3 of 5, 99%; Phase 1 is 99% done');
  assert.deepEqual(
    [...bar.querySelectorAll<HTMLElement>('.phase-seg')].map(segment => [
      segment.dataset.phaseSeg,
      (segment.firstElementChild as HTMLElement).style.width,
    ]),
    [
      ['1', '99%'],
      ['2', '100%'],
      ['3', '99%'],
      ['4', '0%'],
    ],
  );
});

// A profile card counts its ticked checks in words that agree with the number (#421).
test('a profile card says 1 check, N checks, or none yet', () => {
  const card = (id: string, completed: number): ProfileSummary => ({
    id,
    kind: 'calculated',
    name: id,
    completed,
    phase: '2',
  });
  const workspace = {
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'a',
        profiles: [card('a', 0), card('b', 1), card('c', 1234)],
      },
    ],
  } satisfies Partial<WorkspaceSummary>;
  open({ workspace });
  go('profiles');
  render();
  assert.deepEqual(
    $$('.profile-card').map(c => c.querySelector('.small')!.textContent),
    [
      'No checks complete yet · Phase 2',
      '1 check complete · Phase 2',
      `${num(1234)} checks complete · Phase 2`,
    ],
  );
});

test('Saves & profiles lists every profile, escaped, with its actions', () => {
  go('profiles');
  render();
  noMarkup();
  assert.equal($('.save-panel h2')!.textContent, evil);
  const cards = $$('.profile-card');
  assert.equal(cards.length, 2);
  assert.ok(cards[0]!.classList.contains('selected'), 'the open profile is marked');
  for (const card of cards)
    assert.equal(card.querySelector('.eyebrow')!.textContent, 'CALCULATED PROFILE');
  assert.equal(
    cards[0]!.querySelector('p')!.textContent,
    `pure purity · 50× elevator · ${num(0.5)}× power`,
    'the handbook’s assumptions, as its migrated plan’s settings',
  );
  assert.equal(
    cards[1]!.querySelector('p')!.textContent,
    evil + ' purity · 2× elevator · 3× power',
  );
  assert.equal(cards[1]!.querySelector('.small')!.textContent, '5 checks complete · Phase 4');
  assert.match(
    cards[0]!.querySelector('[data-open-save]')!.textContent,
    /Continue current profile/,
  );
  assert.match(cards[1]!.querySelector('[data-open-save]')!.textContent, /Open profile/);
  for (const hook of ['duplicate', 'share', 'remove'])
    assert.equal(
      cards[1]!.querySelector<HTMLElement>(`[data-${hook}-profile]`)!.dataset[hook + 'Profile'],
      'p',
    );
  assert.equal($('.toolbar a')!.textContent, 'Set up user accounts');
  // Every save and profile is renamed in place (SP-31); the old rename panel is gone.
  assert.equal($('#rename-form'), null);
  assert.equal(
    $('button[data-rename-save="s"]')!.getAttribute('aria-label'),
    'Rename save ' + evil,
  );
  assert.deepEqual(
    $$('button[data-rename-profile]').map(b => b.dataset.renameProfile),
    ['original', 'p'],
  );
});

// A key pressed on the focused element, as a browser sends it.
const key = (name: string) =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );
const focusedHook = () =>
  Object.keys((document.activeElement as HTMLElement | null)?.dataset ?? {}).join(',');

test('a profile card shows one action and keeps the others in its ⋯ menu (#238)', async () => {
  go('profiles');
  render();
  const card = $$('.profile-card')[1]!;
  const visible = [...card.querySelectorAll<HTMLElement>('.profile-actions > button')];
  assert.deepEqual(
    visible.map(b => b.textContent!.trim()),
    ['Open profile'],
    'only the primary action is a button of its own',
  );
  const trigger = card.querySelector<HTMLButtonElement>('[data-profile-menu="p"]')!;
  const menu = $('#profile-menu-s-p')!;
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
  assert.equal(trigger.getAttribute('aria-controls'), 'profile-menu-s-p');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-label'), 'More actions for ' + evil);
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(menu.hidden, true, 'the menu starts closed');
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(
    items.map(b => b.textContent!.trim()),
    ['Duplicate', 'Share (without progress)', 'Remove profile…'],
  );
  assert.ok(
    items.every(b => b.tabIndex === -1),
    'the arrow keys move between items, not Tab',
  );
  assert.ok(items[2]!.classList.contains('danger'), 'Remove is last and red');
  assert.ok(!items[0]!.classList.contains('danger') && !items[1]!.classList.contains('danger'));
  noMarkup();

  // Enter or Space on ⋯ is a click: it opens the menu on the first item.
  trigger.focus();
  trigger.click();
  await nextTick();
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(focusedHook(), 'duplicateProfile,duplicateSave');
  key('ArrowDown');
  assert.equal(focusedHook(), 'shareProfile,shareSave');
  key('End');
  assert.equal(focusedHook(), 'removeProfile,removeSave');
  key('ArrowDown');
  assert.equal(focusedHook(), 'duplicateProfile,duplicateSave', 'the arrows wrap');
  key('ArrowUp');
  assert.equal(focusedHook(), 'removeProfile,removeSave');
  key('Home');
  assert.equal(focusedHook(), 'duplicateProfile,duplicateSave');
  // Escape closes it and returns focus to ⋯.
  key('Escape');
  await nextTick();
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  // ArrowDown on ⋯ opens on the first item, ArrowUp on the last.
  key('ArrowDown');
  await nextTick();
  assert.equal(focusedHook(), 'duplicateProfile,duplicateSave');
  key('Escape');
  key('ArrowUp');
  await nextTick();
  assert.equal(focusedHook(), 'removeProfile,removeSave');
  // Tab closes it (and the browser moves on).
  key('Tab');
  await nextTick();
  assert.equal(menu.hidden, true);

  // Only one menu is open at a time, and a click outside closes it.
  trigger.click();
  await nextTick();
  const other = $<HTMLButtonElement>('[data-profile-menu="original"]')!;
  other.click();
  await nextTick();
  assert.equal(menu.hidden, true, 'opening another menu closes this one');
  assert.equal($('#profile-menu-s-original')!.hidden, false);
  $('.save-panel h2')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  assert.equal($('#profile-menu-s-original')!.hidden, true, 'a click outside closes it');
  assert.equal(other.getAttribute('aria-expanded'), 'false');
});

test('Duplicate says "Copying…" on ⋯ while it runs, and ⋯ stays focused and busy', async () => {
  let reply: (response: Response) => void = () => {};
  globalThis.fetch = () => new Promise<Response>(resolve => (reply = resolve));
  go('profiles');
  render();
  const trigger = $<HTMLButtonElement>('[data-profile-menu="p"]')!;
  trigger.focus();
  trigger.click();
  await nextTick();
  $<HTMLButtonElement>('[data-duplicate-profile="p"]')!.click();
  await vi.waitFor(() => assert.equal(trigger.textContent!.trim(), 'Copying…'));
  assert.equal(document.activeElement, trigger, 'the menu closed and gave ⋯ focus');
  assert.equal(trigger.getAttribute('aria-disabled'), 'true');
  assert.equal(trigger.hasAttribute('disabled'), false, 'busy, not disabled (#299)');
  assert.equal(trigger.getAttribute('aria-label'), null, 'its text names it meanwhile');
  assert.equal($('#profile-menu-s-p')!.hidden, true);
  trigger.click();
  await nextTick();
  assert.equal($('#profile-menu-s-p')!.hidden, true, 'a busy ⋯ does not open');
  // The copy fails: ⋯ is ready again, still focused.
  reply(new Response(JSON.stringify({ error: 'No space left' }), { status: 500 }));
  await vi.waitFor(() => assert.equal(trigger.getAttribute('aria-disabled'), null));
  assert.equal(trigger.getAttribute('aria-label'), 'More actions for ' + evil);
  assert.equal(document.activeElement, trigger);
});

// SP-31 (#266): ✎ swaps a name for an input; Enter saves, Esc cancels, and focus goes back to ✎.
// Any save or profile can be renamed, not only the open one: the request names it in its scope
// headers. The open save's new name reaches the breadcrumb and the open profile's the sidebar.
// The open profile's calculated plan gone, as while render() swaps the page after the last save
// was removed and the empty workspace's placeholder opened.
const closePlan = () =>
  setContext({
    save: { id: '', name: 'New save' },
    profile: { id: '', kind: 'calculated', name: 'Choose a profile' },
    state: structuredClone(state),
    plan: null,
  });
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const renameReply = (names: { save?: string; original?: string; p?: string }) => ({
  saves: [
    {
      id: 's',
      name: names.save ?? evil,
      activeProfile: 'original',
      profiles: [
        {
          id: 'original',
          kind: 'calculated',
          name: names.original ?? evil,
          completed: 2,
          phase: '3',
        },
        { id: 'p', kind: 'calculated', name: names.p ?? evil, completed: 5, phase: '4' },
      ],
    },
  ],
});
async function renameInPlace(button: string, name: string, commit: 'Enter' | 'Escape' = 'Enter') {
  $<HTMLButtonElement>(button)!.click();
  await nextTick();
  const input = document.activeElement as HTMLInputElement;
  assert.equal(input.tagName, 'INPUT', 'the input takes focus');
  input.value = name;
  input.dispatchEvent(new Event('input'));
  if (commit === 'Escape')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  else input.form!.requestSubmit();
  await settle();
}

test('renaming the open save in place updates the page and the frame (SP-31)', async () => {
  go('profiles');
  render();
  await settle();
  const calls = stubFetch({
    '/api/rename': (body: { name: string }) => renameReply({ save: body.name }),
  });
  await renameInPlace('button[data-rename-save="s"]', 'Renamed & safe');
  assert.deepEqual(calls[0], ['/api/rename', { target: 'save', name: 'Renamed & safe' }]);
  assert.equal(calls.headers[0]!['X-Save-Id'], 's');
  assert.equal(currentSave.name, 'Renamed & safe');
  assert.equal($('.save-panel h2')!.textContent, 'Renamed & safe');
  assert.equal($('.breadcrumbs a')!.textContent, 'Renamed & safe');
  assert.equal(
    (document.activeElement as HTMLElement).dataset.renameSave,
    's',
    'focus is back on ✎',
  );
});

test('a profile that is not open is renamed in place, scoped to it (SP-31)', async () => {
  go('profiles');
  render();
  await settle();
  const calls = stubFetch({
    '/api/rename': (body: { name: string }) => renameReply({ p: body.name }),
  });
  await renameInPlace('button[data-rename-profile="p"]', '  Second plan  ');
  assert.deepEqual(calls[0], ['/api/rename', { target: 'profile', name: 'Second plan' }]);
  assert.deepEqual(
    [calls.headers[0]!['X-Save-Id'], calls.headers[0]!['X-Profile-Id']],
    ['s', 'p'],
    'the request names the profile, not the open one',
  );
  const titles = $$('.profile-card h3').map(h => h.textContent);
  assert.deepEqual(titles, [evil, 'Second plan']);
  // The open profile keeps its name in the sidebar.
  assert.ok($('[data-profile-switcher]')!.textContent.includes(evil));
});

test('renaming the open profile updates the sidebar footer (SP-31)', async () => {
  go('profiles');
  render();
  await settle();
  stubFetch({
    '/api/rename': (body: { name: string }) => renameReply({ original: body.name }),
  });
  await renameInPlace('button[data-rename-profile="original"]', 'Main plan');
  assert.ok($('[data-profile-switcher]')!.textContent.includes('Main plan'));
});

test('Esc cancels a rename, an unchanged name saves nothing, and a failure keeps the input (SP-31)', async () => {
  go('profiles');
  render();
  await settle();
  const calls = stubFetch({});
  await renameInPlace('button[data-rename-profile="p"]', 'Never saved', 'Escape');
  assert.equal(calls.length, 0, 'Esc sends nothing');
  assert.equal((document.activeElement as HTMLElement).dataset.renameProfile, 'p');
  assert.deepEqual(
    $$('.profile-card h3').map(h => h.textContent),
    [evil, evil],
  );
  await renameInPlace('button[data-rename-profile="p"]', evil);
  assert.equal(calls.length, 0, 'an unchanged name is not sent');
  // The stub refuses anything else: the input stays open with focus, and the toast says why.
  await renameInPlace('button[data-rename-profile="p"]', 'Refused');
  assert.equal(calls.length, 1);
  assert.equal((document.activeElement as HTMLInputElement).value, 'Refused');
  assert.match($('#toast')!.textContent, /unexpected \/api\/rename/);
});

test('the account page offers setup until accounts are on, then the signed-in user', async () => {
  go('account');
  render();
  assert.equal($('#main h1')!.textContent, 'User accounts');
  assert.equal($('#auth-form h2')!.textContent.trim(), 'Secure your existing save');
  assert.ok($('#auth-form input[name=setupToken]'));
  assert.ok($('#auth-form input[name=registration]'));
  open({ workspace: { accountsEnabled: true } });
  render();
  await nextTick();
  assert.equal($('#main h1')!.textContent, evil);
  noMarkup();
  assert.ok($('[data-logout]'));
  assert.equal($('#auth-form'), null);
});

test('a failed sign-out says so and leaves the user signed in', async () => {
  open({ workspace: { accountsEnabled: true } });
  go('account');
  render();
  const calls = stubFetch({}); // /api/logout answers 500
  $('[data-logout]')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  assert.deepEqual(
    calls.map(c => c[0]),
    ['/api/logout'],
    'no reload follows a failed sign-out',
  );
  assert.match($('#toast')!.textContent, /unexpected \/api\/logout/);
  assert.ok($('#toast')!.classList.contains('error'));
  assert.ok($('[data-logout]'), 'still on the account page');
});

test('the username pattern is a valid regular expression under the v flag browsers use', () => {
  open({ workspace: { user: null, accountsEnabled: true } });
  showSignedOut($('#app')!);
  const pattern = $<HTMLInputElement>('#auth-form input[name=username]')!.pattern;
  // Browsers compile pattern as ^(?:…)$ with the v flag and ignore it when that throws.
  const compiled = new RegExp('^(?:' + pattern + ')$', 'v');
  assert.equal(compiled.test('pioneer_1-a'), true);
  assert.equal(compiled.test('a b'), false);
});

test('the sign-in screen switches between signing in and registering', async () => {
  open({ workspace: { user: null, registration: true } });
  showSignedOut($('#app')!);
  assert.equal($('.layout'), null, 'the frame is gone');
  assert.equal($('#auth-form h2')!.textContent.trim(), 'Sign in');
  assert.equal(
    $<HTMLInputElement>('#auth-form input[name=password]')!.autocomplete,
    'current-password',
  );
  $('[data-auth-mode]')!.click();
  await nextTick();
  assert.equal($('#auth-form h2')!.textContent.trim(), 'Create your account');
  assert.equal(
    $<HTMLInputElement>('#auth-form input[name=password]')!.autocomplete,
    'new-password',
  );
  assert.match($('[data-auth-mode]')!.textContent, /Back to sign in/);
});

test('a failed sign-in says why in the form', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Wrong username or password.' }), { status: 401 });
  open({ workspace: { user: null, accountsEnabled: true } });
  showSignedOut($('#app')!);
  $<HTMLInputElement>('#auth-form input[name=username]')!.value = 'pioneer';
  $<HTMLInputElement>('#auth-form input[name=password]')!.value = 'correct horse battery';
  $('#auth-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  assert.equal($('#auth-error')!.textContent, 'Wrong username or password.');
  assert.equal($<HTMLButtonElement>('#auth-form button')!.disabled, false);
});

// #243: the save-wide note moved to the Notes page (tests/ui/notes.test.ts); Backup links there.
for (const kind of ['migrated', 'calculated'] as const)
  test(`the ${kind} backup page has no notes box and links to the Notes page`, () => {
    const notes = { global: 'Kept', 'phase-3': 'Kept too' };
    open(kind === 'calculated' ? { calculated: true, notes } : { notes });
    go('backup');
    render();
    assert.equal($$('#main textarea').length, 0, 'no notes editor on Backup');
    assert.equal($$('#main [data-save-note]').length, 0);
    assert.equal($('[data-notes-moved] a')!.getAttribute('href'), '#notes');
    assert.deepEqual({ ...state.notes }, notes, 'the notes are untouched');
  });

// A profile migrated from the handbook (#387) gets the server page every profile gets: its own
// download, restore and the transfer controls, and its plan's assumptions.
test('a migrated profile’s backup page has its download, restore and transfer controls', () => {
  go('backup');
  render();
  noMarkup();
  assert.equal($('a[download]')!.getAttribute('href'), '/api/export?save=s&profile=original');
  assert.ok($('#import-file') && $('#import-saves') && $('[data-export-saves]'));
  assert.deepEqual(
    $$('#main .panel h2').map(h2 => h2.textContent),
    [
      'Full saves & transfer',
      'Download this profile',
      'Restore this profile',
      'Calculation assumptions',
    ],
  );
  assert.equal($('.list-links'), null, 'the handbook’s source list went with its page');
});

// SP-41 (#276): the page is "Backup" everywhere, with the same four actions on both profile
// kinds. The browser edition's page and its links (the notice, the profiles page, the switcher
// menu, ADA) are checked as source, since browserMode is fixed when browser-api.ts loads.
test('the Backup page and its links say "Backup", with plainly named actions (SP-41)', () => {
  for (const calculated of [undefined, true] as const) {
    open({ calculated });
    go('backup');
    render();
    assert.equal($('#main h1')!.textContent, 'Backup');
    const actions = $$('#main .btn').map(b => b.textContent!.trim());
    for (const name of [
      'Download this profile',
      'Restore this profile…',
      'Export all saves',
      'Import saves…',
    ])
      assert.ok(actions.includes(name), `${calculated ? 'calculated' : 'migrated'}: "${name}"`);
  }
  const sources = [
    'public/ada.ts',
    'public/app/ui/BrowserNotice.vue',
    'public/app/ui/Shell.vue',
    'public/app/ui/pages/BackupPage.vue',
    'public/app/ui/pages/ProfilesPage.vue',
  ].map(f => fs.readFileSync(f, 'utf8'));
  for (const old of ['Backups & transfer', 'Backup & notes', 'progress JSON', 'Choose backup'])
    assert.ok(!sources.some(s => s.includes(old)), `no "${old}" left`);
});

// #307: "Import saves" and "Choose backup (file)" were labels around a `hidden` file input, so
// Tab never reached them. Each is now a button in the tab order, named by its text, that opens
// the file input (which stays rendered but out of sight and out of the tab order).
for (const [kind, restoreName] of [
  ['migrated', 'Restore this profile…'],
  ['calculated', 'Restore this profile…'],
] as const)
  test(`the ${kind} backup page's file controls are buttons the keyboard reaches`, () => {
    open(kind === 'calculated' ? { calculated: true } : {});
    go('backup');
    render();
    // What Tab can reach on the page, by its accessible text.
    const tabbable = $$<HTMLElement>('#main button, #main a[href], #main input, #main summary')
      .filter(
        element =>
          element.tabIndex >= 0 && !element.hidden && !(element as HTMLButtonElement).disabled,
      )
      .map(element => (element.getAttribute('aria-label') || element.textContent || '').trim());
    for (const [name, inputId] of [
      ['Import saves…', 'import-saves'],
      [restoreName, 'import-file'],
    ] as const) {
      assert.ok(tabbable.includes(name), `Tab reaches "${name}"`);
      const button = $$<HTMLButtonElement>('#main button').find(
        b => b.textContent!.trim() === name,
      )!;
      assert.equal(button.type, 'button', 'a plain button, not a form submit');
      assert.equal(button.closest('label'), null, 'not a label around the input');
      const input = $<HTMLInputElement>('#' + inputId)!;
      assert.equal(input.type, 'file');
      assert.equal(input.hidden, false, 'the input is rendered, so click() opens it everywhere');
      assert.equal(input.classList.contains('visually-hidden'), true);
      assert.equal(input.tabIndex, -1, 'the input is not a second tab stop');
      assert.equal(input.getAttribute('aria-hidden'), 'true', 'nor announced twice');
      // Pressing the button (Enter and Space press a button) opens that input's file picker.
      const opened: string[] = [];
      const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
        this: HTMLInputElement,
      ) {
        opened.push(this.id);
      });
      button.click();
      click.mockRestore();
      assert.deepEqual(opened, [inputId]);
    }
  });

test('restoring a progress backup shows "Saving…" and counts as a pending write', async () => {
  go('backup');
  render();
  let reply: (response: Response) => void = () => {};
  globalThis.fetch = async () => new Promise<Response>(resolve => (reply = resolve));
  answerConfirms(true);
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state: {} })],
    'b.json',
  );
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  // pending is what the close-tab warning (listeners.ts) checks.
  assert.equal(pending, 1);
  assert.equal($('#saved')!.textContent, 'Saving…');
  assert.equal($('#saved-short')!.textContent, 'Saving…');
  reply(new Response(JSON.stringify(state), { status: 200 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  assert.equal(pending, 0);
  assert.notEqual($('#saved')!.textContent, 'Saving…');
  assert.equal($('#saved-short')!.textContent, 'Saved');
  assert.match($('#toast')!.textContent, /Backup restored/);
});

// Starts restoring a backup on the Backup page with a server that answers only when told.
async function slowRestore() {
  const sent: string[] = [];
  const replies: ((body: unknown) => void)[] = [];
  globalThis.fetch = async (path: RequestInfo | URL) => {
    sent.push(String(path));
    return new Promise<Response>(
      resolve =>
        void replies.push(body => resolve(new Response(JSON.stringify(body), { status: 200 }))),
    );
  };
  answerConfirms(true);
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-file')!;
  const restored = { ...state, notes: { global: 'From the backup' } };
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state: restored })],
    'b.json',
  );
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  return { sent, replies, restored };
}

test('a save made during a restore waits for it, and lands on top of it', async () => {
  const { sent, replies, restored } = await slowRestore();
  const tick = save({ type: 'check', key: 'after-restore', value: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent, ['/api/import'], 'the tick waits for the restore');
  replies[0]!(restored);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent, ['/api/import', '/api/update']);
  replies[1]!({ ...restored, checks: { 'after-restore': true } });
  await tick;
  assert.equal(state.notes.global, 'From the backup');
  assert.equal(state.checks['after-restore'], true, 'the later write is what is shown');
});

test('a restore reply does not replace another profile opened meanwhile', async () => {
  const { replies, restored } = await slowRestore();
  // The user opens the calculated profile before the reply lands.
  open({ calculated: true, notes: { global: 'Other profile' } });
  replies[0]!(restored);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(state.notes.global, 'Other profile');
});

test('after a restore the file box is cleared, so the same backup can be chosen again', async () => {
  stubFetch({ '/api/import': () => state });
  answerConfirms(true);
  go('backup');
  render();
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state })],
    'b.json',
  );
  let chosen = 'C:\fakepath\b.json';
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  Object.defineProperty(input, 'value', {
    get: () => chosen,
    set: (value: string) => (chosen = value),
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => assert.match($('#toast')!.textContent!, /Backup restored/));
  assert.equal(chosen, '', 'cleared after a successful restore');
});

test('an export over the import limit is refused with a reason, and nothing downloads', async () => {
  let downloads = 0;
  URL.createObjectURL = () => (downloads++, 'blob:x');
  URL.revokeObjectURL = () => {};
  const asked = answerConfirms(true);
  const summary = { ...workspace };
  // A normal export downloads without a question.
  stubFetch({
    '/api/export-saves': { format: 'satisfactory-planner-saves', saves: [] },
    '/api/workspace': summary,
  });
  go('backup');
  render();
  $('[data-export-saves]')!.click();
  await vi.waitFor(() => assert.equal(downloads, 1));
  // One over 50 MB is refused outright: no question, no download, and a toast saying why.
  stubFetch({
    '/api/export-saves': {
      format: 'satisfactory-planner-saves',
      saves: [],
      pad: 'x'.repeat(51 * 1024 * 1024),
    },
    '/api/workspace': summary,
  });
  $('[data-export-saves]')!.click();
  // The refusal's toast is the last thing the click does.
  await vi.waitFor(() => assert.ok($('#toast')!.classList.contains('error')), { timeout: 5000 });
  assert.equal(asked.length, 0, 'no "download anyway" question');
  assert.equal(downloads, 1, 'nothing downloaded');
  const text = $('#toast')!.textContent!;
  assert.ok(/would be 5\d MB, more than the 50 MB an import accepts/.test(text), text);
  assert.ok($('#toast')!.classList.contains('error'));
});

test('a redraw keeps unsaved save-wide notes on the notes page', async () => {
  go('notes');
  render();
  const note = $<HTMLTextAreaElement>('#global-note')!;
  note.value = 'Unsaved thought';
  note.dispatchEvent(new Event('input'));
  // What the save indicator does while another write is in flight.
  invalidate();
  await nextTick();
  assert.equal($<HTMLTextAreaElement>('#global-note')!.value, 'Unsaved thought');
});

test('the calculated backup page names the profile and lists its assumptions', () => {
  open({ calculated: true });
  go('backup');
  render();
  noMarkup();
  assert.equal(
    $('#main .subtitle')!.textContent,
    `Checkmarks, deliveries and notes belong to ${evil} / ${evil}`,
  );
  assert.deepEqual(
    $$('#main .panel p')
      .map(p => p.textContent)
      .filter(t => t === evil || t === 'Second assumption'),
    [evil, 'Second assumption'],
  );
  assert.equal($('a[download]')!.getAttribute('href'), '/api/export?save=s&profile=p');
});

// #309: on the server the "Full saves & transfer" panel came before the page header, so the page
// opened on a panel with no title. The header comes first in both server versions.
for (const kind of ['migrated', 'calculated'] as const)
  test(`the ${kind} backup page opens with its header, then the full-saves panel`, () => {
    open(kind === 'calculated' ? { calculated: true } : {});
    go('backup');
    render();
    const [first, second] = [...$('#main')!.children];
    assert.equal(first!.querySelector('h1')!.textContent, 'Backup');
    assert.equal(second!.querySelector('h2')!.textContent, 'Full saves & transfer');
    assert.equal($$('#main h1').length, 1, 'one header');
  });

// A profile migrated from the handbook (#387) has the calculated resources page: every budget with
// its icon, and the handbook's power commissioning checks from its plan guide.
test('a migrated profile’s resources page shows every budget with its icon, and the power checks', async () => {
  const plan = migratedPlan();
  openCalculatedResources(plan);
  const rows = $$('#main tbody tr');
  assert.equal(rows.length, Object.keys(plan.settings.limits).length);
  for (const row of rows) {
    // The resource column stays in view when the table scrolls sideways (#358).
    assert.ok(row.firstElementChild!.classList.contains('resource-cell'));
    const name = row.querySelector('.resource-name span')!.textContent;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.equal(
      row.querySelector('.resource-name img')!.getAttribute('src'),
      `./icons/${slug}.png`,
    );
  }
  assert.equal($$('[data-check^="power-"]').length, 9);
  assert.equal($<HTMLInputElement>('[data-check="power-u4"]')!.checked, false);
  state.checks['power-u4'] = true;
  render();
  await nextTick();
  assert.equal(
    $<HTMLInputElement>('[data-check="power-u4"]')!.checked,
    true,
    'a saved check shows ticked',
  );
});

// #354: a page stays mounted until render() swaps it out, so the resources page can be drawn once
// more after the profile it was drawn for has gone and no calculated plan is open. It draws
// nothing then rather than throwing.
test('the resources page draws nothing while no calculated plan is open', async () => {
  closePlan();
  const el = document.createElement('div');
  const errors: unknown[] = [];
  const app = createApp({ render: () => h(CalculatedResourcesPage) });
  app.config.errorHandler = error => void errors.push(error);
  app.mount(el);
  await nextTick();
  assert.deepEqual(errors, [], 'it draws without an error');
  assert.equal(el.querySelector('table, [data-guide-power]'), null, 'it draws no resources');
  app.unmount();
});

test('moving between pages leaves nothing behind', async () => {
  go('profiles');
  render();
  assert.equal($$('.profile-card').length, 2);
  go('factories');
  render();
  assert.equal($$('.profile-card').length, 0, 'the component page is gone');
  assert.equal($('#main h1')!.textContent, 'Factories');
  go('backup');
  render();
  assert.equal($$('#main h1').length, 1);
  assert.equal($('#main h1')!.textContent, 'Backup');
  go('resources');
  render();
  assert.equal($$('#main h1').length, 1);
  assert.equal($('#main h1')!.textContent, 'Power & resources');
  // #resources ignores the wizard draft.
  assert.equal(vuePage('resources', null), CalculatedResourcesPage);
});

// A calculated profile's resources page, with the catalog's raw resources as the server
// sends them (the same list as the plan's budgets).
function openCalculatedResources(plan: StoredCalculatedPlan) {
  // Only the field this page reads.
  open({
    calculated: plan,
    workspace: { catalog: { raw: Object.keys(plan.settings.limits) } as Catalog },
  });
  go('resources');
  render();
}

test('the calculated resources page shows every budget with its icon and what is left', () => {
  const plan = generated();
  const stage = plan.stages['3'];
  const [first] = Object.keys(plan.settings.limits);
  // One resource over budget.
  stage.raw![first!] = plan.settings.limits[first!]! + 10;
  stage.surplus = {};
  openCalculatedResources(plan);
  assert.equal($('#main h1')!.textContent, 'Power & resources');
  assert.equal($('#main .eyebrow')!.textContent, 'CHECK BEFORE EXPANDING');
  const rows = $$('#main tbody tr');
  const names = rows.map(r => r.querySelector('.resource-name span')!.textContent);
  assert.deepEqual([...names].sort(), Object.keys(plan.settings.limits).sort(), 'every budget');
  // The resource column stays in view when the table scrolls sideways (#358).
  assert.ok($('#main thead th')!.classList.contains('resource-cell'));
  for (const row of rows) assert.ok(row.firstElementChild!.classList.contains('resource-cell'));
  assert.equal(names[0], first, 'the one over budget comes first');
  for (const row of rows) {
    const name = row.querySelector('.resource-name span')!.textContent;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.equal(
      row.querySelector('.resource-name img')!.getAttribute('src'),
      `./icons/${slug}.png`,
    );
  }
  const cells = (row: HTMLElement) =>
    [...row.querySelectorAll('td')].slice(1).map(td => td.textContent.trim());
  assert.equal(cells(rows[0]!)[2], '-10/min', 'Iron Ore, an ore, in /min');
  assert.ok(rows[0]!.querySelectorAll('td')[3]!.classList.contains('warn'), 'over budget');
  for (const row of rows.slice(1))
    assert.ok(!row.querySelectorAll('td')[3]!.classList.contains('warn'), 'the others fit');
  // One power headroom bar instead of the tiles (SP-29); augmenters only when the plan has them.
  assert.equal($$('#main .stat').length, 0);
  assert.deepEqual(
    $$('#main [data-power-part] .eyebrow').map(eyebrow => eyebrow.textContent),
    ['Whole-machine peak', 'Utility allowance', 'New generation', 'Existing spare power'],
  );
  assert.equal(
    $('#main [data-power-part="utility"] small')!.textContent,
    '20% for transport and utilities; verify actual load',
  );
  assert.match($('#main .backup-grid')!.textContent, /No raw-resource conversion required\./);
  assert.match($('#main .backup-grid')!.textContent, /None credited in this phase\./);
  assert.equal($('#main [data-rate-list="surplus"] h2')!.textContent, 'Surplus solids');
  assert.equal($('#main [data-rate-list="surplus"] p')!.textContent, 'None');
});

// SP-28 (#263): each item list is its own panel with an h2 bar, and lists its items as rows of
// a decorative icon, the name as text and the rate (m³/min for a fluid); an empty list keeps
// its sentence, and vehicle fuel shows only when the plan burns some.
test('the calculated resources page lists items as icon rows, one panel per list', async () => {
  const plan = generated();
  const stage = plan.stages['3'];
  Object.assign(stage, {
    drone: { 'Packaged Fuel': 10 },
    transport: {},
    storage: { 'Iron Plate': 1, [evil]: 2.5, Wire: 0 },
    supplied: {},
    surplus: { 'Polymer Resin': 47.59, Fuel: 12 },
  });
  openCalculatedResources(plan);
  noMarkup();
  const lists = $$<HTMLElement>('#main .backup-grid > .panel[data-rate-list]');
  assert.deepEqual(
    lists.map(list => [
      list.dataset.rateList,
      list.querySelector(':scope > h2:first-child')!.textContent,
    ]),
    [
      ['drone', 'Dedicated drone fuel'],
      ['storage', 'Protected storage'],
      ['supplied', 'From production you already run'],
      ['surplus', 'Surplus solids'],
    ],
    'a panel with an h2 bar per list, and none for vehicle fuel the plan does not burn',
  );
  assert.equal($$('#main .backup-grid > .panel').length, 5, 'and the conversions panel');
  const rows = (id: string) =>
    $$(`#main [data-rate-list="${id}"] ul.supply-summary > li`).map(li => {
      // A name with no bundled artwork gets the placeholder glyph instead of an image (#448).
      const img = li.querySelector('.item-icon')!;
      assert.equal(img.getAttribute('aria-hidden'), 'true', 'the icon is decorative');
      if (img.tagName === 'IMG') assert.equal(img.getAttribute('alt'), '');
      return [li.querySelector('b')!.textContent, li.textContent.replace(/\s+/g, ' ').trim()];
    });
  assert.deepEqual(rows('drone'), [['Packaged Fuel', 'Packaged Fuel 10/min']]);
  assert.deepEqual(
    rows('storage'),
    [
      ['Iron Plate', 'Iron Plate 1/min'],
      [evil, `${evil} ${num(2.5)}/min`],
    ],
    'the name stays text; a zero rate is left out',
  );
  assert.deepEqual(rows('surplus'), [
    ['Polymer Resin', `Polymer Resin ${num(47.59)}/min`],
    ['Fuel', 'Fuel 12 m³/min'],
  ]);
  // Empty lists keep their sentence, and no list.
  assert.equal($('#main [data-rate-list="supplied"] ul'), null);
  assert.equal(
    $('#main [data-rate-list="supplied"] p')!.textContent,
    'None credited in this phase.',
  );
  assert.equal($('#main [data-transport-fuel]'), null);
  // Vehicle fuel, and the other empty sentences.
  Object.assign(stage, { drone: {}, transport: { 'Packaged Fuel': 3 }, storage: {}, surplus: {} });
  openCalculatedResources(plan);
  await nextTick();
  assert.equal(
    $('#main [data-rate-list="transport"] h2')!.textContent,
    'Vehicle fuel for links between factories',
  );
  assert.deepEqual(rows('transport'), [['Packaged Fuel', 'Packaged Fuel 3/min']]);
  assert.ok($('#main [data-rate-list="transport"] ul[data-transport-fuel]'));
  assert.equal(
    $('#main [data-rate-list="drone"] p')!.textContent,
    'No dedicated drone fuel in this phase.',
  );
  assert.equal(
    $('#main [data-rate-list="storage"] p')!.textContent,
    'No storage production requested.',
  );
  assert.equal($('#main [data-rate-list="surplus"] p')!.textContent, 'None');
});

// SP-27 (#262): a Use column with the handbook page's bar, the tightest resource first.
test('the calculated resources page sorts by use, tightest first, and dims unused resources', () => {
  const plan = generated();
  const stage = plan.stages['3'];
  // Catalogue order, with each case: [budget, required].
  const cases: Record<string, [number, number]> = {
    'Iron Ore': [100, 50], // 50%
    'Copper Ore': [100, 95], // tight
    Limestone: [100, 110], // over by 10
    Coal: [0, 5], // required from no budget at all
    'Caterium Ore': [0, 0], // nothing of nothing
    'Raw Quartz': [100, 0], // not used
    Sulfur: [1000, 10], // 1%
  };
  plan.settings.limits = Object.fromEntries(
    Object.entries(cases).map(([name, [budget]]) => [name, budget]),
  );
  stage.raw = Object.fromEntries(
    Object.entries(cases).map(([name, [, required]]) => [name, required]),
  );
  openCalculatedResources(plan);
  assert.deepEqual(
    $$('#main thead th').map(th => [th.textContent, th.getAttribute('scope')]),
    [
      ['Resource', 'col'],
      ['Required', 'col'],
      ['Budget', 'col'],
      ['Remaining', 'col'],
      ['Use', 'col'],
    ],
  );
  const rows = $$('#main tbody tr');
  const view = rows.map(row => {
    const use = row.querySelector<HTMLElement>('[data-use]')!,
      bar = use.querySelector<HTMLElement>('.resource-bar')!;
    return {
      name: row.querySelector('.resource-name span')!.textContent,
      use: use.firstChild!.textContent!.trim(),
      bar: [...bar.classList].filter(c => c !== 'resource-bar').join(' '),
      width: bar.querySelector('span')!.style.width,
      over: use.querySelector('[data-over]')?.textContent.trim() ?? '',
      dim: row.classList.contains('muted'),
    };
  });
  assert.deepEqual(view, [
    {
      name: 'Coal',
      use: 'No budget',
      bar: 'over',
      width: '100%',
      over: '⚠ Over by 5/min',
      dim: false,
    },
    {
      name: 'Limestone',
      use: '110%',
      bar: 'over',
      width: '100%',
      over: '⚠ Over by 10/min',
      dim: false,
    },
    { name: 'Copper Ore', use: '95%', bar: 'tight', width: '95%', over: '', dim: false },
    { name: 'Iron Ore', use: '50%', bar: '', width: '50%', over: '', dim: false },
    { name: 'Sulfur', use: '1%', bar: '', width: '1%', over: '', dim: false },
    // Nothing required: last, in catalogue order, dimmed.
    { name: 'Caterium Ore', use: '—', bar: '', width: '0%', over: '', dim: true },
    { name: 'Raw Quartz', use: '0%', bar: '', width: '0%', over: '', dim: true },
  ]);
  // Over budget is said in words and marked, not only drawn red; the icon is not read out.
  const over = rows[1]!.querySelector('[data-use]')!;
  assert.ok(over.classList.contains('warn'));
  assert.equal(over.querySelector('[data-over] [aria-hidden="true"]')!.textContent.trim(), '⚠');
  assert.ok(rows[1]!.querySelectorAll('td')[3]!.classList.contains('warn'), 'remaining too');
  assert.ok(!rows[2]!.querySelector('[data-use]')!.classList.contains('warn'), 'tight is not over');
  // The bar is decoration beside the percentage it draws.
  for (const bar of $$('#main tbody .resource-bar'))
    assert.equal(bar.getAttribute('aria-hidden'), 'true');
});

test('a resource counts as tight above 90% of its budget and over above 100%', () => {
  const flags = (required: number, available: number) => {
    const use = resourceUse(required, available);
    return [use.tight, use.over, use.idle];
  };
  assert.deepEqual(flags(90, 100), [false, false, false], '90% is not tight yet');
  assert.deepEqual(flags(90.5, 100), [true, false, false]);
  assert.deepEqual(flags(100, 100), [true, false, false], 'all of it is tight, not over');
  assert.deepEqual(flags(100.5, 100), [true, true, false]);
  assert.deepEqual(flags(5, 0), [true, true, false], 'something from no budget is over');
  assert.deepEqual(flags(0, 0), [false, false, true]);
  assert.equal(resourceUse(5, 0).fraction, Infinity);
  assert.equal(resourceUse(5, 0).overBy, '5');
  assert.equal(resourceUse(0, 0).bar, 0);
  // Over budget without a budget is tighter than any percentage; unused goes last.
  const order = [
    resourceUse(0, 10),
    resourceUse(99, 100),
    resourceUse(1, 0),
    resourceUse(200, 100),
  ].sort(tightestFirst);
  assert.deepEqual(
    order.map(u => u.use),
    ['No budget', '200%', '99%', '0%'],
  );
});

test('the calculated resources page lists somersloops, augmenters, conversions and credits', () => {
  const plan = generated();
  const stage = plan.stages['3'];
  Object.assign(stage, {
    feasible: false,
    reason: evil,
    sloopsUsed: 12,
    augmenters: 2,
    augmenterMW: 100,
    boost: 0.2,
    availableMW: 5000,
    conversions: [evil, 'Second conversion'],
    supplied: { 'Iron Plate': 30 },
  });
  openCalculatedResources(plan);
  noMarkup();
  // The somersloop and augmenter counts are legend captions of the power bar (SP-29).
  assert.match(
    $('#main [data-power-part="peak"] small')!.textContent,
    /· 12 somersloops in production: amplified machines give double output at four times the power$/,
  );
  const spare = plan.settings.availablePowerGW * 1000;
  assert.equal(
    $('#main [data-power-part="boost"] b')!.textContent,
    power(5000 - (stage.generationMW ?? 0) - spare),
    'what the augmenters add to the available power',
  );
  assert.equal(
    $('#main [data-power-part="boost"] small')!.textContent,
    '2 augmenters · 100 MW plus 20% of base production',
  );
  assert.match($('#main .notice.warn')!.textContent, /Planning draft/);
  assert.ok($('#main .notice.warn')!.textContent.includes(evil), 'the reason is shown as text');
  const conversions = $('#main .backup-grid [data-conversions]')!.querySelector('p')!;
  assert.equal(conversions.querySelectorAll('br').length, 1);
  assert.equal(conversions.textContent.trim(), evil + 'Second conversion');
  assert.match($('#main [data-rate-list="supplied"] li')!.textContent, /Iron Plate 30\/min/);
  assert.match(
    $('#main [data-rate-list="supplied"] .small.muted')!.textContent,
    /does not build these lines/,
  );
});

// SP-29 (#264): one bar of what the phase needs (peak + utility allowance) against what it has
// (new generation + spare), on one scale, with a headline, a legend and a text alternative;
// MW below 1,000 and GW above; a shortfall says so in red.
test('the calculated resources page draws one power headroom bar (SP-29)', () => {
  const plain = (text: string) => text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const plan = generated();
  const stage = plan.stages['3'];
  Object.assign(stage, { peakMW: 2000, requiredMW: 2400, generationMW: 3000, augmenters: 0 });
  plan.settings.availablePowerGW = 0.2;
  openCalculatedResources(plan);
  const bar = $('#main [data-power-headroom]')!;
  const headline = plain(bar.querySelector('[data-power-headline]')!.textContent!);
  // 3,2 GW available, 2,4 GW needed: 0,8 GW, a quarter, left over.
  assert.equal(headline, `25% headroom ${power(2400)} needed of ${power(3200)} available`);
  assert.ok(!bar.querySelector('.power-headline.short'));
  const values = Object.fromEntries(
    $$('#main [data-power-part]').map(li => [
      li.dataset.powerPart,
      li.querySelector('b')!.textContent,
    ]),
  );
  assert.deepEqual(values, {
    peak: `${num(2)} GW`,
    utility: '400 MW',
    generation: `${num(3)} GW`,
    spare: '200 MW',
  });
  // Both bars share one scale, the larger of the two sides.
  const widths = (side: string) =>
    [...bar.querySelectorAll<HTMLElement>(`[data-power-bar="${side}"] span`)].map(
      segment => segment.style.width,
    );
  assert.deepEqual(widths('demand'), ['62.5%', '12.5%']);
  assert.deepEqual(widths('supply'), ['93.75%', '6.25%']);
  // The bars are one image with every figure as text.
  const img = bar.querySelector('[role="img"]')!;
  assert.equal(
    img.getAttribute('aria-label'),
    `25% headroom. Needed: ${power(2400)} (${power(2000)} whole-machine peak + 400 MW utility allowance). Available: ${power(3200)} (${power(3000)} new generation + 200 MW existing spare power).`,
  );
  // Short: the headline says by how much, in red, and the supply bar shows the gap.
  stage.generationMW = 1000;
  page();
  openCalculatedResources(structuredClone(plan));
  const short = $('#main .power-headline.short')!;
  assert.ok(short, 'the shortfall is marked');
  assert.match(
    plain(short.textContent!),
    new RegExp(`^⚠ Short by ${power(1200).replace(/\./g, '\\.')}`),
  );
  assert.ok($('#main [data-power-bar="supply"] .seg-short'), 'the gap is drawn');
  assert.match($('#main [role="img"]')!.getAttribute('aria-label')!, /^Short by /);
});

// Exactly what a profile calculated by an earlier release looks like: no existingSupply in
// its settings and no supplied on any stage.
test('the calculated resources page renders a plan saved before existing production existed', () => {
  const plan: StoredCalculatedPlan = generated();
  delete plan.settings.existingSupply;
  for (const stage of Object.values(plan.stages)) delete stage.supplied;
  openCalculatedResources(plan);
  assert.equal($$('#main tbody tr').length, Object.keys(plan.settings.limits).length);
  assert.match($('#main .backup-grid')!.textContent, /None credited in this phase\./);
  assert.doesNotMatch($('#main .backup-grid')!.textContent, /does not build these lines/);
});

// Leaving a calculated profile's page for no profile at all (the empty workspace once the last
// save is removed): anything that redraws before render() swaps the page (a save finishing, the
// save indicator) reaches the calculated page and dialog once more, with no calculated plan open.
test('a calculated page survives a redraw after its plan has gone', async () => {
  const errors: unknown[] = [];
  const onError = (event: { reason?: unknown; error?: unknown }) =>
    errors.push(event.reason ?? event.error);
  process.on('unhandledRejection', onError);
  try {
    for (const view of ['plan', 'factories', 'logistics', 'storage', 'resources'] as const) {
      page();
      const plan = generated();
      open({ calculated: plan });
      go(view);
      render();
      openCalculatedFactory(plan.stages['3'].rows![0]!.id);
      closePlan();
      invalidate();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));
      render();
      await nextTick();
      assert.ok($('#main h1'), view + ' still has its header after render()');
    }
  } finally {
    process.off('unhandledRejection', onError);
  }
  assert.deepEqual(errors, []);
});

test('chosen saves export on their own, and a single save offers no choice (#160)', async () => {
  let downloads = 0;
  URL.createObjectURL = () => (downloads++, 'blob:x');
  URL.revokeObjectURL = () => {};
  const two = {
    saves: [
      { id: 's', name: 'First world', activeProfile: 'original', profiles: [] },
      { id: 's2', name: 'Second world', activeProfile: 'p2', profiles: [] },
    ],
  };
  open({ workspace: two as Partial<typeof workspace> });
  const calls = stubFetch({
    '/api/export-saves': { format: 'satisfactory-planner-saves', saves: [] },
    '/api/workspace': { ...workspace },
  });
  go('backup');
  render();
  await nextTick();
  const boxes = $$<HTMLInputElement>('[data-choose-save]');
  assert.equal(boxes.length, 2);
  assert.equal($<HTMLButtonElement>('[data-export-selected]')!.disabled, true, 'nothing ticked');
  boxes[1]!.checked = true;
  boxes[1]!.dispatchEvent(new Event('change'));
  await nextTick();
  $<HTMLButtonElement>('[data-export-selected]')!.click();
  await vi.waitFor(() => assert.equal(downloads, 1));
  assert.ok(
    calls.some(([path]) => path === '/api/export-saves?saves=s2'),
    JSON.stringify(calls),
  );
  assert.equal(downloads, 1);
  assert.match($('#toast')!.textContent!, /^1 save downloaded\.$/);
  // With one save there is nothing to choose between.
  open();
  go('backup');
  render();
  await nextTick();
  assert.equal($('[data-choose-save]'), null);
});

test('a refused browser record offers its stored data as a download on the error page', async () => {
  // What browser-store.ts throws for a damaged record; fetch stands in for the request.
  const refusal = Object.assign(new Error('The saves in this browser could not be read.'), {
    storedData: true,
  });
  globalThis.fetch = async () => {
    throw refusal;
  };
  await boot();
  assert.match($('#app .loading p')!.textContent!, /could not be read/);
  const button = $<HTMLButtonElement>('#download-stored-data')!;
  assert.ok(button, 'the download is offered');
  // A minimal IndexedDB holding the damaged record; the download is that record, unchanged.
  // Its requests answer in a microtask (#226): readStoredData sets onsuccess as soon as a request
  // returns, and the open, the read and the download then all finish before any timer runs.
  // With timers, a busy event loop let the wait below run between the open and the read.
  const record = { version: 1, saves: [1], note: 'keep me' };
  const request = <T>(result: T) => {
    const fakeRequest: { result: T; onsuccess?: () => void; onerror?: () => void } = { result };
    queueMicrotask(() => fakeRequest.onsuccess?.());
    return fakeRequest;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction: () => ({ objectStore: () => ({ get: () => request(record) }) }),
  };
  Object.assign(globalThis, { indexedDB: { open: () => request(db) } });
  let saved: Blob | undefined;
  URL.createObjectURL = (blob: Blob | MediaSource) => ((saved = blob as Blob), 'blob:x');
  URL.revokeObjectURL = () => {};
  button.click();
  await new Promise(resolve => setTimeout(resolve));
  assert.ok(saved, 'the download is ready');
  assert.deepEqual(JSON.parse(await saved.text()), record);
  // Any other start-up failure shows no such button.
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await boot();
  assert.equal($('#download-stored-data'), null);
  assert.ok($('#retry'));
});

// The handbook's fixed copy, carried into a migrated profile's plan guide, measures crude, nitrogen
// and water in m³ (#367).
test('a migrated profile’s resources page writes the handbook’s fluid amounts in m³ (#367)', () => {
  open({ phase: '5', workspace: { catalog: { raw: [] as string[] } as Catalog } });
  go('resources');
  render();
  const text = $('#main')!.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /300 m³ Crude, 800 Sulfur, 400 Coal, 600 m³ Nitrogen and 1,000 m³ Water\./);
  assert.match(text, /cooling needs 42,000 m³ Water\/min/);
  assert.doesNotMatch(text, /\d Water\/min|\d\/min reserve/);
});

// Option 1 on #363: the resource tables mix fluids and ores, so the headers drop "/min" and each
// rate carries its own unit, m³/min for a fluid and /min for an ore, with a no-break space
// keeping a fluid's unit on the number's line. "Over by" follows its row; Use stays a percentage.
const nbsp = (text: string) => text.replace(/ /g, ' ');
const unitRows = () =>
  Object.fromEntries(
    $$('#main tbody tr').map(row => [
      row.querySelector('.resource-name span')!.textContent,
      [...row.querySelectorAll('td')].slice(1).map(td => nbsp(td.firstChild!.textContent!.trim())),
    ]),
  );

test('the calculated resources table writes each rate with its own unit (#363)', () => {
  const plan = generated();
  const stage = plan.stages['3'];
  plan.settings.limits = { 'Iron Ore': 1000, 'Crude Oil': 1200, Water: 5000 };
  stage.raw = { 'Iron Ore': 480, 'Crude Oil': 1500, Water: 0 };
  openCalculatedResources(plan);
  assert.deepEqual(
    $$('#main thead th').map(th => th.textContent),
    ['Resource', 'Required', 'Budget', 'Remaining', 'Use'],
    'no header names a unit',
  );
  const rows = unitRows();
  assert.deepEqual(rows['Crude Oil']!.slice(0, 3), [
    num(1500) + ' m³/min',
    num(1200) + ' m³/min',
    '-300 m³/min',
  ]);
  assert.deepEqual(rows['Iron Ore']!.slice(0, 3), ['480/min', num(1000) + '/min', '520/min']);
  assert.deepEqual(rows.Water!.slice(0, 3), [
    '0 m³/min',
    num(5000) + ' m³/min',
    num(5000) + ' m³/min',
  ]);
  // A fluid's number and unit are joined by a no-break space, so they never wrap apart.
  const oil = $$('#main tbody tr').find(r => /Crude Oil/.test(r.textContent))!;
  assert.equal(oil.querySelectorAll('td')[2]!.textContent.trim(), num(1200) + ' m³/min');
  for (const td of [...oil.querySelectorAll('td')].slice(1, 4))
    assert.ok(td.classList.contains('number'), 'rates stay in the tabular number cells');
  // "Over by" is a sentence about one item, in that item's unit; Use stays a percentage.
  const use = oil.querySelector('[data-use]')!;
  assert.equal(nbsp(use.querySelector('[data-over]')!.textContent.trim()), '⚠ Over by 300 m³/min');
  assert.equal(use.firstChild!.textContent!.trim(), num(125) + '%');
  assert.equal(rows['Iron Ore']![3], num(48) + '%');
});

// A plan with a guide (#393, #469; a migrated handbook profile) adds its power section to the
// calculated resources page: the commissioning checklist, ticking the guide's own ids, and its
// blocks of copy, a paragraph per blank line. All of it is text.
test("a guided plan's power commissioning and blocks on the resources page", async () => {
  const plan = {
    ...generated(),
    guide: {
      phases: {},
      power: {
        checks: [
          { id: 'power-retained', label: evil },
          { id: 'power-rocket-1', label: 'Rocket-fuel block 1: +72 GW' },
        ],
        blocks: [
          { title: evil, body: `${evil}\n\n10 refineries → 8 blenders.` },
          { title: 'Nuclear sequence', body: 'Phase 4: 50 uranium reactors.' },
        ],
      },
    },
  };
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  openCalculatedResources(plan);
  noMarkup();
  const guide = $('#main [data-guide-power]')!;
  assert.deepEqual(
    [...guide.querySelectorAll<HTMLInputElement>('[data-check]')].map(b => b.dataset.check),
    ['power-retained', 'power-rocket-1'],
  );
  assert.ok(guide.querySelector('.checklist')!.textContent!.includes(evil), 'labels as text');
  const blocks = [...guide.querySelectorAll('[data-guide-block]')];
  assert.deepEqual(
    blocks.map(b => b.querySelector('h2')!.textContent),
    [evil, 'Nuclear sequence'],
  );
  assert.deepEqual(
    [...blocks[0]!.querySelectorAll('p')].map(paragraph => paragraph.textContent),
    [evil, '10 refineries → 8 blenders.'],
  );
  const box = guide.querySelector<HTMLInputElement>('[data-check="power-rocket-1"]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'check', key: 'power-rocket-1', value: true });
  // Without a guide the page has none of it.
  openCalculatedResources(generated());
  await settle();
  assert.equal($('#main [data-guide-power]'), null);
});
