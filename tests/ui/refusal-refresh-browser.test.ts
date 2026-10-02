// A refused layout edit loads the saved state (#722), in the browser edition: requests go to
// browser-api.ts's browserRequest instead of fetch, and a refusal is mutate's error with its
// status, as the IndexedDB adapter throws it (refusal-refresh.ts).
import { test, vi } from 'vitest';

const edition = vi.hoisted(() => ({
  reply: (async () => {
    throw Error('No browser reply stubbed.');
  }) as (path: string, options: RequestInit) => Promise<unknown>,
}));
vi.mock('../../public/browser-api.ts', async original => ({
  ...(await original<typeof import('../../public/browser-api.ts')>()),
  browserMode: true,
  browserRequest: (path: string, options: RequestInit) => edition.reply(path, options),
}));

import {
  answer,
  refusalWithoutChangeKeepsThePage,
  refusedRestoreShowsTheSavedLayout,
  type Store,
} from './refusal-refresh.ts';

const serve = (store: Store, offline = () => false) => {
  edition.reply = async (path, options) => {
    // A failure inside the adapter that is no refusal (IndexedDB unavailable) has no status.
    if (offline()) throw Error('The browser storage is unavailable.');
    return answer(store, path, options.body ? JSON.parse(String(options.body)) : undefined);
  };
};

test('a layout edit refused after another tab changed the layout shows the saved layout in the browser (#722)', async () => {
  await refusedRestoreShowsTheSavedLayout(store => serve(store));
});

test('a refusal with nothing changed elsewhere, or a storage failure, leaves the page in the browser (#722)', async () => {
  await refusalWithoutChangeKeepsThePage(serve);
});
