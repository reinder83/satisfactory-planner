// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';

// The interface tests load the app as one concatenated script (tests/helpers/app-source.ts),
// which hides ES-module mistakes: a missing export, or a module reading another's binding
// before it is initialised. This imports the real entry point with a stub DOM instead,
// through Vite so the .vue components compile.
test('the app entry point loads as ES modules and registers its listeners in order', async () => {
  const registered: string[] = [];
  const element = (name: string) => ({
    addEventListener: (type: string) => registered.push(`${name} ${type}`),
    set innerHTML(html: string) {
      registered.push('rendered');
    },
    set onclick(handler: unknown) {},
  });
  // Only what the entry point touches while it loads, so the stubs are assigned through
  // Object.assign rather than typed as a full Document, Window and Location.
  Object.assign(globalThis, {
    document: {
      ...element('document'),
      querySelector: element,
      querySelectorAll: () => [],
      // Vue's DOM runtime makes a <template> element as it loads.
      createElement: () => ({}),
    },
    window: { ...element('window'), scrollTo() {} },
    location: { hash: '#plan' },
    // The toast's placement watcher (listeners.ts, #663) registers no listener.
    MutationObserver: class {
      observe() {}
    },
  });
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await import('../../public/app.ts');
  await new Promise(resolve => setTimeout(resolve, 50));
  // Several handlers share an event type, so their order is behaviour; boot() then renders
  // its error screen because the stub fetch fails.
  assert.deepEqual(registered, [
    'document error',
    'window hashchange',
    '#detail mousedown',
    '#detail click',
    '#detail cancel',
    'window beforeunload',
    'document input',
    'document change',
    'document visibilitychange',
    // #1052: coming back to the window asks where the user's other tabs are.
    'window focus',
    // #1054: Ctrl+Z presses the toast's Undo.
    'document keydown',
    'rendered',
  ]);
  // Importing the entry point compiles every component through Vite, cold: no other test file
  // shares this worker's module graph, so nothing can be warmed for it. That takes about 4 s
  // alone, 11 s beside the other test files, and in a full `npm test` on a busy machine it
  // passed the 30 s timeout the other component tests use (#851). The limit only matters for a
  // test that hangs, so this one gets twice that.
}, 60000);
