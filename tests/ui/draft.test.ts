// The drafts of fields that save on change (ui/draft.ts, #627, #654, #664): a new saved value
// replaces a draft only while it is untouched, and settle() puts the saved value back after a
// commit unless something else has been typed since.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { resetDraft, settle, useDraft, useDrafts } from '../../public/app/ui/draft.ts';

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

test('a draft typed back to the value saved before is kept (#678)', async () => {
  const saved = ref('4'),
    draft = useDraft(() => saved.value);
  // Committed 9, then the 4 typed back while that save is in flight.
  draft.value = '9';
  draft.value = '4';
  saved.value = '9';
  await nextTick();
  assert.equal(draft.value, '4', 'typed after the commit: kept, though it equals the value before');
  assert.equal(settle(draft, '9', saved.value), false, 'the commit of 9 leaves the 4');
  assert.equal(draft.value, '4');
  // Typed but not committed: another tab's value leaves it too.
  saved.value = '6';
  await nextTick();
  assert.equal(draft.value, '4');
  // Once its commit settles, the draft is untouched again and follows the saved value.
  saved.value = '4';
  await nextTick();
  assert.equal(settle(draft, '4', saved.value), true);
  saved.value = '2';
  await nextTick();
  assert.equal(draft.value, '2', 'untouched after the commit: another tab’s value is shown');
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

test('a list’s draft typed back to the value saved before is kept (#683)', async () => {
  const saved = reactive<Record<string, string>>({ a: 'A', b: 'B' }),
    drafts = useDrafts(() => ({ ...saved }));
  // Typed in and back to the saved name, not committed: another tab's rename leaves it.
  drafts.a = 'Ax';
  drafts.a = 'A';
  saved.a = 'A2';
  saved.b = 'B2';
  await nextTick();
  assert.deepEqual(
    { ...drafts },
    { a: 'A', b: 'B2' },
    'typed: kept, though it equals the value before',
  );
  // After its commit, the handler puts the saved value back, untouched: it follows again.
  saved.a = 'A';
  await nextTick();
  resetDraft(drafts, 'a', saved.a!);
  saved.a = 'A3';
  await nextTick();
  assert.equal(drafts.a, 'A3', 'untouched after the commit: another tab’s value is shown');
  // A key that goes after being typed in comes back untouched, with its saved value.
  drafts.b = 'typed';
  delete saved.b;
  await nextTick();
  assert.equal('b' in drafts, false, 'the key goes');
  saved.b = 'B3';
  await nextTick();
  assert.equal(drafts.b, 'B3');
  saved.b = 'B4';
  await nextTick();
  assert.equal(drafts.b, 'B4');
});
