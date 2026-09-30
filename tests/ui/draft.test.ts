// The drafts of fields that save on change (ui/draft.ts, #627, #654, #664): a new saved value
// replaces a draft only while it is untouched, and settle() puts the saved value back after a
// commit unless something else has been typed since.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { settle, useDraft, useDrafts } from '../../public/app/ui/draft.ts';

test('a new saved value replaces an untouched draft and keeps a typed one (#664)', async () => {
  const saved = ref('0'),
    draft = useDraft(() => saved.value);
  saved.value = '3';
  await nextTick();
  assert.equal(draft.value, '3', 'untouched: another tab’s value is shown');
  // Committed 5, then 7 typed while that save is in flight.
  draft.value = '5';
  draft.value = '7';
  saved.value = '5';
  await nextTick();
  assert.equal(draft.value, '7', 'typed after the commit: kept');
  assert.equal(settle(draft, '5', saved.value), false, 'the commit of 5 leaves the 7');
  assert.equal(draft.value, '7');
  saved.value = '7';
  await nextTick();
  assert.equal(settle(draft, '7', saved.value), true);
  assert.equal(draft.value, '7');
  // A commit the save changes, or one that is refused, shows the saved value again.
  draft.value = '07';
  assert.equal(settle(draft, '07', saved.value), true);
  assert.equal(draft.value, '7');
});

test('a list’s drafts: untouched keys follow the saved values, typed ones stay, new keys fill in', async () => {
  const saved = reactive<Record<string, string>>({ a: 'A', b: 'B' }),
    drafts = useDrafts(() => ({ ...saved }));
  drafts.b = 'typed';
  saved.a = 'A2';
  saved.b = 'B2';
  await nextTick();
  assert.deepEqual({ ...drafts }, { a: 'A2', b: 'typed' });
  // A key that goes (a link switched to belts) and comes back gets its saved value.
  delete saved.a;
  await nextTick();
  saved.a = 'A3';
  await nextTick();
  assert.equal(drafts.a, 'A3');
});
