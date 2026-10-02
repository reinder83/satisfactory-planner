// A refused layout edit loads the saved state (#722), in the server edition: every request is a
// fetch, and a refusal is a 400 response (refusal-refresh.ts).
import { test } from 'vitest';
import {
  answer,
  refusalWithoutChangeKeepsThePage,
  refusedRestoreShowsTheSavedLayout,
  type Store,
} from './refusal-refresh.ts';

const serve = (store: Store, offline = () => false) => {
  globalThis.fetch = (async (path: RequestInfo | URL, options: RequestInit = {}) => {
    if (offline()) throw new TypeError('Failed to fetch');
    try {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      return new Response(JSON.stringify(answer(store, String(path), body)), { status: 200 });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return new Response(JSON.stringify({ error: (error as Error).message }), { status });
    }
  }) as typeof fetch;
};

test('a layout edit refused after another device changed the layout shows the saved layout (#722)', async () => {
  await refusedRestoreShowsTheSavedLayout(store => serve(store));
});

test('a refusal with nothing changed elsewhere, or a network failure, leaves the page (#722)', async () => {
  await refusalWithoutChangeKeepsThePage(serve);
});
