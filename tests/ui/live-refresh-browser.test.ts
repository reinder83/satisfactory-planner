// #1210: the browser (GitHub Pages) edition has no server, so it never polls: the live refresh of
// the Docker edition (live-refresh.ts) asks nothing there, neither on its timer nor when asked.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, test, vi } from 'vitest';

const edition = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock('../../public/browser-api.ts', async original => ({
  ...(await original<typeof import('../../public/browser-api.ts')>()),
  browserMode: true,
  browserRequest: async (path: string) => {
    edition.asked.push(path);
    throw Error('unexpected ' + path);
  },
}));

import { LIVE_REFRESH_MS, pollProgress, startLiveRefresh } from '../../public/app/live-refresh.ts';
import { render } from '../../public/app/shell.ts';
import { $, go, open, page } from './setup.ts';

afterEach(() => vi.useRealTimers());

test('the browser edition never asks for the progress again by itself', async () => {
  page();
  open({ calculated: true, phase: '3' });
  go('plan');
  render();
  await nextTick();
  const fetched: string[] = [];
  globalThis.fetch = async (path: RequestInfo | URL) => {
    fetched.push(String(path));
    return new Response('{}');
  };
  // A visible tab, which the Docker edition would poll.
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.useFakeTimers();
  startLiveRefresh();
  await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);
  assert.equal(await pollProgress(), false);
  assert.deepEqual(edition.asked, []);
  assert.deepEqual(fetched, []);
  assert.equal($('[data-live-change]'), null);
  visibility.mockRestore();
});
