// Viewing a phase is not working on it (#1053). The phase picker (the phase track, and the select
// at phone widths) only shows a phase in this tab: nothing is saved, so other tabs, other devices
// and a reload still go by the saved working phase. "Work on Phase N" beside the picker saves the
// phase shown as the working phase (`save({ type: 'phase' })`, as before). The track is a tab list
// with manual activation: the arrow keys, Home and End move focus and show nothing; Enter, Space or
// a click shows the phase focused. A reload or a new tab (boot) opens the working phase, though an
// earlier phase still has open steps (#570 is for opening a profile). The milestone-only notice,
// with "Go to Phase N", is on Logistics and Storage too.
//
// Each test runs against both editions: the browser edition's own request handler
// (createBrowserApi, browser-api.ts, with its workspace in memory) and a stand-in for the Docker
// server that keeps the profile's progress between requests and applies each update with the
// server's `mutate`, as /api/update does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeAll, beforeEach, describe, test } from 'vitest';
import { phaseToOpen } from '../../public/app/opening-phase.ts';
import {
  boot,
  currentProfile,
  currentSave,
  loadContext,
  openedFrom,
  phase,
  progressionData,
  setQuery,
  workingPhaseNotShown,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { createBrowserApi } from '../../public/browser-api.ts';
import { initialState, mutate } from '../../public/state.ts';
import { $, $$, catalog, generated, go, page } from './setup.ts';
import type {
  BrowserWorkspace,
  ContextReply,
  CurrentCalculatedPlan,
  ProgressState,
  UpdateOp,
  WorkspaceSummary,
} from '../../public/types/index.ts';

const progression: unknown = JSON.parse(fs.readFileSync('public/progression.json', 'utf8'));
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';
const tab = (phaseKey: string) =>
  $<HTMLButtonElement>(`[data-phase-track] [data-phase-seg="${phaseKey}"]`)!;
const key = (keyName: string) =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }),
  );
const focusedPhase = () => document.activeElement?.getAttribute('data-phase-seg');

// The planner's default profile is made for Phase 3, and Phase 1's milestones are open, so opening
// it shows Phase 1 (#570).
let plan: CurrentCalculatedPlan;
beforeAll(() => {
  plan = generated();
  assert.equal(plan.settings.phase, '3');
});
beforeEach(() => {
  page();
  setQuery('');
  history.replaceState(null, '', '#plan');
});

// One edition's backend: `fetch` answers the app's requests, `savedPhase()` is the working phase
// it has stored, and `updates` the /api/update requests it was sent.
interface Backend {
  updates: UpdateOp[];
  savedPhase(): string | undefined;
}

// The browser edition's request handler, with the profile made through it.
async function browserEdition(): Promise<Backend> {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(
    store,
    () => structuredClone(plan),
    catalog(),
    undefined,
    undefined,
    progression as typeof progressionData,
  );
  const updates: UpdateOp[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const route = String(input);
    if (route === '/progression.json') return new Response(JSON.stringify(progression));
    if (route.startsWith('/api/update')) updates.push(JSON.parse(String(options.body)));
    try {
      const reply = await api(route, {
        body: options.body ?? null,
        headers: { ...(options.headers as Record<string, string> | undefined) },
      });
      return new Response(JSON.stringify(reply), { status: 200 });
    } catch (error) {
      const { message, status } = error as Error & { status?: number };
      return new Response(JSON.stringify({ error: message }), { status: status ?? 400 });
    }
  };
  await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'World', name: 'Main', settings: { phase: '3' } }),
    headers: {},
  });
  updates.length = 0;
  return { updates, savedPhase: () => data.saves[0]?.profiles[0]?.state.settings.phase };
}

// A stand-in for the Docker server: the workspace summary, the profile's context and its progress,
// which each /api/update changes with the server's own `mutate`.
async function dockerEdition(): Promise<Backend> {
  let progress: ProgressState = { ...initialState(), settings: { phase: '3' } };
  const updates: UpdateOp[] = [];
  const workspace = (): WorkspaceSummary =>
    ({
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
              phase: progress.settings.phase,
              settings: plan.settings,
            },
          ],
        },
      ],
    }) as WorkspaceSummary;
  globalThis.fetch = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const route = String(input);
    let reply: unknown;
    if (route === '/progression.json') reply = progression;
    else if (route.startsWith('/api/workspace')) reply = workspace();
    else if (route.startsWith('/api/context'))
      reply = {
        save: { id: 's', name: 'World' },
        profile: { id: 'p', kind: 'calculated', name: 'Main' },
        state: structuredClone(progress),
        plan: structuredClone(plan),
      } satisfies ContextReply;
    else if (route.startsWith('/api/update')) {
      const update = JSON.parse(String(options.body)) as UpdateOp;
      updates.push(update);
      reply = progress = mutate(structuredClone(progress), update);
    } else return new Response(JSON.stringify({ error: 'unexpected ' + route }), { status: 500 });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return { updates, savedPhase: () => progress.settings.phase };
}

// Opens the app the way a reload or a new tab does.
async function reload() {
  page();
  await boot();
  await settle();
}

describe.each([
  ['Docker edition', dockerEdition],
  ['browser edition', browserEdition],
])('%s', (_edition, backend) => {
  test('a reload opens the working phase, though Phase 1 still has open steps', async () => {
    await backend();
    await reload();
    assert.equal(phaseToOpen(), '1', 'opening the profile would show Phase 1 (#570)');
    assert.equal(phase(), '3', 'the reload shows the working phase');
    assert.equal(workingPhaseNotShown(), null);
    assert.equal(text($('[data-phase-picker-label]')), 'Working on');
    assert.equal($('[data-work-on-phase]'), null);
    assert.equal($('[data-opened-earlier]'), null);
  });

  test('a click on a phase shows it without saving; a reload opens the working phase again', async () => {
    const server = await backend();
    await reload();
    tab('4').click();
    await settle();
    assert.equal(phase(), '4', 'Phase 4 is shown');
    assert.deepEqual(server.updates, [], 'nothing is saved');
    assert.equal(server.savedPhase(), '3');
    assert.equal(openedFrom(), null, 'a phase picked to look at, not one the profile opened on');
    assert.equal(text($('[data-phase-picker-label]')), 'Showing');
    assert.equal(tab('4').getAttribute('aria-selected'), 'true');
    assert.ok(tab('3').classList.contains('working'), 'the working phase stays marked');
    assert.equal(text($('[data-work-on-phase]')), 'Work on Phase 4');
    // The build plan names the working phase and offers it back, writing nothing.
    assert.equal(text($('[data-opened-earlier]')), 'You are working on Phase 3. Go to Phase 3');
    // The highlighted tab is the working phase's way back too.
    tab('3').click();
    await settle();
    assert.equal(phase(), '3');
    assert.equal($('[data-work-on-phase]'), null);
    tab('5').click();
    await settle();
    assert.equal(phase(), '5');
    await reload();
    assert.equal(phase(), '3', 'a reload opens the working phase, not the phase looked at');
    assert.deepEqual(server.updates, []);
  });

  test('"Work on Phase N" saves the phase shown as the working phase', async () => {
    const server = await backend();
    await reload();
    tab('4').click();
    await settle();
    $<HTMLButtonElement>('[data-work-on-phase]')!.click();
    await settle();
    assert.deepEqual(server.updates, [{ type: 'phase', value: '4' }]);
    assert.equal(server.savedPhase(), '4');
    assert.equal(phase(), '4');
    assert.equal(workingPhaseNotShown(), null);
    assert.equal(text($('[data-phase-picker-label]')), 'Working on');
    assert.equal($('[data-work-on-phase]'), null, 'nothing left to save');
    assert.equal(focusedPhase(), '4', 'focus goes to the phase track');
    assert.match(text($('#toast')), /You are now working on Phase 4\./);
    await reload();
    assert.equal(phase(), '4', 'a reload opens the new working phase');
  });

  test('the arrow keys only move focus on the track; Enter or Space shows the phase', async () => {
    const server = await backend();
    await reload();
    assert.deepEqual(
      $$('[data-phase-track] [role="tab"]').map(el => el.getAttribute('tabindex')),
      ['-1', '-1', '0', '-1', '-1', '-1'],
      'one Tab stop, on the phase shown',
    );
    tab('3').focus();
    key('ArrowRight');
    assert.equal(focusedPhase(), '4');
    key('ArrowRight');
    assert.equal(focusedPhase(), '5');
    key('End');
    assert.equal(focusedPhase(), 'post');
    key('ArrowRight');
    assert.equal(focusedPhase(), '1', 'wraps around');
    key('ArrowLeft');
    assert.equal(focusedPhase(), 'post');
    key('Home');
    assert.equal(focusedPhase(), '1');
    key('ArrowDown');
    assert.equal(focusedPhase(), '2');
    await settle();
    assert.equal(phase(), '3', 'moving focus shows nothing');
    assert.deepEqual(server.updates, [], 'and saves nothing');
    // Enter and Space press the focused button, which the browser turns into a click (happy-dom
    // does not, so the click stands in for them; browser-check.ts presses the real keys in Chrome).
    tab('2').click();
    await settle();
    assert.equal(phase(), '2');
    assert.equal(focusedPhase(), '2', 'focus stays on the tab');
    assert.equal(tab('2').getAttribute('tabindex'), '0');
    assert.deepEqual(server.updates, []);
  });

  test('Logistics and Storage on a milestone-only phase offer "Go to Phase 3"', async () => {
    const server = await backend();
    await reload();
    for (const page of ['logistics', 'storage'] as const) {
      location.hash = page;
      go(page);
      render();
      await settle();
      tab('1').click();
      await settle();
      assert.equal(phase(), '1');
      const notice = $('#main [data-milestone-only]');
      assert.ok(notice, page + ': the milestone-only notice');
      assert.match(text(notice), /^You are working on Phase 3\. This profile plans production/);
      if (page === 'storage')
        assert.match(text(notice), /the storage room below is the plan's from Phase 3 on\./);
      const button = $<HTMLButtonElement>('#main [data-go-to-start-phase]')!;
      assert.equal(text(button), 'Go to Phase 3');
      button.click();
      await settle();
      assert.equal(phase(), '3', page + ': back on the working phase');
      assert.equal($('#main [data-milestone-only]'), null);
    }
    assert.deepEqual(server.updates, [], 'nothing is saved');
  });

  test('opening the profile (Open profile) still shows the earlier phase with open steps (#570)', async () => {
    await backend();
    await reload();
    await loadContext(currentSave.id, currentProfile.id);
    render();
    await settle();
    assert.equal(phase(), '1');
    assert.equal(openedFrom(), '3');
    assert.match(
      text($('[data-milestone-only]')),
      /^You are working on Phase 3. Phase 1 still has/,
    );
  });
});
