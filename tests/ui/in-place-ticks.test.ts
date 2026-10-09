// Edit settings → "Recalculate in place" (#1071) keeps the steps the user ticked and the phase they
// work on (#1112): the build plan opens on the same working phase, with the Space Elevator and
// mining steps still ticked. The requests go to the browser edition's real request handler
// (browser-api.ts, the carry it shares with the server), with the workspace in memory.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeAll, beforeEach, test } from 'vitest';
import {
  loadContext,
  phase,
  progressionData,
  setWorkspace,
  state,
  view,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { createBrowserApi } from '../../public/browser-api.ts';
import { phaseSteps } from '../../public/progression.ts';
import type {
  BrowserWorkspace,
  CurrentCalculatedPlan,
  WorkspaceSummary,
} from '../../public/types/index.ts';
import { $, catalog, generatedWith, go, page } from './setup.ts';

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const click = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await settle();
};
const box = (id: string) => $<HTMLInputElement>(`#main [data-check="${id}"]`);

// A Phase 1 plan with mining per phase, so each phase has a "Tap the resource nodes" step. Every
// calculation (the Review preview and the recalculation) gives it again as a new plan.
let plan: CurrentCalculatedPlan;
let made = 0;
beforeAll(() => {
  plan = generatedWith({ phase: '1', goal: 'minimal', phaseMining: true });
});

let data: BrowserWorkspace;
let api: ReturnType<typeof createBrowserApi>;
const post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });

beforeEach(() => {
  page();
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not.
  HTMLFormElement.prototype.reportValidity = () => true;
  data = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  api = createBrowserApi(
    store,
    () => ({
      ...structuredClone(plan),
      createdAt: new Date(Date.UTC(2026, 9, 9, 10, made++)).toISOString(),
    }),
    catalog(),
    undefined,
    undefined,
    progressionData,
  );
  globalThis.fetch = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    try {
      const reply = await api(String(input), {
        body: options.body ?? null,
        headers: { ...(options.headers as Record<string, string> | undefined) },
      });
      return new Response(JSON.stringify(reply), { status: 200 });
    } catch (error) {
      const { message, status } = error as Error & { status?: number };
      return new Response(JSON.stringify({ error: message }), { status: status ?? 400 });
    }
  };
});

// A profile made for Phase 1 with `ticks` ticked and `working` as its phase, open on its build plan.
async function openProfile(ticks: string[], working: string) {
  const ids = (await post('/api/profiles', {
    saveName: 'World',
    name: 'Minimal',
    settings: { phase: '1' },
  })) as { saveId: string; profileId: string };
  await post('/api/update', { type: 'checks', keys: ticks, value: true });
  await post('/api/update', { type: 'phase', value: working });
  setWorkspace((await api('/api/workspace')) as WorkspaceSummary);
  await loadContext(ids.saveId, ids.profileId);
  go('plan');
  render();
  await settle();
}

// Edit settings from the profile switcher, then Review's "Recalculate in place".
async function recalculateInPlace() {
  await click('button[data-profile-switcher]');
  await click('[data-edit-open-profile]');
  render();
  await settle();
  await click('[data-wizard-step="5"]');
  assert.equal(
    $('#wizard-form button[type="submit"]')!.textContent!.trim(),
    'Recalculate in place',
  );
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.equal(view, 'plan');
  assert.match($('#toast')!.textContent!, /^Recalculated in place\./);
  assert.equal(data.saves[0]!.profiles.length, 2, 'the version before is kept');
  render();
  await settle();
}

test('the build plan keeps the working phase and its ticked steps after recalculating in place', async () => {
  // Phase 1 done, the Space Elevator included, and Phase 2's nodes tapped: working on Phase 2.
  const phaseOne = phaseSteps(plan, { checks: {} }, progressionData, '1').map(step => step.id);
  assert.ok(phaseOne.includes('space-elevator'));
  await openProfile([...phaseOne, 'mining-2'], '2');
  assert.equal(phase(), '2');
  assert.equal(box('mining-2')!.checked, true);

  await recalculateInPlace();
  assert.equal(state.settings.phase, '2', 'the phase worked on stays');
  assert.equal(phase(), '2', 'the build plan opens on it');
  assert.equal($<HTMLSelectElement>('#phase-picker')!.value, '2');
  assert.equal(box('mining-2')!.checked, true, 'the mining step stays ticked');
  assert.equal(state.checks['space-elevator'], true, 'so does the Space Elevator');
  const backup = data.saves[0]!.profiles[1]!;
  assert.equal(backup.state.settings.phase, '2');
  assert.equal(backup.state.checks['mining-2'], true);
});

test('the Space Elevator step stays ticked on the build plan after recalculating in place', async () => {
  await openProfile(['space-elevator', 'mining-1'], '1');
  assert.equal(box('space-elevator')!.checked, true);

  await recalculateInPlace();
  assert.equal(phase(), '1');
  const elevator = box('space-elevator')!;
  assert.equal(elevator.checked, true, 'ticked');
  assert.equal(elevator.disabled, false, 'by the user, not by a later working phase');
  assert.equal(box('mining-1')!.checked, true);
});
