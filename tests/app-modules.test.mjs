import { test } from 'node:test';
import assert from 'node:assert/strict';

// The interface tests load the app as one concatenated script (tests/helpers/app-source.mjs),
// which hides ES-module mistakes: a missing export, or a module reading another's binding
// before it is initialised. This imports the real entry point with a stub DOM instead.
test('the app entry point loads as ES modules and registers its listeners in order', async () => {
  const registered = [];
  const element = name => ({
    addEventListener: type => registered.push(`${name} ${type}`),
    set innerHTML(html) {
      registered.push('rendered');
    },
    set onclick(handler) {},
  });
  globalThis.document = {
    ...element('document'),
    querySelector: element,
    querySelectorAll: () => [],
  };
  globalThis.window = { ...element('window'), scrollTo() {} };
  globalThis.location = { hash: '#plan' };
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await import('../public/app.js');
  await new Promise(resolve => setTimeout(resolve, 50));
  // Several handlers share an event type, so their order is behaviour; boot() then renders
  // its error screen because the stub fetch fails.
  assert.deepEqual(registered, [
    'document click',
    'document click',
    'document change',
    'document input',
    'document input',
    'document keydown',
    'document focusout',
    'document submit',
    'document submit',
    'document error',
    'window hashchange',
    '#detail click',
    'window beforeunload',
    'document click',
    'document submit',
    'document click',
    'document change',
    'rendered',
  ]);
});
