// The vehicle, round trip and fuel controls of a link on the Logistics page (#674,
// ui/factories/GroupLinks.vue) are 44px touch targets on a phone, and unchanged on wider screens.
// Layout is not measurable in happy-dom, so this checks the component's scoped rule; build.ts
// ships it after style.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs
    .readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const component = read('public/app/ui/factories/GroupLinks.vue');
const style = /<style scoped>([\s\S]*?)<\/style>/.exec(component)?.[1] ?? '';

// The phone breakpoint style.css uses for its own 44px targets.
const PHONE = 720;

test("a link row's controls are 44px tall at phone widths (#674)", () => {
  assert.ok(style, 'GroupLinks.vue has a scoped style block');
  assert.ok(
    read('public/style.css').includes(`@media (max-width: ${PHONE}px)`),
    `style.css still uses the ${PHONE}px phone breakpoint`,
  );
  const block = new RegExp(
    `@media \\(max-width: ${PHONE}px\\)\\s*\\{\\s*([^{}]+)\\{([^{}]*)\\}\\s*\\}`,
  ).exec(style);
  assert.ok(block, `the rule sits in a max-width: ${PHONE}px block`);
  const selectors = block[1]!.split(',').map(s => s.trim());
  assert.deepEqual(selectors.sort(), ['.link-transport input', '.link-transport select']);
  assert.match(block[2]!, /(^|[;\s])min-height:\s*44px\s*;/);
});

test('the component adds nothing outside the phone block, so wider screens are unchanged', () => {
  const outside = style.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').trim();
  assert.equal(outside, '');
});
