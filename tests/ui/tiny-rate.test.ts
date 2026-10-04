// A rate below 0.001 in a factory card's group editor (AssignEditor.vue) gets a soft note under
// its field (#942): a share that small of a factory's output counts as rounding dust, so the
// group's flow, the Logistics page and the build plan may leave the factory out of the group.
// The rate is still saved; validation does not refuse it.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import type { UpdateOp } from '../../public/types/index.ts';
import { $, applyUpdate, generated, go, migratedRow, open, page, stubFetch } from './setup.ts';

beforeEach(() => page());

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const plain = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
const field = (id: string, group: string) =>
  $<HTMLInputElement>(`[data-assign-rate="${id}"][data-group="${group}"]`)!;
// The texts the field's aria-describedby points at, in order.
const described = (input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') || '')
    .split(' ')
    .filter(Boolean)
    .map(id => plain(document.getElementById(id)?.textContent));
const typeRate = async (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await nextTick();
};
const NOTE = 'Under 0.001/min: so small this factory may not count it.';

async function editGroups(rate: number) {
  const wire = migratedRow('wire');
  open({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cable factory' },
          { id: 'fg-plates1', name: 'Stitched plates' },
        ],
        assignments: {
          [wire]: [
            { group: 'fg-cable01', rate },
            { group: 'fg-plates1', rate: null },
          ],
        },
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  return wire;
}

test('a saved rate below 0.001 has a note under its field, which describes the field', async () => {
  const wire = await editGroups(0.0002);
  const fixed = field(wire, 'fg-cable01'),
    rest = field(wire, 'fg-plates1');
  assert.deepEqual(described(fixed), [NOTE]);
  const note = document.getElementById(fixed.getAttribute('aria-describedby')!)!;
  assert.ok(note.matches('small.assign-tiny[data-tiny-rate]'), note.outerHTML);
  assert.equal(note.closest('.assign-row'), fixed.closest('.assign-row'), 'under its own field');
  assert.equal(rest.getAttribute('aria-describedby'), null, 'an empty field has no note');
  // Wire's card is drawn in both groups' sections, each with an editor: a note under each tiny
  // rate field, every one with its own id.
  const tinyFields = document.querySelectorAll(
    `[data-assign-rate="${wire}"][data-group="fg-cable01"]`,
  );
  const notes = [...document.querySelectorAll('[data-tiny-rate]')];
  assert.equal(notes.length, tinyFields.length);
  assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
});

test('the note follows what is typed, and the tiny rate is still saved', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const wire = await editGroups(300);
  const fixed = field(wire, 'fg-cable01');
  assert.equal(fixed.getAttribute('aria-describedby'), null, 'an ordinary rate has none');
  for (const [typed, note] of [
    ['0.0009', [NOTE]],
    ['0.001', []],
    ['1e-5', [NOTE]],
    ['0', []], // refused on save with its own message
    ['-0.0001', []],
    ['', []],
    ['abc', []],
  ] as const) {
    await typeRate(fixed, typed);
    assert.deepEqual(described(fixed), note, `typed "${typed}"`);
  }
  await typeRate(fixed, '0.0004');
  fixed.dispatchEvent(new Event('change'));
  await settle();
  const sent = calls.at(-1)![1];
  assert.equal(sent.type, 'factoryAssign');
  assert.deepEqual(sent.type === 'factoryAssign' && sent.groups, [
    { group: 'fg-cable01', rate: 0.0004 },
    { group: 'fg-plates1', rate: null },
  ]);
  assert.equal(field(wire, 'fg-cable01').value, '0.0004');
  assert.deepEqual(described(field(wire, 'fg-cable01')), [NOTE], 'the saved rate keeps it');
});

test('a generator’s field keeps its unit and adds the note in MW', async () => {
  const plan = generated();
  const coal = plan.stages['3'].rows!.find(
    r => r.generationMW > 0 && !Object.keys(r.outputs).length,
  )!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-power', name: 'Power' }],
        assignments: { [coal.id]: [{ group: 'fg-power', rate: 0.0005 }] },
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.deepEqual(described(field(coal.id, 'fg-power')), [
    'MW',
    'Under 0.001 MW: so small this factory may not count it.',
  ]);
});
