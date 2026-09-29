// Item icons (#448, #455): the list ItemIcon.vue draws from matches the icons bundled in
// public/icons/, and every item a storage container can be named after has one, with its source
// recorded. A name without artwork, such as a container named after no item, gets ItemIcon's
// placeholder glyph (tests/ui/storage.test.ts checks the drawing).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalog } from '../planner.ts';
import { slug } from '../public/app/format.ts';
import { BUNDLED_ICONS } from '../public/app/icons.ts';

test('the bundled icon list matches public/icons/', () => {
  const files = fs
    .readdirSync(new URL('../public/icons/', import.meta.url))
    .filter(f => f.endsWith('.png'))
    .map(f => f.slice(0, -4))
    .sort();
  assert.deepEqual([...BUNDLED_ICONS].sort(), files);
});

test('every container item has a bundled icon, with its wiki source (#455)', () => {
  assert.deepEqual(
    catalog().containerItems.filter(n => !BUNDLED_ICONS.has(slug(n))),
    [],
  );
  const sources: Record<string, { file: string; url: string; source: string }> = JSON.parse(
    fs.readFileSync(new URL('../public/icons/sources.json', import.meta.url), 'utf8'),
  );
  const recorded = new Set(Object.values(sources).map(x => x.file));
  for (const file of BUNDLED_ICONS) assert.ok(recorded.has(file + '.png'), file + ' has a source');
  for (const [name, x] of Object.entries(sources)) {
    assert.match(x.url, /^https:\/\/satisfactory\.wiki\.gg\/images\//, name);
    assert.match(x.source, /^https:\/\/satisfactory\.wiki\.gg\/wiki\/File:/, name);
  }
});
