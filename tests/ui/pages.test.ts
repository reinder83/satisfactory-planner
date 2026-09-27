// The pages that are Vue components (public/app/ui/pages/), mounted through render() the way
// the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { pending, save } from '../../public/app/api.ts';
import { boot, currentSave, state, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { invalidate } from '../../public/app/ui/bridge.ts';
import { showSignedOut } from '../../public/app/ui/mount.ts';
import { vuePage } from '../../public/app/ui/pages.ts';
import CalculatedResourcesPage from '../../public/app/ui/pages/CalculatedResourcesPage.vue';
import {
  answerConfirms,
  $,
  $$,
  evil,
  generated,
  go,
  handbook,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { Catalog, StoredCalculatedPlan } from '../../public/types/index.ts';

// User text inserted as markup would create an <x-evil> element. (innerHTML cannot tell:
// a textarea's contents are serialised unescaped.)
const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');

beforeEach(() => {
  page();
  open();
});

test('Saves & profiles lists every profile, escaped, with its actions', () => {
  go('profiles');
  render();
  noMarkup();
  assert.equal($('.save-panel h2')!.textContent, evil);
  const cards = $$('.profile-card');
  assert.equal(cards.length, 2);
  assert.ok(cards[0]!.classList.contains('selected'), 'the open profile is marked');
  assert.equal(cards[0]!.querySelector('.eyebrow')!.textContent, 'PRESERVED HANDBOOK');
  assert.equal(cards[1]!.querySelector('.eyebrow')!.textContent, 'CALCULATED PROFILE');
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
  assert.ok($('#rename-form select[name=target]'));
});

// A key pressed on the focused element, as a browser sends it.
const key = (k: string) =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
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
  let reply: (r: Response) => void = () => {};
  globalThis.fetch = () => new Promise<Response>(r => (reply = r));
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

test('renaming the open save updates the page and the frame', async () => {
  const calls = stubFetch({
    '/api/rename': (body: { name: string }) => ({
      saves: [
        {
          id: 's',
          name: body.name,
          profiles: [{ id: 'original', kind: 'original', name: evil, completed: 2, phase: '3' }],
        },
      ],
    }),
  });
  go('profiles');
  render();
  $<HTMLInputElement>('#rename-form input[name=name]')!.value = 'Renamed & safe';
  $('#rename-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
  assert.deepEqual(calls[0], ['/api/rename', { target: 'save', name: 'Renamed & safe' }]);
  assert.equal(currentSave.name, 'Renamed & safe');
  assert.equal($('.save-panel h2')!.textContent, 'Renamed & safe');
  assert.equal($('.breadcrumbs a')!.textContent, 'Renamed & safe');
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
  await new Promise(r => setTimeout(r, 20));
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
  const re = new RegExp('^(?:' + pattern + ')$', 'v');
  assert.equal(re.test('pioneer_1-a'), true);
  assert.equal(re.test('a b'), false);
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
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
  assert.equal($('#auth-error')!.textContent, 'Wrong username or password.');
  assert.equal($<HTMLButtonElement>('#auth-form button')!.disabled, false);
});

test('the handbook backup page keeps the save-wide note exactly and lists the sources', () => {
  const note = evil + '\n  second line';
  open({ notes: { global: note } });
  go('backup');
  render();
  noMarkup();
  assert.equal(
    $<HTMLTextAreaElement>('#global-note')!.value,
    note,
    'the note keeps its line break and indent',
  );
  assert.equal($('[data-save-note="global"]')!.id, 'global-note', 'the notes key is on the box');
  assert.equal($('#global-note-status')!.getAttribute('aria-live'), 'polite');
  assert.equal($$('#main .note-save button').length, 0, 'no "Save notes" button');
  assert.equal($('a[download]')!.getAttribute('href'), '/api/export?save=s&profile=original');
  assert.equal($$('.list-links a').length, handbook.sources!.length);
  assert.ok($('#import-file') && $('#import-saves') && $('[data-export-saves]'));
});

// #307: "Import saves" and "Choose backup (file)" were labels around a `hidden` file input, so
// Tab never reached them. Each is now a button in the tab order, named by its text, that opens
// the file input (which stays rendered but out of sight and out of the tab order).
for (const [kind, restoreName] of [
  ['handbook', 'Choose backup file'],
  ['calculated', 'Choose backup'],
] as const)
  test(`the ${kind} backup page's file controls are buttons the keyboard reaches`, () => {
    open({ calculated: kind === 'calculated' });
    go('backup');
    render();
    // What Tab can reach on the page, by its accessible text.
    const tabbable = $$<HTMLElement>('#main button, #main a[href], #main input, #main summary')
      .filter(e => e.tabIndex >= 0 && !e.hidden && !(e as HTMLButtonElement).disabled)
      .map(e => (e.getAttribute('aria-label') || e.textContent || '').trim());
    for (const [name, inputId] of [
      ['Import saves', 'import-saves'],
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
  let reply: (r: Response) => void = () => {};
  globalThis.fetch = async () => new Promise<Response>(r => (reply = r));
  answerConfirms(true);
  const input = $<HTMLInputElement>('#import-file')!;
  const file = new File(
    [JSON.stringify({ format: 'satisfactory-planner-backup', state: {} })],
    'b.json',
  );
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
  // pending is what the close-tab warning (listeners.ts) checks.
  assert.equal(pending, 1);
  assert.equal($('#saved')!.textContent, 'Saving…');
  assert.equal($('#saved-short')!.textContent, 'Saving…');
  reply(new Response(JSON.stringify(state), { status: 200 }));
  await new Promise(r => setTimeout(r, 20));
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
      r => void replies.push(body => r(new Response(JSON.stringify(body), { status: 200 }))),
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
  await new Promise(r => setTimeout(r, 20));
  return { sent, replies, restored };
}

test('a save made during a restore waits for it, and lands on top of it', async () => {
  const { sent, replies, restored } = await slowRestore();
  const tick = save({ type: 'check', key: 'after-restore', value: true });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(sent, ['/api/import'], 'the tick waits for the restore');
  replies[0]!(restored);
  await new Promise(r => setTimeout(r, 20));
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
  await new Promise(r => setTimeout(r, 20));
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
    set: (v: string) => (chosen = v),
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

test('a redraw keeps unsaved save-wide notes on the backup page', async () => {
  go('backup');
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
for (const kind of ['handbook', 'calculated'] as const)
  test(`the ${kind} backup page opens with its header, then the full-saves panel`, () => {
    open({ calculated: kind === 'calculated' });
    go('backup');
    render();
    const [first, second] = [...$('#main')!.children];
    assert.equal(first!.querySelector('h1')!.textContent, 'Backup & notes');
    assert.equal(second!.querySelector('h2')!.textContent, 'Full saves & transfer');
    assert.equal($$('#main h1').length, 1, 'one header');
  });

test('the handbook resources page shows every resource with its icon, and the power checks', async () => {
  go('resources');
  render();
  const rows = $$('#main tbody tr');
  const resources = Object.keys(handbook.resources['3']!);
  assert.equal(rows.length, resources.length);
  for (const row of rows) {
    const name = row.querySelector('.resource-name span')!.textContent;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.equal(
      row.querySelector('.resource-name img')!.getAttribute('src'),
      `./icons/${slug}.png`,
    );
  }
  assert.equal($$('[data-check^="power-"]').length, 9);
  assert.equal($<HTMLInputElement>('[data-check="power-u4"]')!.checked, false);
  open({ phase: '3' });
  const { state } = await import('../../public/app/session.ts');
  state.checks['power-u4'] = true;
  render();
  await nextTick();
  assert.equal(
    $<HTMLInputElement>('[data-check="power-u4"]')!.checked,
    true,
    'a saved check shows ticked',
  );
});

test('moving between pages leaves nothing behind', async () => {
  go('profiles');
  render();
  assert.equal($$('.profile-card').length, 2);
  go('factories');
  render();
  assert.equal($$('.profile-card').length, 0, 'the component page is gone');
  assert.equal($('#main h1')!.textContent, 'Factory targets');
  go('backup');
  render();
  assert.equal($$('#main h1').length, 1);
  assert.equal($('#main h1')!.textContent, 'Backup & notes');
  go('resources');
  render();
  assert.equal($$('#main h1').length, 1);
  assert.equal($('#main h1')!.textContent, 'Power & resources');
  // Any plan object means a calculated profile; the page reads none of its fields, and
  // #resources ignores the wizard draft.
  assert.equal(vuePage('resources', {} as StoredCalculatedPlan, null), CalculatedResourcesPage);
});

// A calculated profile's resources page, with the catalog's raw resources as the server
// sends them (the same list as the plan's budgets).
function openCalculatedResources(p: StoredCalculatedPlan) {
  // Only the field this page reads.
  open({
    calculated: p,
    workspace: { catalog: { raw: Object.keys(p.settings.limits) } as Catalog },
  });
  go('resources');
  render();
}

test('the calculated resources page shows every budget with its icon and what is left', () => {
  const p = generated();
  const x = p.stages['3'];
  const [first, second] = Object.keys(p.settings.limits);
  // One resource over budget.
  x.raw![first!] = p.settings.limits[first!]! + 10;
  x.surplus = {};
  openCalculatedResources(p);
  assert.equal($('#main h1')!.textContent, 'Power & resources');
  assert.equal($('#main .eyebrow')!.textContent, 'CHECK BEFORE EXPANDING');
  const rows = $$('#main tbody tr');
  assert.deepEqual(
    rows.map(r => r.querySelector('.resource-name span')!.textContent),
    Object.keys(p.settings.limits),
  );
  for (const row of rows) {
    const name = row.querySelector('.resource-name span')!.textContent;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.equal(
      row.querySelector('.resource-name img')!.getAttribute('src'),
      `./icons/${slug}.png`,
    );
  }
  const cells = (r: HTMLElement) =>
    [...r.querySelectorAll('td')].slice(1).map(td => td.textContent.trim());
  assert.equal(cells(rows[0]!)[2], '-10');
  assert.ok(rows[0]!.querySelectorAll('td')[3]!.classList.contains('warn'), 'over budget');
  assert.ok(!rows[1]!.querySelectorAll('td')[3]!.classList.contains('warn'), second + ' fits');
  // The four power tiles; somersloops and augmenters only when the plan uses them.
  assert.deepEqual(
    $$('#main .stat .eyebrow').map(e => e.textContent),
    ['New generation', 'Whole-machine peak', 'With utility allowance', 'Existing spare power'],
  );
  assert.equal(
    $$('#main .stat small')[2]!.textContent,
    '20% for transport and utilities; verify actual load',
  );
  assert.match($('#main .backup-grid')!.textContent, /No raw-resource conversion required\./);
  assert.match($('#main .backup-grid')!.textContent, /None credited in this phase\./);
  assert.match($('#main .backup-grid')!.textContent, /Surplus solids: None/);
});

test('the calculated resources page lists somersloops, augmenters, conversions and credits', () => {
  const p = generated();
  const x = p.stages['3'];
  Object.assign(x, {
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
  openCalculatedResources(p);
  noMarkup();
  const tiles = $$('#main .stat');
  assert.equal(tiles.length, 6);
  assert.equal(tiles[4]!.querySelector('strong')!.textContent, '12');
  assert.equal(tiles[5]!.querySelector('strong')!.textContent, '5 GW');
  assert.equal(
    tiles[5]!.querySelector('small')!.textContent,
    '2 augmenters · 100 MW plus 20% of base production',
  );
  assert.match($('#main .notice.warn')!.textContent, /Planning draft/);
  assert.ok($('#main .notice.warn')!.textContent.includes(evil), 'the reason is shown as text');
  const conversions = $$('#main .backup-grid .panel')[1]!.querySelector('p')!;
  assert.equal(conversions.querySelectorAll('br').length, 1);
  assert.equal(conversions.textContent.trim(), evil + 'Second conversion');
  assert.match($('#main .backup-grid')!.textContent, /Iron Plate 30\/min/);
  assert.match($('#main .backup-grid .small.muted')!.textContent, /does not build these lines/);
});

// Exactly what a profile calculated by an earlier release looks like: no existingSupply in
// its settings and no supplied on any stage.
test('the calculated resources page renders a plan saved before existing production existed', () => {
  const p: StoredCalculatedPlan = generated();
  delete p.settings.existingSupply;
  for (const stage of Object.values(p.stages)) delete stage.supplied;
  openCalculatedResources(p);
  assert.equal($$('#main tbody tr').length, Object.keys(p.settings.limits).length);
  assert.match($('#main .backup-grid')!.textContent, /None credited in this phase\./);
  assert.doesNotMatch($('#main .backup-grid')!.textContent, /does not build these lines/);
});

// Opening the handbook from a calculated profile's page: anything that redraws before render()
// swaps the page (a save finishing, the save indicator) reaches the calculated page and dialog
// once more, with no calculated plan open.
test('a calculated page survives a redraw after the handbook is opened', async () => {
  const errors: unknown[] = [];
  const onError = (e: { reason?: unknown; error?: unknown }) => errors.push(e.reason ?? e.error);
  process.on('unhandledRejection', onError);
  try {
    for (const view of ['plan', 'factories', 'logistics', 'storage', 'resources'] as const) {
      page();
      const plan = generated();
      open({ calculated: plan });
      go(view);
      render();
      openCalculatedFactory(plan.stages['3'].rows![0]!.id);
      open();
      invalidate();
      await nextTick();
      await new Promise(r => setTimeout(r, 0));
      render();
      await nextTick();
      assert.ok($('#main h1'), view + ' shows the handbook page after render()');
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
    const r: { result: T; onsuccess?: () => void; onerror?: () => void } = { result };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction: () => ({ objectStore: () => ({ get: () => request(record) }) }),
  };
  Object.assign(globalThis, { indexedDB: { open: () => request(db) } });
  let saved: Blob | undefined;
  URL.createObjectURL = (b: Blob | MediaSource) => ((saved = b as Blob), 'blob:x');
  URL.revokeObjectURL = () => {};
  button.click();
  await new Promise(r => setTimeout(r));
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
