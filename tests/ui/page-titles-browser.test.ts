// Every page names the browser tab in the Pages edition too (#1254); see page-titles.test.ts.
// browserMode is fixed when browser-api.ts loads, so the Pages build's flag is set first.
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { PLANNER_BROWSER?: unknown }).PLANNER_BROWSER = true;
});

import { browserMode } from '../../public/browser-api.ts';
import { assertSharedTitles, firstFactoryName, pageTitles, SHARED_ROUTES } from './page-titles.ts';

test('every page of the Pages edition has its own title', async () => {
  assert.equal(browserMode, true);
  assertSharedTitles(await pageTitles(SHARED_ROUTES), firstFactoryName());
});
