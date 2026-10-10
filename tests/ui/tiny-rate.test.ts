// A rate too small a part of its production line to count, in a factory card's group editor
// (AssignEditor.vue), gets a soft note under its field (#942): rowShares (group-order.ts) leaves
// out a share of rate / total at or below LINK_DUST, so the group's flow, the Logistics page and
// the build plan leave the line out of the group. The note uses the line's own total (#1005), and
// falls back to a rate below 0.001 when the editor has none. The rate is still saved; validation
// does not refuse it.
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { LINK_DUST, rowTotal } from '../../public/app/group-order.ts';
import { setFactoryEditing } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import AssignEditor from '../../public/app/ui/factories/AssignEditor.vue';
import type { UpdateOp } from '../../public/types/index.ts';
import {
  $,
  applyUpdate,
  generated,
  go,
  migratedPlan,
  migratedRow,
  open,
  page,
  stubFetch,
} from './setup.ts';

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
const NOTE = "So small a part of this production line's output that this factory won't count it.";
const FALLBACK = 'Under 0.001/min: so small this factory may not count it.';

// The migrated plan's Wire line makes 9,600/min: a rate counts above 0.0096/min.
const WIRE_TOTAL = 9600;

async function editGroups(rate: number, row = migratedRow('wire')) {
  open({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cable factory' },
          { id: 'fg-plates1', name: 'Stitched plates' },
        ],
        assignments: {
          [row]: [
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
  return row;
}

test('the Wire line makes 9,600/min in the migrated plan', () => {
  const wire = migratedPlan().stages['3']!.rows!.find(row => row.id === migratedRow('wire'))!;
  assert.equal(rowTotal(wire), WIRE_TOTAL);
});

test('a saved rate too small a part of its line to count has a note, which describes the field', async () => {
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

test('the note follows what is typed, at the line’s own threshold, and the rate is still saved', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const wire = await editGroups(300);
  const fixed = field(wire, 'fg-cable01');
  assert.equal(fixed.getAttribute('aria-describedby'), null, 'an ordinary rate has none');
  for (const [typed, note] of [
    ['0.0009', [NOTE]],
    // At or above 0.001/min, but still at most a millionth of 9,600/min (#1005).
    ['0.001', [NOTE]],
    ['0.009', [NOTE]],
    [String(WIRE_TOTAL * LINK_DUST * 0.999), [NOTE]],
    [String(WIRE_TOTAL * LINK_DUST * 1.001), []],
    ['0.011', []],
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

test('a rate under 0.001/min that counts for a small line has no note (#1005)', async () => {
  // A line of the migrated plan making under 500/min: 0.0005/min of it is over a millionth.
  const small = migratedPlan().stages['3']!.rows!.find(row => {
    const total = rowTotal(row);
    return total > 1 && total < 500 && !row.generationMW;
  })!;
  assert.ok(small, 'the migrated plan has a small line');
  assert.ok(0.0005 / rowTotal(small) > LINK_DUST, 'the rate counts');
  await editGroups(0.0005, small.id);
  assert.deepEqual(described(field(small.id, 'fg-cable01')), []);
});

test('a generator’s field keeps its unit and adds the note at its own MW threshold', async () => {
  const plan = generated();
  const generator = plan.stages['3'].rows!.find(
    r => r.generationMW > 0 && !Object.keys(r.outputs).length,
  )!;
  // The default plan's fuel power line makes over 1,000 MW: 0.001 MW is too small a part of it.
  assert.ok(rowTotal(generator) > 1000, `${generator.id} makes ${rowTotal(generator)} MW`);
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-power', name: 'Power' }],
        assignments: { [generator.id]: [{ group: 'fg-power', rate: 0.0005 }] },
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  const input = field(generator.id, 'fg-power');
  assert.deepEqual(described(input), ['MW', NOTE]);
  await typeRate(input, '0.001');
  assert.deepEqual(described(input), ['MW', NOTE], 'not under 0.001 MW, still too small');
  await typeRate(input, String(rowTotal(generator) * LINK_DUST * 1.01));
  assert.deepEqual(described(input), ['MW'], 'a rate that counts has no note');
});

test('an editor without a total falls back to a rate below 0.001', async () => {
  const wire = await editGroups(0.0009);
  const el = document.createElement('div');
  document.body.append(el);
  const app = createApp({ render: () => h(AssignEditor, { factoryKey: wire }) });
  app.mount(el);
  await nextTick();
  const input = el.querySelector<HTMLInputElement>('[data-group="fg-cable01"]')!;
  assert.deepEqual(described(input), [FALLBACK]);
  await typeRate(input, '0.001');
  assert.deepEqual(described(input), []);
  app.unmount();
  el.remove();
});
