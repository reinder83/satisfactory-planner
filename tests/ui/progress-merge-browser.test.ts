// The browser edition's Backup page has Co-op progress too (#1160), under the full-save panel.
// A merge there goes through the same `checks` update, which browser-api.ts stores in IndexedDB
// as any tick (tested in tests/progress-merge.test.ts). browserMode is fixed when browser-api.ts
// loads, so this file sets the Pages build's flag before anything is imported.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { PLANNER_BROWSER?: unknown }).PLANNER_BROWSER = true;
});

import { browserMode } from '../../public/browser-api.ts';
import { render } from '../../public/app/shell.ts';
import { generated, go, open, page } from './setup.ts';

beforeEach(async () => {
  page();
  open({ calculated: generated(), phase: '1' });
  go('backup');
  render();
  await nextTick();
});

test('the browser edition offers Co-op progress after the full saves', () => {
  assert.equal(browserMode, true);
  const panels = [...document.querySelectorAll('#main section.panel h2')].map(h => h.textContent);
  assert.deepEqual(panels.slice(0, 3), [
    'Full saves & transfer',
    'Co-op progress',
    'Keep a backup',
  ]);
  assert.ok(document.querySelector('[data-export-ticks]'));
  assert.ok(document.querySelector('[data-merge-progress]'));
});
