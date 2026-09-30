// The sidebar footer as a profile switcher (SP-07, #242, Shell.vue): a menu button naming the
// open profile, whose menu (ui/ActionMenu.vue) lists the open save's profiles, "All saves &
// profiles", and Account / Sign out on the server. A profile opens through openProfile in
// ui/actions.ts, as the profiles page's Open does, so unsaved notes are asked about first.
// The browser edition's "Backup" in place of the account items is checked in a real
// browser (browserMode is fixed when browser-api.ts loads).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { acceptRoute } from '../../public/app/api.ts';
import {
  currentProfile,
  setView,
  state,
  stateLoaded,
  view,
  viewOf,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, answerConfirms, evil, go, handbook, open, page, stubFetch } from './setup.ts';
import type { ContextReply, WorkspaceSummary } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const key = (name: string) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
const focused = () => (document.activeElement as HTMLElement | null)?.textContent?.trim();
const trigger = () => $<HTMLButtonElement>('[data-profile-switcher]')!;
const menu = () => $('#profile-switcher')!;

// The hashchange listener of listeners.ts, which these tests do not load.
const onHash = () => {
  if (!acceptRoute()) return;
  setView(viewOf(location.hash.slice(1)));
  if (stateLoaded) render();
};
beforeAll(() => window.addEventListener('hashchange', onHash));
afterAll(() => window.removeEventListener('hashchange', onHash));

// Three profiles in the open save, the handbook one open; another save's profile is not listed.
const saves = (accountsEnabled = false): Partial<WorkspaceSummary> => ({
  accountsEnabled,
  saves: [
    {
      id: 's',
      name: evil,
      activeProfile: 'original',
      profiles: [
        { id: 'original', kind: 'original', name: evil, completed: 2, phase: '3' },
        { id: 'copy', kind: 'original', name: 'Second try', completed: 0, phase: '3' },
        { id: 'third', kind: 'original', name: 'Third try', completed: 0, phase: '3' },
      ],
    },
    {
      id: 'other',
      name: 'Other save',
      activeProfile: 'elsewhere',
      profiles: [
        { id: 'elsewhere', kind: 'original', name: 'Elsewhere', completed: 0, phase: '3' },
      ],
    },
  ],
});
// What /api/select answers: the workspace, with the chosen profile active.
const summary = () => ({ user: { id: 'owner', username: 'Pioneer' }, catalog: {}, ...saves() });
const opened = (id: string, name: string): ContextReply => ({
  save: { id: 's', name: evil },
  profile: { id, kind: 'original', name },
  state: structuredClone(state),
  plan: null,
  handbook,
});

beforeEach(() => {
  page();
  open({ workspace: saves() });
  answerConfirms(true);
  history.replaceState(null, '', '#storage');
  acceptRoute();
  go('storage');
});

test('the footer is a menu button naming the open profile, with the save’s profiles', async () => {
  render();
  const button = trigger();
  assert.equal(button.closest('.sidebar-foot') !== null, true, 'it is the sidebar footer');
  assert.ok(button.textContent!.startsWith(evil), 'the footer names the open profile');
  assert.equal(button.querySelectorAll('br').length, 3, 'the settings lines stay on the button');
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), null, 'its own text names it');
  assert.equal(button.hasAttribute('disabled'), false);
  assert.equal(menu().hidden, true);
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');

  const radios = $$('#profile-switcher [role="menuitemradio"]');
  assert.deepEqual(
    radios.map(b => b.textContent!.trim()),
    [evil + 'Open', 'Second try', 'Third try'],
    'the open save’s profiles only, the open one marked',
  );
  assert.deepEqual(
    radios.map(b => b.getAttribute('aria-checked')),
    ['true', 'false', 'false'],
  );
  assert.equal(
    $('#profile-switcher [role="group"]')!.getAttribute('aria-label'),
    'Profiles in ' + evil,
  );
  assert.deepEqual(
    $$('#profile-switcher [role="menuitem"]').map(b => b.textContent!.trim()),
    ['All saves & profiles', 'Set up user accounts'],
    'no Sign out while accounts are off',
  );
  assert.ok(
    $$('#profile-switcher [role^="menuitem"]').every(b => b.tabIndex === -1),
    'the arrow keys move between items, not Tab',
  );

  open({ workspace: saves(true) });
  render();
  await nextTick();
  assert.deepEqual(
    $$('#profile-switcher [role="menuitem"]').map(b => b.textContent!.trim()),
    ['All saves & profiles', 'Account', 'Sign out'],
  );
});

test('the switcher works from the keyboard like the other menus', async () => {
  render();
  const button = trigger();
  button.focus();
  button.click();
  await nextTick();
  assert.equal(menu().hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(focused(), evil + 'Open', 'it opens on the first profile');
  key('ArrowDown');
  assert.equal(focused(), 'Second try');
  key('End');
  assert.equal(focused(), 'Set up user accounts');
  key('ArrowDown');
  assert.equal(focused(), evil + 'Open', 'the arrows wrap');
  key('Escape');
  await nextTick();
  assert.equal(menu().hidden, true);
  assert.equal(document.activeElement === button, true, 'Escape hands focus back');
  key('ArrowUp');
  await nextTick();
  assert.equal(focused(), 'Set up user accounts', 'ArrowUp opens on the last item');
  key('Tab');
  await nextTick();
  assert.equal(menu().hidden, true, 'Tab closes it');
});

test('choosing a profile opens it the way Open profile does, and focus stays on the switcher', async () => {
  const calls = stubFetch({
    '/api/select': summary(),
    '/api/context': opened('copy', 'Second try'),
  });
  render();
  trigger().focus();
  trigger().click();
  await nextTick();
  $('[data-switch-profile="copy"]')!.click();
  await settle();
  await settle();
  assert.deepEqual(calls[0], ['/api/select', { saveId: 's', profileId: 'copy' }]);
  assert.equal(calls[1]![0].startsWith('/api/context'), true);
  assert.equal(currentProfile.id, 'copy');
  assert.equal(view, 'plan', 'its plan opens, as from Saves & profiles');
  assert.equal(location.hash, '#plan');
  assert.equal(menu().hidden, true);
  assert.ok(trigger().textContent!.startsWith('Second try'), 'the footer names the new profile');
  assert.equal(document.activeElement === trigger(), true, 'the frame stays, so focus does');
});

test('the open profile is only a mark: choosing it changes nothing', async () => {
  const calls = stubFetch({});
  render();
  trigger().click();
  await nextTick();
  $('[data-switch-profile="original"]')!.click();
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(view, 'storage');
  assert.equal(menu().hidden, true);
});

test('switching asks about a note that could not be saved, and stays when kept', async () => {
  // /api/update is not in the table, so the note's save fails.
  const calls = stubFetch({
    '/api/select': summary(),
    '/api/context': opened('copy', 'Second try'),
  });
  const asked = answerConfirms(false);
  go('notes');
  history.replaceState(null, '', '#notes');
  acceptRoute();
  render();
  const note = $<HTMLTextAreaElement>('#phase-note-3')!;
  note.value = 'Not yet saved';
  note.dispatchEvent(new Event('input', { bubbles: true }));
  note.dispatchEvent(new Event('blur'));
  await settle();
  await settle();
  assert.equal(calls.at(-1)![0], '/api/update');
  trigger().focus();
  trigger().click();
  await nextTick();
  $('[data-switch-profile="copy"]')!.click();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /could not be saved/);
  assert.equal(
    calls.some(c => c[0] === '/api/select'),
    false,
    'kept: nothing is switched',
  );
  assert.equal(currentProfile.id, 'original');
  assert.equal($<HTMLTextAreaElement>('#phase-note-3')!.value, 'Not yet saved');

  // Leaving anyway switches.
  answerConfirms(true);
  trigger().click();
  await nextTick();
  $('[data-switch-profile="copy"]')!.click();
  await vi.waitFor(() => assert.equal(currentProfile.id, 'copy'));
});

test('the switcher is busy while a profile opens, and a failure keeps the open one', async () => {
  let reply: (response: Response) => void = () => {};
  globalThis.fetch = () => new Promise<Response>(resolve => (reply = resolve));
  render();
  const button = trigger();
  button.focus();
  button.click();
  await nextTick();
  $('[data-switch-profile="third"]')!.click();
  await vi.waitFor(() => assert.equal(button.getAttribute('aria-disabled'), 'true'));
  assert.equal(button.hasAttribute('disabled'), false, 'busy, not disabled (#299)');
  assert.equal(document.activeElement === button, true);
  button.click();
  await nextTick();
  assert.equal(menu().hidden, true, 'a busy switcher does not open');
  reply(new Response(JSON.stringify({ error: 'The server is away' }), { status: 500 }));
  await vi.waitFor(() => assert.equal(button.getAttribute('aria-disabled'), null));
  assert.match($('#toast')!.textContent!, /The server is away/);
  assert.equal(currentProfile.id, 'original');
  assert.equal(view, 'storage');
});

test('All saves & profiles and Account follow the address, like a sidebar link', async () => {
  render();
  trigger().click();
  await nextTick();
  $('[data-switch-page="profiles"]')!.click();
  await settle();
  assert.equal(location.hash, '#profiles');
  assert.equal(view, 'profiles');
  assert.equal($('#main h1')!.textContent, 'Saves & profiles');
  assert.equal(document.activeElement === trigger(), true);
  trigger().click();
  await nextTick();
  $('[data-switch-page="account"]')!.click();
  await settle();
  assert.equal(view, 'account');
  assert.equal($('#main h1')!.textContent, 'User accounts');
});

test('Sign out signs out as the account page does', async () => {
  open({ workspace: saves(true) });
  const calls = stubFetch({
    '/api/logout': {},
    '/api/workspace': { user: null, registration: false },
  });
  render();
  trigger().click();
  await nextTick();
  $('[data-switch-logout]')!.click();
  await settle();
  await settle();
  assert.deepEqual(
    calls.map(c => c[0]),
    ['/api/logout', '/api/workspace'],
  );
  await vi.waitFor(() => assert.ok($('#auth-form'), 'the sign-in form is shown'));
  assert.equal($('.layout'), null, 'the frame is gone');
});

test('a failed sign-out from the switcher says so and leaves the user signed in', async () => {
  open({ workspace: saves(true) });
  const calls = stubFetch({}); // /api/logout answers 500
  render();
  trigger().click();
  await nextTick();
  $('[data-switch-logout]')!.click();
  await settle();
  assert.deepEqual(
    calls.map(c => c[0]),
    ['/api/logout'],
  );
  assert.ok($('#toast')!.classList.contains('error'));
  assert.ok($('.layout'), 'still signed in');
});
