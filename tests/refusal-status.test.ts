// A layout edit that mutate refuses reaches the page with status 400 in the browser edition too,
// as the server answers it (#722): queuedWrite in public/app/api.ts reloads the saved state after
// a 400 or 409, so the page shows the change another tab made that the refusal is about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate } from '../planner.ts';
import type { BrowserWorkspace, Catalog } from '../public/types/index.ts';

test('the browser edition refuses a layout edit with status 400, leaving the state as it was', async () => {
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
  const api = createBrowserApi(store, calculate, {} as Catalog),
    update = (change: object) => api('/api/update', { body: JSON.stringify(change) });
  await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'W', name: 'P', settings: { phase: '1', goal: 'minimal' } }),
  });
  await update({ type: 'storageBayHide', id: 'C' });
  // Another tab adds a bay under the hidden letter.
  await update({
    type: 'storageBayAdd',
    id: 'C',
    name: 'Other tab',
    floor: 'ground',
    replace: true,
  });
  const before = structuredClone(data);
  await assert.rejects(
    update({ type: 'storageBayRestore', id: 'C' }),
    (error: Error & { status?: number }) =>
      error.status === 400 && /An added bay uses the letter C/.test(error.message),
  );
  await update({ type: 'storageBayRemove', id: 'C' });
  await assert.rejects(
    update({ type: 'storageBayRemove', id: 'C' }),
    (error: Error & { status?: number }) =>
      error.status === 400 && /Only added bays/.test(error.message),
  );
  assert.equal(
    data.saves[0]!.profiles[0]!.state.revision,
    before.saves[0]!.profiles[0]!.state.revision! + 1,
  );
});
