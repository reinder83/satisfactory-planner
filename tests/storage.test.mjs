import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, mutate, validateState } from '../public/state.js';
import fs from 'node:fs';

test('every assigned storage item has a bundled PNG and source attribution', () => {
  const storage = JSON.parse(
    fs.readFileSync(new URL('../public/plan.json', import.meta.url)),
  ).storage;
  const sources = JSON.parse(
    fs.readFileSync(new URL('../public/icons/sources.json', import.meta.url)),
  );
  for (const item of storage.flatMap(b => b.items).filter(x => x.name)) {
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const png = fs.readFileSync(new URL('../public/icons/' + slug + '.png', import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', item.name);
    assert.match(sources[item.name].source, /^https:\/\/satisfactory\.wiki\.gg\//);
    assert.doesNotMatch(
      sources[item.name].url,
      /Unknown_item/,
      item.name + ' uses the unknown-item placeholder instead of its real icon',
    );
  }
});

test('bulk storage completion preserves legacy keys and unrelated progress', () => {
  const before = initialState();
  before.checks['slot-A01-built'] = true;
  before.checks['factory-3-iron'] = true;
  before.notes['slot-A01'] = 'Keep this belt';
  before.deliveries['3-smart-plating'] = 123;
  const keys = ['A01', 'A02'].flatMap(id =>
    ['built', 'labelled', 'connected', 'verified'].map(k => 'slot-' + id + '-' + k),
  );
  const next = mutate(structuredClone(before), { type: 'checks', keys, value: true });
  for (const key of keys) assert.equal(next.checks[key], true);
  assert.equal(next.checks['factory-3-iron'], true);
  assert.deepEqual(next.notes, before.notes);
  assert.deepEqual(next.deliveries, before.deliveries);
  const restored = validateState(JSON.parse(JSON.stringify(next)));
  assert.deepEqual(restored, next);
  const undone = mutate(restored, { type: 'checks', keys: keys.slice(0, 4), value: false });
  assert.equal(undone.checks['slot-A02-verified'], true);
  assert.throws(() =>
    mutate(structuredClone(before), {
      type: 'checks',
      keys: ['slot-A01-built', '__proto__'],
      value: true,
    }),
  );
  assert.equal(before.checks['slot-A01-verified'], undefined);
});

test('saving an empty note removes only that note without changing existing data', () => {
  const state = initialState();
  state.notes = { 'slot-A01': 'Old note', 'slot-B01': ' Keep whitespace and content ' };
  state.checks['slot-A01-built'] = true;
  const next = mutate(state, { type: 'note', key: 'slot-A01', value: ' \n\t' });
  assert.equal(Object.hasOwn(next.notes, 'slot-A01'), false);
  assert.equal(next.notes['slot-B01'], ' Keep whitespace and content ');
  assert.equal(next.checks['slot-A01-built'], true);
  assert.throws(() =>
    mutate(structuredClone(next), { type: 'note', key: 'slot-A02', value: null }),
  );
});
