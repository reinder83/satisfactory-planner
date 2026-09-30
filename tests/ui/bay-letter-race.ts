// The new bay letter typed while another layout save runs (#670), shared by the server edition's
// test (bay-letter.test.ts) and the browser edition's (bay-letter-browser.test.ts). The letter
// field starts on the next free letter, and every save redraws the layout editor: when the Saving
// indicator comes on and after the save. Bound to the suggestion, a redraw put the suggested
// letter back over one typed but not yet submitted, and Add bay then used the suggestion.
// A save can also change the suggestion itself, when its reply brings a bay added in another tab
// (#677): a typed letter stays, and only an untouched field follows the new suggestion.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { setFloor, setLayoutEditing, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { mutate } from '../../public/state.ts';
import { $, applyUpdate, go, open, page } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// `stub(held)` makes the edition's saves reply; each save awaits held() first, which holds the
// first save (a bay rename) until the letter has been typed and lets every later one through.
export async function letterTypedDuringSave(stub: (held: () => Promise<void>) => void) {
  page();
  open();
  setFloor('ground');
  setLayoutEditing(true);
  go('storage');
  render();
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let first = true;
  stub(() => {
    if (!first) return Promise.resolve();
    first = false;
    return gate;
  });
  const letter = $<HTMLInputElement>('#new-bay-letter')!,
    suggested = letter.value;
  assert.match(suggested, /^[A-Z]{1,2}$/, 'the next free letter is filled in');
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  // Bay C's rename is committed by tabbing on, and the letter is typed while it saves.
  const rename = $<HTMLInputElement>('[data-bay-rename="C"]')!;
  rename.value = 'Renamed';
  rename.dispatchEvent(new Event('change'));
  type(letter, 'X');
  await nextTick();
  assert.equal(letter.value, 'X', 'kept while the Saving indicator comes on');
  type(letter, 'XY');
  release();
  await settle();
  assert.equal(state.storageEdits.bayNames.C, 'Renamed', 'the rename saved');
  const field = $<HTMLInputElement>('#new-bay-letter')!;
  assert.equal(field.value, 'XY', 'kept after the other save');
  $<HTMLInputElement>('#new-bay-name')!.value = 'Typed bay';
  $('#add-bay')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === 'XY' && bay.name === 'Typed bay'),
    'the bay is added under the typed letter',
  );
  assert.ok(!state.storageEdits.bays.some(bay => bay.id === suggested), 'not under the suggestion');
  // After adding, the next suggestion still replaces what was typed.
  assert.equal($<HTMLInputElement>('#new-bay-letter')!.value, suggested, 'the next suggestion');
}

// `stub(answer)` makes the edition's saves reply with answer(update). Each bay rename's reply also
// carries a bay that another tab added under the suggested letter, which moves the suggestion on.
export async function letterTypedWhileSuggestionMoves(
  stub: (answer: (update: UpdateOp) => ProgressState) => void,
) {
  page();
  open();
  setFloor('ground');
  setLayoutEditing(true);
  go('storage');
  render();
  let taken = '';
  stub(update => {
    const reply = applyUpdate(update);
    if (update.type !== 'storageBayRename') return reply;
    return mutate(reply, {
      type: 'storageBayAdd',
      id: taken,
      name: 'Other tab',
      floor: 'ground',
    });
  });
  const field = () => $<HTMLInputElement>('#new-bay-letter')!;
  const renameC = async (name: string) => {
    const rename = $<HTMLInputElement>('[data-bay-rename="C"]')!;
    rename.value = name;
    rename.dispatchEvent(new Event('change'));
    await settle();
  };
  const first = field().value;
  assert.match(first, /^[A-Z]{1,2}$/, 'the next free letter is filled in');
  // Untouched, the field follows the suggestion when another tab takes its letter.
  taken = first;
  await renameC('Renamed once');
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === first),
    'the other tab took it',
  );
  const second = field().value;
  assert.match(second, /^[A-Z]{1,2}$/, 'a new suggestion');
  assert.notEqual(second, first, 'the untouched field follows the suggestion');
  // Typed, it keeps the letter when another tab takes the suggested one.
  field().value = 'XY';
  field().dispatchEvent(new Event('input'));
  taken = second;
  await renameC('Renamed twice');
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === second),
    'the other tab took it too',
  );
  assert.equal(field().value, 'XY', 'the typed letter stays');
  $<HTMLInputElement>('#new-bay-name')!.value = 'Typed bay';
  $('#add-bay')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === 'XY' && bay.name === 'Typed bay'),
    'the bay is added under the typed letter',
  );
  // After adding, the field is back on the suggestion and follows it again.
  const third = field().value;
  assert.match(third, /^[A-Z]{1,2}$/, 'the next suggestion');
  assert.ok(![first, second, 'XY'].includes(third), 'a free letter');
  taken = third;
  await renameC('Renamed thrice');
  assert.notEqual(field().value, third, 'following the suggestion again');
  // Adding under the untouched suggestion moves the box on to the next one.
  const fourth = field().value;
  $<HTMLInputElement>('#new-bay-name')!.value = 'Suggested bay';
  $('#add-bay')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === fourth),
    'added under the suggestion',
  );
  assert.match(field().value, /^[A-Z]{1,2}$/, 'a next suggestion after adding the suggested one');
  assert.notEqual(field().value, fourth, 'not the letter just added');
}
