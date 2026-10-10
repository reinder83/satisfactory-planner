import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate, rankAlternates } from '../planner.ts';
import type { BrowserWorkspace, Catalog, StageKey } from '../public/types/index.ts';

// A body that is valid JSON but not an object (null, a list, a string or a number) is refused
// with "Expected a JSON object." before any route reads it, as the server refuses it (#541,
// #573), and the workspace is left unchanged. Requests without a body still work.
test('a JSON body that is not an object is refused before any route reads it', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    // Like openBrowserStore: without `change` the answer is the record itself.
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const ranker = (settings: unknown, phase: StageKey) =>
    rankAlternates(settings as Parameters<typeof rankAlternates>[0], { phase });
  const api = createBrowserApi(store, calculate, {} as Catalog, ranker),
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  await post('/api/profiles', {
    saveName: 'Test save',
    name: 'First',
    settings: { phase: '1', goal: 'minimal' },
  });
  const before = structuredClone(data);
  const endpoints = [
    '/api/preview',
    '/api/profiles',
    '/api/duplicate-profile',
    '/api/import-saves',
    '/api/round-up',
    '/api/rank-alternates',
    '/api/select',
    '/api/remove-profile',
    '/api/rename',
    '/api/dismiss-rename-offer',
    '/api/update',
    '/api/import',
  ];
  for (const endpoint of endpoints)
    for (const body of [null, [], 'x', 5]) {
      const label = endpoint + ' ' + JSON.stringify(body);
      await assert.rejects(post(endpoint, body), { message: 'Expected a JSON object.' }, label);
    }
  assert.deepEqual(data, before);
  // Requests without a body, and object bodies, still reach their route.
  for (const route of ['/api/workspace', '/api/context', '/api/state', '/api/export'])
    assert.ok(await api(route), route);
  await post('/api/update', { type: 'check', key: 'body-ok', value: true });
  assert.equal(data.saves[0]!.profiles[0]!.state.checks['body-ok'], true);
});
