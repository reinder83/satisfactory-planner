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
import { $, applyUpdate, go, openMigrated, page } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// `stub(held)` makes the edition's saves reply; each save awaits held() first, which holds the
// first save (a bay rename) until the letter has been typed and lets every later one through.
export async function letterTypedDuringSave(stub: (held: () => Promise<void>) => void) {
  page();
  openMigrated();
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
  openMigrated();
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
  // The box put back after that add is untouched too: it follows the next move (#678).
  const fifth = field().value;
  taken = fifth;
  await renameC('Renamed four times');
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === fifth),
    'the other tab took the next one',
  );
  assert.match(field().value, /^[A-Z]{1,2}$/, 'a suggestion after the other tab took it');
  assert.notEqual(field().value, fifth, 'following the suggestion after adding the suggested one');
}

// `stub(answer)` as above. Each bay rename's reply also carries `otherTab`, a layout change made
// in another tab, which moves the suggestion. A letter typed in the field is the user's even when
// it equals a suggestion the field showed before (#681, point 1, fixed by #682). An emptied field
// stays empty, showing the suggestion as its placeholder, and takes the suggestion again when
// focus leaves it, following it from then on (#681, the owner's option C).
export async function letterKeptOrRefilled(
  stub: (answer: (update: UpdateOp) => ProgressState) => void,
) {
  page();
  openMigrated();
  setFloor('ground');
  setLayoutEditing(true);
  go('storage');
  render();
  let otherTab: UpdateOp | null = null;
  stub(update => {
    const reply = applyUpdate(update);
    return update.type === 'storageBayRename' && otherTab ? mutate(reply, otherTab) : reply;
  });
  const field = () => $<HTMLInputElement>('#new-bay-letter')!;
  const type = (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event('input'));
  };
  // Focus moves on to another control of the page.
  const blur = async () => {
    field().focus();
    field().blur();
    await nextTick();
  };
  let renames = 0;
  const elsewhere = async (change: UpdateOp) => {
    otherTab = change;
    const rename = $<HTMLInputElement>('[data-bay-rename="C"]')!;
    rename.value = `Renamed ${++renames}`;
    rename.dispatchEvent(new Event('change'));
    await settle();
  };
  const addElsewhere = (id: string) =>
    elsewhere({ type: 'storageBayAdd', id, name: 'Other tab', floor: 'ground' });
  const has = (id: string) => state.storageEdits.bays.some(bay => bay.id === id);

  // 1. Untouched, the field follows the suggestion from the first letter to the second.
  const first = field().value;
  assert.match(first, /^[A-Z]{1,2}$/, 'the next free letter is filled in');
  await addElsewhere(first);
  const second = field().value;
  assert.notEqual(second, first, 'the untouched field follows the suggestion');
  // The user types the letter it now suggests. Another tab frees the first letter again, so the
  // suggestion goes back to it; the typed letter is the user's and stays.
  type(second);
  await elsewhere({ type: 'storageBayRemove', id: first });
  assert.ok(!has(first), 'the other tab removed the bay');
  assert.equal(field().placeholder, first, 'the suggestion went back');
  assert.equal(field().value, second, 'the typed letter stays when the suggestion moves off it');

  // 2. Emptied, the field stays empty and shows the suggestion as its placeholder, also when the
  // suggestion moves meanwhile, so a next keystroke is not added to a suggestion.
  type('');
  await nextTick();
  assert.equal(field().value, '', 'emptied');
  assert.equal(field().placeholder, first, 'the suggestion as placeholder');
  await addElsewhere(first);
  assert.equal(field().value, '', 'still empty after the suggestion moved');
  assert.equal(field().placeholder, second, 'the placeholder follows the suggestion');
  // A blur that leaves it focused (the window lost focus to another tab) is not leaving it.
  field().focus();
  field().dispatchEvent(new Event('blur'));
  await nextTick();
  assert.equal(field().value, '', 'still empty when the window loses focus');
  // Focus leaves it empty: it takes the suggestion and follows it again.
  await blur();
  assert.equal(field().value, second, 'takes the suggestion when focus leaves it empty');
  await addElsewhere(second);
  const third = field().value;
  assert.match(third, /^[A-Z]{1,2}$/, 'a next suggestion');
  assert.notEqual(third, second, 'following the suggestion again after the blur');
  // Only blank counts as empty: spaces left in the field are replaced too.
  type('  ');
  await blur();
  assert.equal(field().value, third, 'a blank field takes the suggestion');

  // 3. Typed text is never overwritten: not by leaving the field, not by the next suggestion.
  type('XY');
  await blur();
  assert.equal(field().value, 'XY', 'a typed letter stays when focus leaves');
  await addElsewhere(third);
  assert.equal(field().value, 'XY', 'and when the suggestion moves');
  $<HTMLInputElement>('#new-bay-name')!.value = 'Typed bay';
  $('#add-bay')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.ok(
    state.storageEdits.bays.some(bay => bay.id === 'XY' && bay.name === 'Typed bay'),
    'the bay is added under the typed letter',
  );
  assert.equal(field().value, field().placeholder, 'back on the suggestion after adding');
}
