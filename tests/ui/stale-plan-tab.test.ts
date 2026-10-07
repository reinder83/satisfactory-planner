// A tab still showing a profile's plan from before "Recalculate in place" in another tab (#1071).
// The requests go to the browser edition's real request handler (browser-api.ts, the checks it
// shares with the server), with the workspace in memory. Coming back to the tab opens the new
// plan and says so, instead of adopting only the new state; a whole-value write sent from the
// old plan, already on its way or made before any refresh, is refused and changes nothing.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeAll, beforeEach, test } from 'vitest';
import { recalculatedNotice, save } from '../../public/app/api.ts';
import { calculated, loadContext, setWorkspace, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { createBrowserApi } from '../../public/browser-api.ts';
import { planReplaced } from '../../public/state.ts';
import type {
  BrowserWorkspace,
  Catalog,
  CurrentCalculatedPlan,
  StoredProfile,
  WorkspaceSummary,
} from '../../public/types/index.ts';
import { $, generatedWith, go, page } from './setup.ts';

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await nextTick();
  }
};
const comeBack = () => document.dispatchEvent(new Event('visibilitychange'));

// The plan before the edit, and the one "Recalculate in place" makes: the edited settings drop
// one of Phase 1's production lines, so a step order worked out from the old plan names a step
// the new plan does not have.
let before: CurrentCalculatedPlan, after: CurrentCalculatedPlan, dropped: string;
beforeAll(async () => {
  before = generatedWith({ phase: '1', goal: 'minimal' });
  after = generatedWith({ phase: '1', goal: 'balanced' });
  before.createdAt = '2026-10-07T09:00:00.000Z';
  after.createdAt = '2026-10-07T09:30:00.000Z';
  const rows = after.stages['1']!.rows!;
  dropped = rows.at(-1)!.id;
  rows.pop();
  page();
  await import('../../public/app/listeners.ts');
});

let data: BrowserWorkspace;
let api: ReturnType<typeof createBrowserApi>;
let ids: { saveId: string; profileId: string };
const stored = () => data.saves[0]!.profiles[0]! as StoredProfile & { kind: 'calculated' };

beforeEach(async () => {
  page();
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
    settings =>
      structuredClone((settings as { goal?: string }).goal === 'balanced' ? after : before),
    {} as Catalog,
  );
  // The page's requests reach the handler as fetch would carry them, refusals with their status.
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
  ids = (await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'World', name: 'Minimal', settings: { phase: '1' } }),
  })) as typeof ids;
  // This tab opens the profile on its plan page.
  setWorkspace((await api('/api/workspace')) as WorkspaceSummary);
  await loadContext(ids.saveId, ids.profileId);
  go('plan');
  render();
  await settle();
  assert.equal(calculated!.createdAt, before.createdAt);
  assert.ok(
    planTasks('1').some(step => step.id.includes(dropped)),
    'the old plan has the step',
  );
});

// Another tab: Edit settings → Recalculate in place, from the plan this tab shows too.
const recalculateElsewhere = () =>
  api('/api/recalculate', {
    headers: { 'X-Save-Id': ids.saveId, 'X-Profile-Id': ids.profileId },
    body: JSON.stringify({
      name: 'Balanced',
      backupName: 'Minimal (before edit)',
      settings: { phase: '1', goal: 'balanced' },
      planCreatedAt: before.createdAt,
    }),
  });
// What this tab's Move down would send: the phase's whole step order, from the plan on screen.
const moveDown = () => {
  const order = planTasks('1').map(step => step.id);
  [order[0], order[1]] = [order[1]!, order[0]!];
  return save({ type: 'taskOrder', phase: '1', ids: order });
};

test('coming back after an in-place recalculation opens the new plan before any write', async () => {
  await recalculateElsewhere();
  comeBack();
  await settle();
  assert.equal(calculated!.createdAt, after.createdAt, 'the tab shows the new plan');
  assert.equal(state.revision, stored().state.revision, 'with its state');
  assert.equal($('#toast')!.textContent, recalculatedNotice);

  await moveDown();
  const order = stored().state.taskEdits?.order?.['1'] ?? [];
  assert.ok(order.length > 0, 'the move is saved');
  assert.equal(
    order.some(id => id.includes(dropped)),
    false,
    'worked out from the new plan, not the old one',
  );
});

test('a whole-value write made on the old plan is refused, and the tab opens the new plan', async () => {
  await recalculateElsewhere();
  const kept = structuredClone(stored().state);
  // No refresh first: the tab never lost sight, and its writes are on their way, one after
  // another. The first refusal opens the new plan; those queued after it were still made on the
  // old one, and are refused too.
  const writes = [
    moveDown(),
    save({ type: 'exactClocks', value: { '1': [dropped] } }),
    save({ type: 'check', key: 'calc-1-' + dropped, value: true }),
  ];
  for (const write of writes) await assert.rejects(write, { message: planReplaced });
  assert.deepEqual(stored().state, kept, 'nothing is stored');
  assert.equal(stored().state.exactClocks, undefined);
  await settle();
  assert.equal(calculated!.createdAt, after.createdAt, 'the tab shows the new plan');
  assert.equal(state.revision, kept.revision);
  assert.equal($('#toast')!.textContent, planReplaced);
});
