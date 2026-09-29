// Item icons (#448): the list ItemIcon.vue draws from matches the icons bundled in public/icons/,
// and the items a storage container can be named after that have no bundled icon are known, so a
// new one is noticed. Those, and any other name without artwork, get ItemIcon's placeholder glyph
// (tests/ui/storage.test.ts checks the drawing).
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

test('the container items without a bundled icon are the equipment and the coupon', () => {
  const missing = catalog().containerItems.filter(n => !BUNDLED_ICONS.has(slug(n)));
  assert.deepEqual(missing, [
    'Blade Runners',
    'Chainsaw',
    'Factory Cart™',
    'FICSIT Coupon',
    'Gas Mask',
    'Golden Factory Cart™',
    'Hazmat Suit',
    'Hoverpack',
    'Jetpack',
    'Nobelisk Detonator',
    'Object Scanner',
    'Parachute',
    'Rebar Gun',
    'Rifle',
    'Xeno-Basher',
    'Xeno-Zapper',
    'Zipline',
  ]);
});
