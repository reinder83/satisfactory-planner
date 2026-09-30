// A brand new user's first phase (#561): with no save yet, both editions pre-pick Phase 1 on
// the guided start's first question, and the top bar (the "Working on" select and the phase
// track) shows the same phase as the picked card. boot() fills the empty workspace's
// placeholder profile and the wizard's fresh settings; browserMode is fixed when
// browser-api.ts loads, so each edition gets fresh modules with the flag mocked.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../public/browser-api.ts');
  vi.resetModules();
});

// Boots an empty workspace in the given edition and draws what it opens on.
async function bootEmpty(browser: boolean) {
  vi.resetModules();
  // Filled once setup.ts is loaded, before boot() asks for anything.
  const replies: Record<string, unknown> = {};
  // The Pages API answers from IndexedDB; here it gives the same replies as the server.
  vi.doMock('../../public/browser-api.ts', async original => ({
    ...(await original<typeof import('../../public/browser-api.ts')>()),
    browserMode: browser,
    browserRequest: async (path: string) => replies[path],
  }));
  const setup = await import('./setup.ts');
  const session = await import('../../public/app/session.ts');
  const shell = await import('../../public/app/shell.ts');
  const { browserMode } = await import('../../public/browser-api.ts');
  assert.equal(browserMode, browser);
  Object.assign(replies, {
    '/api/workspace': {
      user: { id: 'owner', username: 'Pioneer' },
      accountsEnabled: false,
      catalog: setup.catalog(),
      saves: [],
    },
    '/plan.json': setup.handbook,
    '/progression.json': {},
  });
  // The Pages edition fetches the static files beside the page, so match by the path's end.
  globalThis.fetch = async (path: RequestInfo | URL) => {
    const key = Object.keys(replies).find(k => String(path).endsWith(k));
    return new Response(JSON.stringify(key ? replies[key] : { error: 'unexpected ' + path }), {
      status: key ? 200 : 500,
    });
  };
  setup.page();
  await session.boot();
  shell.render();
  await nextTick();
  assert.equal(session.currentSave.id, '', 'no save is open');
  return { $: setup.$, session };
}

for (const [edition, browser] of [
  ['Docker', false],
  ['Pages', true],
] as const)
  test(`with no save, the ${edition} edition pre-picks Phase 1 and the top bar agrees`, async () => {
    const { $, session } = await bootEmpty(browser);
    assert.equal(session.wizard?.mode, 'guided', 'the guided start is open');
    assert.equal(session.wizard.settings.phase, '1', 'the draft starts on Phase 1');
    const card = $<HTMLInputElement>('input[name="guided:phase"]:checked');
    assert.equal(card?.value, '1', 'the pre-picked card');
    assert.equal(session.phase(), '1', 'the working phase');
    assert.equal($<HTMLSelectElement>('#phase-picker')!.value, card.value, 'the select');
    assert.equal(
      $('.phase-track-seg.current')?.getAttribute('data-phase-seg'),
      card.value,
      'the phase track',
    );
  });

// Picking another card changes the draft's phase, and with no save open the top bar follows it.
for (const [edition, browser] of [
  ['Docker', false],
  ['Pages', true],
] as const)
  test(`with no save, the ${edition} edition's top bar follows a different picked card`, async () => {
    const { $, session } = await bootEmpty(browser);
    const card = $<HTMLInputElement>('input[name="guided:phase"][value="2"]')!;
    card.checked = true;
    card.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    assert.equal(session.wizard?.settings.phase, '2', 'the draft is on Phase 2');
    assert.equal(
      $<HTMLInputElement>('input[name="guided:phase"]:checked')?.value,
      '2',
      'the picked card',
    );
    assert.equal(session.phase(), '2', 'the working phase');
    assert.equal($<HTMLSelectElement>('#phase-picker')!.value, '2', 'the select');
    assert.equal(
      $('.phase-track-seg.current')?.getAttribute('data-phase-seg'),
      '2',
      'the phase track',
    );
  });
