// The Storage page shows a refused layout edit as its error toast, in both editions (mutate.ts is
// shared). Owner decision 8 on #387: no "handbook" wording anywhere, so the printed bays A–R are
// "built-in bays", like the built-in floors (#704), and each refusal still says what to do next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, validateState, mutate } from '../public/state.ts';
import type { ProgressState, UpdateOp } from '../public/types/index.ts';

// The refusal `op` gets on `state`, which must be refused.
function refusal(state: ProgressState, op: UpdateOp): string {
  try {
    mutate(structuredClone(state), op);
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail('not refused: ' + JSON.stringify(op));
}

// A bay added under the letter C before #91, sharing the built-in bay's addresses.
const preAdded = () =>
  validateState({
    ...initialState(),
    version: 2,
    storageEdits: {
      floors: [],
      floorNames: {},
      bays: [{ id: 'C', name: 'Old added C', floor: 'ground' }],
      bayNames: {},
      slots: {},
      clearedSlots: [],
    },
  });

test('the storage bay refusals call the printed bays built-in bays and keep their next step (#704)', () => {
  const add = { type: 'storageBayAdd', id: 'C', name: 'My parts', floor: 'ground' } as const;
  const hidden = mutate(initialState(), { type: 'storageBayHide', id: 'C' });
  const taken = mutate(structuredClone(hidden), { ...add, replace: true });
  const messages = [
    [
      refusal(initialState(), add),
      'Bay C is in the room. Hide that built-in bay first, or choose another letter.',
    ],
    [
      refusal(hidden, add),
      'Bay C still has saved progress from the built-in bay. Confirm to replace it.',
    ],
    [
      refusal(initialState(), { type: 'storageBayHide', id: 'S' }),
      'Only built-in bays can be hidden. Remove an added bay instead.',
    ],
    [
      refusal(preAdded(), { type: 'storageBayHide', id: 'C' }),
      'An added bay uses the letter C. Remove it before hiding the built-in bay.',
    ],
    [
      refusal(taken, { type: 'storageBayRestore', id: 'C' }),
      'An added bay uses the letter C. Remove it before restoring the built-in bay.',
    ],
    [
      refusal(initialState(), { type: 'storageBayRemove', id: 'C' }),
      'Only added bays can be removed. Hide a built-in bay instead; its progress is kept.',
    ],
  ];
  for (const [message, expected] of messages) {
    assert.equal(message, expected);
    assert.doesNotMatch(message!, /handbook/i);
  }
});

test('no storage refusal in mutate.ts names the handbook', () => {
  const source = readFileSync(new URL('../public/state/mutate.ts', import.meta.url), 'utf8');
  const messages = [...source.matchAll(/fail\(\s*(['`])((?:(?!\1).)*)\1/g)].map(m => m[2]!);
  assert.ok(messages.length >= 10, 'found the refusals: ' + messages.length);
  for (const message of messages) assert.doesNotMatch(message, /handbook/i);
});

test('the layout editor names the printed bays built-in bays too', () => {
  const source = readFileSync(
    new URL('../public/app/ui/storage/LayoutEditor.vue', import.meta.url),
    'utf8',
  );
  assert.match(source, /saved progress from the built-in bay\. Use/);
  assert.match(source, /Built-in bays and their addresses stay put/);
  // Only comments may still say "handbook".
  const code = source.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /handbook/i);
});
