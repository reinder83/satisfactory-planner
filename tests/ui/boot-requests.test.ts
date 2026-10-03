// What boot() asks for (#800): with the handbook profile type retired, every profile carries
// its own calculated plan, so boot no longer fetches /plan.json. Each test stubs /plan.json too,
// so a boot that still fetched it would succeed and fail only here, on the list of requests.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { boot, currentSave } from '../../public/app/session.ts';
import { catalog, handbook, migratedPlan, page, stubFetch } from './setup.ts';
import type { WorkspaceSummary } from '../../public/types/index.ts';

const user = { id: 'owner', username: 'Pioneer' };
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// The paths requested, without their query strings.
const paths = (calls: [string, unknown][]) => calls.map(([path]) => path.split('?')[0]);

beforeEach(() => {
  page();
});

test('booting into a saved profile requests no /plan.json', async () => {
  const plan = migratedPlan();
  const workspace: WorkspaceSummary = {
    user,
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
            phase: '3',
            settings: plan.settings,
          },
        ],
      },
    ],
  } as WorkspaceSummary;
  const calls = stubFetch({
    '/api/workspace': workspace,
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Main' },
      state: {
        version: 1,
        revision: 0,
        settings: { phase: '3' },
        checks: {},
        notes: {},
        deliveries: {},
        customTasks: [],
      },
      plan,
    },
    '/progression.json': {},
    '/plan.json': handbook,
  });
  await boot();
  await settle();
  assert.equal(currentSave.id, 's', 'the saved profile opened');
  assert.ok(paths(calls).includes('/api/context'), 'it loaded the profile');
  assert.ok(!paths(calls).includes('/plan.json'), 'requests: ' + paths(calls).join(', '));
});

test('booting into the empty workspace requests no /plan.json', async () => {
  const calls = stubFetch({
    '/api/workspace': { user, accountsEnabled: false, catalog: catalog(), saves: [] },
    '/progression.json': {},
    '/plan.json': handbook,
  });
  await boot();
  await settle();
  assert.equal(currentSave.id, '', 'no save is open');
  assert.ok(!paths(calls).includes('/plan.json'), 'requests: ' + paths(calls).join(', '));
});
