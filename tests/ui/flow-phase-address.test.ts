// A group's flow page keeps its phase in its address (#926): "Build order →" links to
// #factories/<group>/flow?phase=<the phase shown>, so the page opened in a new tab, bookmarked
// or reloaded shows the build order of the phase it was opened from, not the phase the profile
// opens on (#570). The phase is only shown, never saved, as the opening phase is; an unknown
// phase, or one after the working phase, falls back to the phase shown before; an address from
// before #926 (no ?phase=) still opens the page. "← Factories" then shows the factories page in
// that phase, with focus back on the group's "Build order →" (#917).
// The profile is the planner's default, made for Phase 3, with Phase 1's milestones still open,
// so it opens on Phase 1, a milestone-only phase without the group's lines (the issue's repro).
// The hashchange listener is the app's own (listeners.ts). The focused element is compared by
// what identifies it, never two elements with assert.equal (#287).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeAll, beforeEach, test } from 'vitest';
import {
  boot,
  flowPhaseOf,
  flowRoute,
  openedFrom,
  phase,
  setQuery,
  state,
  stateLoaded,
} from '../../public/app/session.ts';
import { initialState } from '../../public/state.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  catalog,
  generated,
  page,
  stubFetch,
} from './setup.ts';
import type {
  ContextReply,
  FactoryGroups,
  Phase,
  UpdateOp,
  WorkspaceSummary,
} from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const GROUP = 'fg-iron01';
const progression: unknown = JSON.parse(fs.readFileSync('public/progression.json', 'utf8'));

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const describeFocus = () => document.activeElement?.outerHTML.slice(0, 120) ?? 'null';
const flowLink = (groupId = GROUP) => $<HTMLAnchorElement>(`#main [data-group-flow="${groupId}"]`);
const subtitle = () => $('#main .subtitle')?.textContent?.trim() ?? '';
const cards = () => $$('#main .gf-card').length;
// Follows a route the way a link, a typed address or Back does: the address changes and the
// app's hashchange listener draws the page.
async function follow(hash: string) {
  location.hash = hash;
  await settle();
}

// Opens the app on `hash` the way a new tab, a bookmark or a reload does: boot() with the
// profile saved on `saved` and Phase 1's milestones open. Returns the requests made.
async function load(hash: string, saved: Phase = '3') {
  page();
  history.replaceState(null, '', '#' + hash);
  const workspace = {
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: catalog(),
    activeSave: 's',
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'p',
        profiles: [
          {
            id: 'p',
            kind: 'calculated',
            name: 'Main',
            completed: 0,
            phase: saved,
            settings: plan.settings,
          },
        ],
      },
    ],
  } as WorkspaceSummary;
  const context: ContextReply = {
    save: { id: 's', name: 'World' },
    profile: { id: 'p', kind: 'calculated', name: 'Main' },
    state: {
      ...initialState(),
      version: 3,
      settings: { phase: saved },
      factoryGroups: structuredClone(groups),
    },
    plan: structuredClone(plan),
  };
  const calls = stubFetch({
    '/api/workspace': workspace,
    '/api/context': context,
    '/progression.json': progression,
    '/api/update': (update: UpdateOp) => applyUpdate(update),
  });
  await boot();
  await settle();
  return calls;
}
const writes = (calls: [string, unknown][]) =>
  calls.filter(([path]) => path.startsWith('/api/update'));

// Runs `steps` with history.replaceState behaving as in a browser: happy-dom fires a hashchange
// when replaceState changes the hash, which browsers never do (#991). That extra event runs the
// app's hashchange listener, which records the new address as the page on screen (acceptRoute
// in api.ts) and so hides whether the app recorded it itself. happy-dom dispatches the event
// later through window.dispatchEvent, with the change's old and new address, so each change
// replaceState makes is noted and its event dropped there.
async function withBrowserReplaceState(steps: () => Promise<void>) {
  const replace = history.replaceState,
    dispatch = window.dispatchEvent,
    replaced: string[] = [];
  history.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    const oldURL = location.href;
    replace.call(history, data, unused, url);
    if (location.hash !== new URL(oldURL).hash) replaced.push(`${oldURL} ${location.href}`);
  };
  window.dispatchEvent = function (event: Event) {
    const change = event instanceof HashChangeEvent ? `${event.oldURL} ${event.newURL}` : null;
    const index = change === null ? -1 : replaced.indexOf(change);
    if (index < 0) return dispatch.call(window, event);
    replaced.splice(index, 1);
    return true;
  };
  try {
    await steps();
  } finally {
    history.replaceState = replace;
    window.dispatchEvent = dispatch;
  }
}

beforeAll(async () => {
  page();
  // The hashchange listener is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
});
beforeEach(() => setQuery(''));

// First, while no profile is loaded: the link then names no phase, which is still a flow page's
// address (one from before #926), rather than reading a phase that is not there.
test('before a profile is loaded, a flow page’s address names no phase', async () => {
  assert.equal(stateLoaded, false, 'this file has not loaded a profile yet');
  assert.equal(flowRoute(GROUP), `factories/${GROUP}/flow`);
  assert.equal(flowRoute(GROUP, '2'), `factories/${GROUP}/flow?phase=2`, 'a phase given is kept');
  // Signed out (boot() blanks the state) it names none either.
  await load('factories');
  assert.equal(flowRoute(GROUP), `factories/${GROUP}/flow?phase=1`, 'loaded: the phase shown');
  page();
  stubFetch({ '/api/workspace': { user: null, accountsEnabled: true, saves: [] } });
  await boot();
  assert.equal(stateLoaded, false);
  assert.equal(flowRoute(GROUP), `factories/${GROUP}/flow`);
});

test('the profile opens on Phase 1 without an address phase, as in the issue', async () => {
  await load('factories');
  assert.equal(phase(), '1', 'Phase 1 still has open milestones (#570)');
  assert.equal(flowLink(), null, 'the milestone-only Phase 1 has no build order to link');
});

test('"Build order →" carries the phase shown, and follows the phase picked', async () => {
  await load('factories');
  $<HTMLButtonElement>('[data-go-to-start-phase]')!.click();
  await settle();
  assert.equal(phase(), '3');
  assert.equal(flowLink()?.getAttribute('href'), `#factories/${GROUP}/flow?phase=3`);
  const picker = $<HTMLSelectElement>('#phase-picker')!;
  picker.value = '4';
  picker.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(phase(), '4');
  assert.equal(flowLink()?.getAttribute('href'), `#factories/${GROUP}/flow?phase=4`);
});

test('the link followed in the same tab shows that phase’s build order', async () => {
  await load('factories');
  $<HTMLButtonElement>('[data-go-to-start-phase]')!.click();
  await settle();
  await follow(flowLink()!.getAttribute('href')!);
  assert.match(subtitle(), /^Phase 3 · \d+ lines? in the order to build them/);
  assert.ok(cards() > 0, 'the group’s lines are drawn');
});

test('opened in a new tab or reloaded, the address’s phase is shown, not the opening phase', async () => {
  const calls = await load(`factories/${GROUP}/flow?phase=3`);
  assert.equal(phase(), '3', 'Phase 3, not the Phase 1 the profile opens on');
  assert.match(subtitle(), /^Phase 3 · \d+ lines? in the order to build them/);
  assert.ok(cards() > 0, 'the group’s lines are drawn');
  assert.equal($('[data-milestone-only]'), null, 'no "Go to Phase 3" notice');
  assert.equal($<HTMLSelectElement>('#phase-picker')?.value, '3', 'the phase picker agrees');
  assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`);
  assert.deepEqual(writes(calls), [], 'opening the address writes nothing');
  assert.equal(state.settings.phase, '3');
});

test('an earlier phase in the address is shown, never saved', async () => {
  const calls = await load(`factories/${GROUP}/flow?phase=3`, '4');
  assert.equal(phase(), '3');
  assert.match(subtitle(), /^Phase 3 · /);
  assert.equal(state.settings.phase, '4', 'the working phase stays Phase 4');
  assert.equal(openedFrom(), '4', 'the other pages say Phase 4 is the working phase');
  assert.deepEqual(writes(calls), []);
});

test('an unknown or unavailable phase falls back to the phase the profile opens on', async () => {
  for (const named of ['9', 'banana', '', '5', 'post']) {
    await load(`factories/${GROUP}/flow?phase=${named}`);
    assert.equal(phase(), '1', `?phase=${named}: the opening phase, as before`);
    assert.ok($('[data-gf-back]'), `?phase=${named}: the flow page is drawn`);
    assert.ok($('[data-milestone-only]'), `?phase=${named}: with the milestone-only notice`);
    assert.equal(flowPhaseOf(location.hash.slice(1)), '1', 'the address names the phase shown');
  }
  // In a tab that shows Phase 3, an unknown phase leaves it on Phase 3.
  await load(`factories/${GROUP}/flow?phase=3`);
  await follow(`factories/${GROUP}/flow?phase=x`);
  assert.equal(phase(), '3');
  assert.match(subtitle(), /^Phase 3 · /);
  assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`);
});

test('"← Factories" goes to the factories page in that phase, focus on the group’s link', async () => {
  await load(`factories/${GROUP}/flow?phase=3`);
  const back = $('[data-gf-back]')!;
  assert.equal(back.getAttribute('href'), '#factories');
  back.focus();
  await follow('factories');
  assert.equal(phase(), '3', 'the factories page shows Phase 3');
  assert.equal($('[data-milestone-only]'), null);
  assert.ok(flowLink(), 'the group and its "Build order →" are shown');
  assert.equal(
    (document.activeElement as HTMLElement | null)?.dataset.groupFlow,
    GROUP,
    describeFocus(),
  );
});

test('an address from before #926 still opens the flow page, and then keeps its phase', async () => {
  await load(`factories/${GROUP}/flow`);
  assert.ok($('[data-gf-back]'), 'the flow page is drawn');
  assert.equal(phase(), '1', 'on the phase the profile opens on, as before');
  assert.equal(location.hash, `#factories/${GROUP}/flow?phase=1`, 'the address names it');
  // Its "Go to Phase 3" shows Phase 3, and the address follows, so a reload stays there.
  $<HTMLButtonElement>('[data-go-to-start-phase]')!.click();
  await settle();
  assert.equal(phase(), '3');
  assert.match(subtitle(), /^Phase 3 · /);
  assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`);
  // Followed in a tab that shows Phase 3, the old address shows Phase 3.
  await follow('factories');
  await follow(`factories/${GROUP}/flow`);
  assert.equal(phase(), '3');
  assert.match(subtitle(), /^Phase 3 · /);
  assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`);
});

// The address render() rewrites is the page on screen (#973's review): keeping a note that was
// not saved on Back puts that address back, so it still names the phase shown, and a reload then
// shows that phase. In a browser replaceState fires no hashchange, so only the app itself can
// record the rewritten address (withBrowserReplaceState, #991).
test('keeping an unsaved note on Back puts back the address of the phase shown', async () => {
  await withBrowserReplaceState(async () => {
    await load('plan');
    await follow(`factories/${GROUP}/flow?phase=1`);
    assert.equal(phase(), '1');
    assert.ok($('[data-milestone-only]'), 'Phase 1 is milestone-only');
    $<HTMLButtonElement>('[data-go-to-start-phase]')!.click();
    await settle();
    assert.equal(phase(), '3');
    assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`, 'the address follows');
    const drawn = cards();
    assert.ok(drawn > 0, 'the group’s lines are drawn');
    // A card's ↗, and a note in its dialog whose write fails.
    $<HTMLButtonElement>('#main .gf-card .gf-head .rail-link')!.click();
    await settle();
    stubFetch({
      '/api/update': () => {
        throw new Error('offline');
      },
    });
    const note = $<HTMLTextAreaElement>('#detail-note')!;
    note.value = 'Belt the screws';
    note.dispatchEvent(new Event('input'));
    note.dispatchEvent(new Event('blur'));
    await settle();
    assert.match($('#detail-note-status')?.textContent ?? '', /^Not saved/);
    // Back, and Cancel in "Leave without saving?".
    const asked = answerConfirms(false);
    await follow('plan');
    await settle();
    assert.equal(asked.length, 1, 'the leave question was asked');
    assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`, 'the address of Phase 3');
    assert.equal(phase(), '3');
    assert.equal(cards(), drawn, 'the page stays as it was');
    // Drop the note, so no draft waits for a later test's box (#864).
    stubFetch({ '/api/update': (update: UpdateOp) => applyUpdate(update) });
    note.value = '';
    note.dispatchEvent(new Event('input'));
    note.dispatchEvent(new Event('blur'));
    await settle();
  });
  // A reload of that address shows Phase 3, not the Phase 1 the profile opens on.
  await load(location.hash.slice(1));
  assert.equal(phase(), '3');
  assert.match(subtitle(), /^Phase 3 · /);
  assert.equal($('[data-milestone-only]'), null);
});
