import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appSource } from './helpers/app-source.ts';

// Back and Forward start every page at its top (#925): the app turns the browser's own scroll
// restoration off once, as it starts, so a history traversal cannot put back an old offset after
// the hashchange listener (public/app/listeners.ts) has scrolled to the top. Loads the app's
// modules as the interface tests do, with only what their start-up touches.
const source = appSource();
function start(globals: Record<string, unknown>) {
  const node = { addEventListener() {}, close() {}, showModal() {}, innerHTML: '' };
  const context = vm.createContext({
    document: {
      querySelector: () => node,
      querySelectorAll: () => [],
      addEventListener() {},
      activeElement: null,
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '#plan' },
    // The toast's placement watcher (listeners.ts, #663).
    MutationObserver: class {
      observe() {}
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    JSON,
    structuredClone,
    ...globals,
  });
  vm.runInContext(source, context);
}

test('start-up turns the browser’s scroll restoration to manual', () => {
  const history = { scrollRestoration: 'auto' };
  start({ history });
  assert.equal(history.scrollRestoration, 'manual');
});

test('start-up leaves a history without scroll restoration alone, without throwing', () => {
  const history = { length: 1 };
  assert.doesNotThrow(() => start({ history }));
  assert.deepEqual(history, { length: 1 }, 'no setting is added');
});

test('start-up does not throw where there is no history at all', () => {
  assert.doesNotThrow(() => start({}));
});
