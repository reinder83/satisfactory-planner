// A layout edit refused because another device changed the layout meanwhile (#722), shared by the
// server edition's test (refusal-refresh.test.ts) and the browser edition's
// (refusal-refresh-browser.test.ts). Bay C is hidden here; elsewhere an added bay takes the letter
// C. Restore on C is then refused with a 400 from mutate, and the page has to load the saved
// state so it shows the added bay the refusal talks about, instead of the old layout.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { setFloor, setLayoutEditing, setState, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { mutate } from '../../public/state.ts';
import { $, applyUpdate, go, openMigrated, page } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// What the edition's requests reach: `saved` is the profile's stored state, which /api/state
// returns and /api/update changes through mutate, refusing as the edition does (an error carrying
// the status). `requests` lists the paths asked for.
export type Store = { saved: ProgressState; requests: string[] };
export function answer(store: Store, path: string, body: unknown): ProgressState {
  store.requests.push(path);
  if (path === '/api/state') return store.saved;
  if (path !== '/api/update') throw Error('unexpected ' + path);
  const next = mutate(structuredClone(store.saved), body as UpdateOp);
  next.revision = (store.saved.revision ?? 0) + 1;
  return (store.saved = next);
}

// Opens the storage layout editor with bay C hidden, in this tab and in `store`.
function hiddenC(): Store {
  page();
  openMigrated();
  const hidden = applyUpdate({ type: 'storageBayHide', id: 'C' });
  hidden.revision = 1;
  setState(hidden);
  setFloor('ground');
  setLayoutEditing(true);
  go('storage');
  render();
  return { saved: structuredClone(hidden), requests: [] };
}

// `stub(store)` routes the edition's requests to answer(store, ...).
export async function refusedRestoreShowsTheSavedLayout(stub: (store: Store) => void) {
  const store = hiddenC();
  stub(store);
  assert.ok($('[data-restore-bay="C"]'), 'C is hidden here, with Restore');
  // Another device adds a bay under the letter C, replacing the hidden built-in one.
  answer(store, '/api/update', {
    type: 'storageBayAdd',
    id: 'C',
    name: 'Other device',
    floor: 'ground',
    replace: true,
  });
  store.requests.length = 0;
  $<HTMLButtonElement>('[data-restore-bay="C"]')!.focus();
  $('[data-restore-bay="C"]')!.click();
  await settle();
  await settle();
  assert.match($('#toast')!.textContent!, /An added bay uses the letter C/);
  assert.ok($('#toast')!.classList.contains('error'));
  assert.deepEqual(store.requests, ['/api/update', '/api/state'], 'the refusal reloads the state');
  assert.equal(state.revision, store.saved.revision, 'the page has the saved state');
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === 'C' && bay.name === 'Other device'),
    'with the added bay C',
  );
  // The page now shows what the refusal talks about: C's row says an added bay has the letter.
  const row = [...document.querySelectorAll('[data-hidden-bays] .check-row')].find(r =>
    r.textContent!.includes('C ·'),
  )!;
  assert.match(row.textContent!, /An added bay uses this letter/);
  assert.equal($('[data-restore-bay="C"]'), null, 'no Restore left on C');
  assert.equal($<HTMLInputElement>('[data-bay-rename="C"]')?.value, 'Other device');
  // Restore went with the redraw, so focus goes to the page's heading rather than <body>.
  assert.equal(document.activeElement, $('#main h1'), 'focus on the heading');
}

// A refusal of this tab's own request, with nothing changed elsewhere, reloads the state but
// leaves the page as it is (the revision did not move), and a request that never reached the
// edition (no status) does not reload at all.
export async function refusalWithoutChangeKeepsThePage(
  stub: (store: Store, offline: () => boolean) => void,
) {
  const store = hiddenC();
  let offline = false;
  stub(store, () => offline);
  const before = state;
  // Removing built-in bay A is refused by mutate; nothing changed elsewhere.
  const { save } = await import('../../public/app/api.ts');
  await assert.rejects(save({ type: 'storageBayRemove', id: 'A' }), /Only added bays/);
  await settle();
  assert.deepEqual(store.requests, ['/api/update', '/api/state']);
  assert.equal(state, before, 'the same state, not redrawn from a reload');
  // Offline: the write fails without a status, and nothing is reloaded.
  offline = true;
  store.requests.length = 0;
  await assert.rejects(save({ type: 'storageBayRestore', id: 'C' }));
  await settle();
  assert.deepEqual(store.requests, [], 'no reload after a network failure');
  assert.equal(state, before);
}
