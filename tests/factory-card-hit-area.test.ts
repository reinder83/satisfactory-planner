// The name button's ::after covers a whole factory card, so the card opens its dialog wherever it
// is clicked (SP-19). Every other control on the card must sit above that overlay
// (`position: relative; z-index: 1`), or a click on it opens the dialog instead (#1306: the built
// counter, #1300, was missing). A hit test is not possible in happy-dom, so this reads the rule in
// style.css and the controls the card template draws; browser-check.ts clicks them with a mouse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const style = read('../public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The controls a card holds apart from its name: the class of each interactive element's root.
const CONTROLS = ['.check-row', '.built-counter', '.assign-editor'];

// The selectors of the first top-level rule whose body sets `declaration` and that lists `needle`.
function selectorsOf(needle: string) {
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match; (match = rule.exec(style));) {
    const selectors = match[1]!.split(',').map(s => s.trim());
    if (selectors.includes(needle)) return { selectors, body: match[2]! };
  }
  assert.fail(`no rule for ${needle}`);
}

test('the name stretches over the card, and every control sits above it (#1306)', () => {
  assert.ok(selectorsOf('.factory-card .name::after').body.includes('inset: 0'));
  const lifted = selectorsOf('.factory-card .check-row');
  assert.match(lifted.body, /position:\s*relative/);
  assert.match(lifted.body, /z-index:\s*[1-9]/);
  for (const control of CONTROLS)
    assert.ok(
      lifted.selectors.includes(`.factory-card ${control}`),
      `${control} is lifted above the name's overlay`,
    );
});

test('the card template draws no interactive control outside the lifted ones', () => {
  const template = read('../public/app/ui/factories/CalcFactoryCard.vue');
  const markup = template.slice(template.indexOf('<template>'));
  // Components the card mounts that hold controls, each by its root class.
  assert.match(markup, /<BuiltCounter\b/);
  assert.match(markup, /class="check-row"/);
  assert.match(markup, /<AssignEditor\b/);
  // Raw controls in the card itself: only the name button and the Running box's checkbox.
  const raw = [...markup.matchAll(/<(button|a|input|select|textarea)\b([^>]*)/g)];
  for (const [, tag, attrs] of raw)
    assert.ok(
      (tag === 'button' && /class="name"/.test(attrs!)) ||
        (tag === 'input' && /type="checkbox"/.test(attrs!)),
      `unexpected <${tag}> in the card: lift it above the name's overlay too`,
    );
});
