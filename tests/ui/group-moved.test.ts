// #1052: each tab keeps the save and profile it opened. The server remembers only the one the
// user opened last (activeSave and each save's activeProfile), which a new tab opens; a reload
// opens the tab's own again, every write names the profile the tab shows, and a tab whose user
// opened another profile elsewhere says so, with "Open …" to follow and "Stay on …".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { refreshWorkspace, save } from '../../public/app/api.ts';
import { boot, currentProfile, currentSave, setView, view } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, catalog, evil, migratedPlan, page } from './setup.ts';
import type { WorkspaceSummary } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const TAB_KEY = 'planner-tab-profile';
const plan = migratedPlan();
const profileSummary = (id: string, name: string) => ({
  id,
  kind: 'calculated' as const,
  name,
  completed: 0,
  phase: '3' as const,
  settings: plan.settings,
});

// The stand-in server: one save with "Main" and a copy, and the user's active pair, which the
// test moves as another tab would. It records each request with the profile it names.
let summary: WorkspaceSummary;
let sent: { path: string; profile: string | undefined }[];
const names: Record<string, string> = { main: 'Main', copy: 'Main · copy ' + evil };
function server() {
  sent = [];
  summary = {
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: catalog(),
    activeSave: 's',
    saves: [
      {
        id: 's',
        name: 'Coop world',
        activeProfile: 'main',
        profiles: [profileSummary('main', names.main!), profileSummary('copy', names.copy!)],
      },
    ],
  } as WorkspaceSummary;
  const progression = fs.readFileSync('public/progression.json', 'utf8');
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const route = String(path);
    const url = new URL(route, 'http://planner');
    const headers = (options.headers ?? {}) as Record<string, string>;
    const profile = headers['X-Profile-Id'] ?? url.searchParams.get('profile') ?? undefined;
    sent.push({ path: url.pathname, profile });
    const json = (data: unknown) => new Response(JSON.stringify(data));
    if (url.pathname === '/api/workspace') return json(summary);
    if (url.pathname === '/progression.json') return new Response(progression);
    if (url.pathname === '/api/select') {
      const body = JSON.parse(String(options.body)) as { profileId: string };
      move(body.profileId);
      return json(summary);
    }
    const state = {
      version: 1,
      revision: 0,
      settings: { phase: '3' },
      checks: {},
      notes: {},
      deliveries: {},
      customTasks: [],
    };
    if (url.pathname === '/api/context')
      return json({
        save: { id: 's', name: 'Coop world' },
        profile: { id: profile, kind: 'calculated', name: names[profile!] },
        state,
        plan,
      });
    if (url.pathname === '/api/update') return json(state);
    return new Response(JSON.stringify({ error: 'unexpected ' + route }), { status: 500 });
  };
}
// Another tab or device opens a profile: the server's active pair moves.
const move = (profile: string) => (summary.saves[0]!.activeProfile = profile);
const notice = () => $('[data-group-moved]');
async function start() {
  await boot();
  setView(view);
  render();
  await settle();
}

beforeEach(() => {
  page();
  sessionStorage.clear();
  server();
});

test('a new tab opens the profile the user opened last, and remembers it', async () => {
  move('copy');
  await start();
  assert.equal(currentProfile.id, 'copy');
  assert.equal(notice(), null, 'nothing moved');
  assert.deepEqual(JSON.parse(sessionStorage.getItem(TAB_KEY)!), {
    user: 'owner',
    save: 's',
    profile: 'copy',
  });
});

test('a reload opens the tab’s own profile, and says where the others went', async () => {
  await start();
  assert.equal(currentProfile.id, 'main');
  // Another player duplicates Main and is moved to the copy.
  move('copy');
  // This tab, still on Main, ticks a box: the write names Main.
  sent = [];
  await save({ type: 'check', key: 'k', value: true });
  assert.deepEqual(
    sent.filter(request => request.path === '/api/update').map(request => request.profile),
    ['main'],
  );
  // A reload stays on Main.
  page();
  await start();
  assert.equal(currentProfile.id, 'main', 'the tab keeps its own profile');
  const shown = notice()!;
  assert.ok(shown.classList.contains('warn'));
  assert.match(shown.textContent!, /Another tab or player moved to “Main · copy <x-evil/);
  assert.match(
    shown.textContent!,
    /This tab stays on “Main”, and what you change here is saved to “Main”/,
  );
  assert.equal(document.querySelector('x-evil'), null, 'the name is text');
  assert.equal(shown.closest('[role="status"]')?.getAttribute('aria-live'), 'polite');
  // ADA leads with it too.
  adaClearFault();
  setAdaIndex(0);
  assert.equal(adaCurrent()!.id, 'group-moved');
});

test('coming back to the tab finds the move, and Stay keeps the tab where it is', async () => {
  await start();
  assert.equal(notice(), null);
  move('copy');
  assert.equal(await refreshWorkspace(), true);
  await settle();
  assert.ok(notice(), 'the summary asked again shows the move');
  $<HTMLButtonElement>('[data-group-stay]')!.click();
  await settle();
  assert.equal(notice(), null);
  assert.equal(currentProfile.id, 'main');
  assert.ok(!sent.some(request => request.path === '/api/select'), 'staying changes nothing saved');
  assert.equal(JSON.parse(sessionStorage.getItem(TAB_KEY)!).stay, 's/copy');
  // A reload does not ask again about that move; a later move asks again.
  page();
  await start();
  assert.equal(notice(), null);
  move('main');
  summary.saves[0]!.profiles.push(profileSummary('third', 'Third'));
  names.third = 'Third';
  move('third');
  page();
  await start();
  assert.match(notice()!.textContent!, /moved to “Third”/);
});

test('Open follows the others to their profile', async () => {
  await start();
  move('copy');
  page();
  await start();
  $<HTMLButtonElement>('[data-group-follow]')!.click();
  await settle();
  setView(view);
  render();
  await settle();
  assert.equal(currentProfile.id, 'copy');
  assert.equal(currentSave.id, 's');
  assert.equal(notice(), null);
  assert.equal(JSON.parse(sessionStorage.getItem(TAB_KEY)!).profile, 'copy');
});

test('a remembered profile that is gone, or another user’s, falls back to the active one', async () => {
  sessionStorage.setItem(TAB_KEY, JSON.stringify({ user: 'owner', save: 's', profile: 'gone' }));
  await start();
  assert.equal(currentProfile.id, 'main');
  sessionStorage.setItem(TAB_KEY, JSON.stringify({ user: 'friend', save: 's', profile: 'copy' }));
  page();
  await start();
  assert.equal(currentProfile.id, 'main');
  sessionStorage.setItem(TAB_KEY, '{not json');
  page();
  await start();
  assert.equal(currentProfile.id, 'main');
});
