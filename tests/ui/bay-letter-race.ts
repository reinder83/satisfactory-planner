// The new bay letter typed while another layout save runs (#670), shared by the server edition's
// test (bay-letter.test.ts) and the browser edition's (bay-letter-browser.test.ts). The letter
// field starts on the next free letter, and every save redraws the layout editor: when the Saving
// indicator comes on and after the save. Bound to the suggestion, a redraw put the suggested
// letter back over one typed but not yet submitted, and Add bay then used the suggestion.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { setFloor, setLayoutEditing, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, go, open, page } from './setup.ts';

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
