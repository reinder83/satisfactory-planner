// The Factories page's group headings and group editor at any width (#986, #994, #960): a factory
// name of one unbroken 80-character word wraps wherever the page draws it, a generator's rate
// hint wraps inside the rate and ✕ columns instead of widening the ✕ column, and on a phone the
// rate field and "+ Add to factory…" are 44px touch targets like the ✕ and Add beside them.
// Layout is not measurable in happy-dom, so this checks that the elements the page draws are the
// ones the rules in public/style.css reach; the layout itself was measured in Chrome at 1440 and
// 390 px (see the pull request).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generated, go, open, page } from './setup.ts';

beforeEach(() => page());

interface Rule {
  media: string | null;
  selectors: string[];
  body: string;
}
// The style rules of public/style.css, each with the @media condition it sits in (one level).
function parse(css: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1,
      end = open + 1;
    while (depth && end < css.length) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
      end++;
    }
    const body = css.slice(open + 1, end - 1);
    if (head.startsWith('@media')) rules.push(...parse(body, head));
    else if (!head.startsWith('@'))
      rules.push({ media, selectors: head.split(',').map(s => s.trim()), body });
    i = end;
  }
  return rules;
}
const RULES = parse(fs.readFileSync('public/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
const decl = (body: string, prop: string) =>
  body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]!.trim();
const matches = (el: Element, selector: string) => {
  try {
    return el.matches(selector);
  } catch {
    return false; // a selector happy-dom does not parse
  }
};
// The selectors of the rules for which `test` holds, under the given @media condition.
const selectorsWith = (test: (body: string) => boolean, media: (m: string | null) => boolean) =>
  RULES.filter(rule => media(rule.media) && test(rule.body)).flatMap(rule => rule.selectors);
const anyWidth = (m: string | null) => m === null;
const phone = (m: string | null) => !!m && /max-width:\s*720px/.test(m);

const LONG = 'NorthernCopperWireManufacturingDistrictSeventeenAnnexBuildingABCDEFGHIJKLMNOPQRS';
const wrapping = selectorsWith(body => decl(body, 'overflow-wrap') === 'anywhere', anyWidth);
// An element wraps a long word when a rule gives it, or an element around it, overflow-wrap:
// anywhere (the property is inherited).
const wraps = (el: Element) => {
  for (let node: Element | null = el; node; node = node.parentElement)
    if (wrapping.some(selector => matches(node!, selector))) return true;
  return false;
};

async function show(editing: boolean) {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const generator = rows.find(r => r.generationMW > 0)!;
  const line = rows.find(r => !r.generationMW && Object.keys(r.outputs).length)!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-long01', name: LONG },
          { id: 'fg-power', name: 'Power' },
        ],
        assignments: {
          [generator.id]: [
            { group: 'fg-long01', rate: 0.0001 },
            { group: 'fg-power', rate: null },
          ],
          [line.id]: [{ group: 'fg-long01', rate: 5 }],
        },
      },
    },
  });
  go('factories');
  setFactoryEditing(editing);
  render();
  await nextTick();
  return { generator, line };
}

// The elements that draw the long name as their own text. The jump bar scrolls within itself by
// design, and an <option> is drawn by the browser's own menu.
const drawingLong = () =>
  $$('#app *').filter(
    el =>
      [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.includes(LONG)) &&
      !el.closest('.jump-bar, option'),
  );

test('a long unbroken factory name wraps in its heading and card lines (#986)', async () => {
  await show(false);
  const heading = $('.site-group .site-head h2');
  assert.ok(
    drawingLong().some(el => el === heading),
    'the factory heading is drawn with the long name',
  );
  for (const el of drawingLong()) assert.ok(wraps(el), `${el.outerHTML.slice(0, 80)} wraps`);
  const allocations = $$('.factory-card .allocation');
  assert.ok(allocations.length, 'a card has its share line');
  for (const el of allocations) assert.ok(wraps(el), `${el.textContent} wraps`);
});

test('a long unbroken factory name wraps in the group editor and the picker legend (#986)', async () => {
  await show(true);
  const drawn = drawingLong();
  assert.ok(
    drawn.some(el => el.matches('.assign-row > span')),
    'the editor row names the factory',
  );
  assert.ok(
    drawn.some(el => el.closest('.on-site-picker legend')),
    'the picker legend names the factory',
  );
  for (const el of drawn) assert.ok(wraps(el), `${el.outerHTML.slice(0, 80)} wraps`);
});

test('a generator’s rate hint and tiny-rate note wrap inside their columns (#994)', async () => {
  await show(true);
  const contained = selectorsWith(
    body => /\binline-size\b/.test(decl(body, 'contain') || ''),
    anyWidth,
  );
  const hints = $$('.assign-row .assign-unit');
  assert.ok(hints.length, 'the generator’s rate fields have a hint');
  assert.ok($('.assign-row .assign-tiny'), 'the tiny rate has a note');
  for (const el of [...hints, ...$$('.assign-row .assign-tiny')])
    assert.ok(
      contained.some(selector => matches(el, selector)),
      `${el.outerHTML} does not size the grid's columns`,
    );
});

test('on a phone the rate field and "+ Add to factory…" are 44px touch targets (#960)', async () => {
  await show(true);
  const targets = selectorsWith(body => {
    const height = decl(body, 'min-height')?.match(/^(\d+)px$/);
    return !!height && Number(height[1]) >= 44;
  }, phone);
  const controls = [
    ...$$('.assign-row input'),
    ...$$('.assign-row button'),
    ...$$('.assign-add select'),
    ...$$('.assign-add button'),
  ];
  assert.ok($('.assign-row input') && $('.assign-add select'), 'the editor is drawn');
  for (const el of controls)
    assert.ok(
      targets.some(selector => matches(el, selector)),
      `${el.outerHTML.slice(0, 100)} is at least 44px tall on a phone`,
    );
});
