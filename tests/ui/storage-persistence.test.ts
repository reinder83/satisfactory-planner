// Persistent browser storage (#1368): the browser edition asks the browser to keep the saves,
// says on Backup whether it will, and warns more plainly when it may not. navigator.storage is
// replaced by small typed stand-ins (no casts), and the missing or throwing API is covered.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { PLANNER_BROWSER?: unknown }).PLANNER_BROWSER = true;
});

// The browser edition's requests would reach IndexedDB; every write here just succeeds.
vi.mock('../../public/browser-api.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../public/browser-api.ts')>()),
  browserRequest: async () => ({}),
}));

import { setWorkspace, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  askAfterSave,
  ASKED_KEY,
  persistence,
  readPersistence,
  requestPersistence,
} from '../../public/app/storage-persistence.ts';
import { $, go, open, page } from './setup.ts';

type Storage = Pick<StorageManager, 'persist' | 'persisted'>;

function stub(persisted: boolean, grants: boolean) {
  const calls = { persist: 0, persisted: 0 };
  const storage: Storage = {
    persisted: async () => {
      calls.persisted++;
      return persisted;
    },
    persist: async () => {
      calls.persist++;
      return grants;
    },
  };
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
  return calls;
}
const withoutApi = () =>
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
const throwingApi = () => {
  const storage: Storage = {
    persisted: async () => {
      throw new Error('denied');
    },
    persist: async () => {
      throw new Error('denied');
    },
  };
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
};
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
};

const DAY = 86400000;
beforeEach(() => {
  localStorage.clear();
  persistence.value = 'unknown';
  page();
  open();
  setWorkspace({
    ...workspace,
    browser: true,
    lastBackup: new Date(Date.now() - 15 * DAY).toISOString(),
  });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

const backupPage = async () => {
  go('backup');
  render();
  await settle();
};

test('persisted() true shows that the saves are kept, with no button', async () => {
  const calls = stub(true, true);
  await readPersistence();
  await backupPage();
  const status = $('[data-persistence-status]')!;
  assert.equal(status.getAttribute('data-persistence-status'), 'kept');
  assert.match(status.textContent!, /Saves are kept: your browser won't clear them on its own/);
  assert.equal($('[data-persist-storage]'), null);
  assert.equal(calls.persist, 0, 'reading the state asks nothing');
});

test('persisted() false says the browser may clear the saves and offers "Keep my saves"', async () => {
  const calls = stub(false, true);
  await readPersistence();
  await backupPage();
  const status = $('[data-persistence-status]')!;
  assert.equal(status.getAttribute('data-persistence-status'), 'may-clear');
  assert.match(
    status.textContent!,
    /Your browser may clear these saves\. Export a backup to be safe/,
  );
  const button = $<HTMLButtonElement>('[data-persist-storage]')!;
  assert.equal(button.textContent!.trim(), 'Keep my saves');
  assert.equal(calls.persist, 0, 'the page itself asks nothing');
  button.click();
  await settle();
  assert.equal(calls.persist, 1, 'the button asks once');
  assert.equal(persistence.value, 'kept');
  assert.equal($('[data-persistence-status]')!.getAttribute('data-persistence-status'), 'kept');
  assert.equal($('[data-persist-storage]'), null);
});

test('a refused request keeps the warning and the button', async () => {
  stub(false, false);
  await readPersistence();
  await backupPage();
  $<HTMLButtonElement>('[data-persist-storage]')!.click();
  await settle();
  assert.equal(persistence.value, 'not-kept');
  assert.equal(
    $('[data-persistence-status]')!.getAttribute('data-persistence-status'),
    'may-clear',
  );
  assert.ok($('[data-persist-storage]'));
});

test('without the API the page says the saves may be cleared and has no button', async () => {
  withoutApi();
  await readPersistence();
  assert.equal(persistence.value, 'unsupported');
  await backupPage();
  assert.equal(
    $('[data-persistence-status]')!.getAttribute('data-persistence-status'),
    'may-clear',
  );
  assert.equal($('[data-persist-storage]'), null);
});

test('a throwing API never breaks startup, saving or the page', async () => {
  throwingApi();
  assert.equal(await readPersistence(), 'unsupported');
  assert.equal(await requestPersistence(), false);
  askAfterSave(true);
  await settle();
  await backupPage();
  assert.ok($('[data-persistence-status]'));
});

test('the storage notice is stronger when the browser may clear the saves', async () => {
  stub(true, true);
  await readPersistence();
  go('backup');
  render();
  await settle();
  assert.equal($('[data-storage-risk]'), null, 'the plain reminder when the saves are kept');
  stub(false, false);
  await readPersistence();
  await settle();
  const notice = $('[data-storage-risk]')!;
  assert.match(notice.textContent!, /may clear these saves/);
  assert.match(notice.textContent!, /last full export was 15 days ago/);
  assert.ok(notice.querySelector('a[href="#backup"]'));
  setWorkspace({ ...workspace, lastBackup: null });
  render();
  await settle();
  assert.match($('[data-storage-risk]')!.textContent!, /have not exported a backup yet/);
});

test('the first save asks the browser once, never again, and never when kept or without a save', async () => {
  const calls = stub(false, true);
  askAfterSave(false);
  await settle();
  assert.equal(calls.persist, 0, 'no save yet');
  askAfterSave(true);
  askAfterSave(true);
  await settle();
  assert.equal(calls.persist, 1, 'asked once for the first save');
  askAfterSave(true);
  await settle();
  assert.equal(calls.persist, 1, 'not again on later saves');
  assert.equal(localStorage.getItem(ASKED_KEY), '1', 'remembered in this browser');
});

// The last two tests load fresh copies of the modules, because the once-per-session ask is kept
// in module state; they come last so no page is loaded from a different copy after them.
test('a browser asked before, or one that already keeps the storage, is not asked', async () => {
  vi.resetModules();
  const { askAfterSave: ask, persistence: state } =
    await import('../../public/app/storage-persistence.ts');
  localStorage.setItem(ASKED_KEY, '1');
  const calls = stub(false, true);
  ask(true);
  await settle();
  assert.equal(calls.persist, 0, 'asked in an earlier visit');
  localStorage.clear();
  state.value = 'unknown';
  const kept = stub(true, true);
  ask(true);
  await settle();
  assert.equal(kept.persist, 0, 'already kept');
  assert.equal(kept.persisted, 1);
});

test('a write that makes the first save (a new profile, an import) asks once, as the first save does', async () => {
  vi.resetModules();
  const { post } = await import('../../public/app/api.ts');
  const calls = stub(false, true);
  await post('/api/profiles', { saveName: 'World' });
  await settle();
  await post('/api/import-saves', {}, false);
  await settle();
  assert.equal(calls.persist, 1, 'asked once, after the first write');
  assert.equal(calls.persisted, 1);
});
