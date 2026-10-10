// Polish from #1020 and #1019:
// - Byproduct advice (#1033): a row split over several factories shows, on each factory's flow
//   page, only its part there (what that part sends and takes, at its rates), not the whole line's
//   advice, in its card and in "The diagram as a table", which now has the ♻ lines too;
// - Made on site (#1027 review): a mark that central lines' byproduct covers reads the same,
//   "(a byproduct of central lines covers it)", whether the plan makes the item only as a byproduct
//   (Heavy Oil Residue) or a central byproduct of a fluid feeds the factory first (Dark Matter
//   Residue); a radioactive item keeps "(can't be made on site)";
// - Factories (#1126 review): the jump bar's button with a long unbroken factory name wraps rather
//   than running out of the page. Layout is not measurable in happy-dom, so this checks that a
//   rule of public/style.css gives the button overflow-wrap: anywhere outside the phone layout;
//   the overflow itself was measured in Chrome (see the pull request).
// Numbers read as in en-US.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import {
  flowRoute,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  viewOf,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { rowTotal } from '../../public/app/group-order.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { onSiteEntriesText } from '../../public/app/on-site-picker.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, generated, generatedWith, go, open, page } from './setup.ts';
import type { FactoryGroups, StageKey, StoredCalculatedPlan } from '../../public/types/index.ts';

const COVERED = '(a byproduct of central lines covers it)';
const text = (element: Element | null) =>
  (element?.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const toLocale = Number.prototype.toLocaleString;
beforeAll(() => {
  Number.prototype.toLocaleString = function (
    this: number,
    _locale?: unknown,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocale.call(this, 'en-US', options);
  };
});
afterAll(() => {
  Number.prototype.toLocaleString = toLocale;
});
beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
});

// --- Byproduct advice on a flow page, for a split row ---

// Every alternate from Phase 3, Phase 4 shown, with the Aluminum Scrap line split half and half
// between Aluminum campus and Industrial parts.
const plan = generatedWith({ phase: '3', recipes: 'all' });
const scrap = plan.stages['4'].rows!.find(row => row.name === 'Aluminum Scrap')!;
const defaults = defaultFactoryGroups(plan);
const split: FactoryGroups = {
  ...defaults,
  assignments: {
    ...defaults.assignments,
    [scrap.id]: [
      { group: 'fg-alumn1', rate: rowTotal(scrap) / 2 },
      { group: 'fg-parts1', rate: null },
    ],
  },
};

async function showFlow(groupId: string) {
  open({ calculated: structuredClone(plan), phase: '4', state: { factoryGroups: split } });
  location.hash = '#' + flowRoute(groupId);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
}
const scrapWater = () =>
  text($(`#main .gf-card[data-line="${scrap.id}"] .gf-out[data-row$="|Water"] .gf-advice`));
// The table's ♻ rows as "<#> <line> | <item> | <advice>".
const tableAdvice = () =>
  $$('#main [data-gf-advice-table] tbody tr').map(row =>
    [...row.querySelectorAll('td')].map(text).join(' | '),
  );

test("a split row's ♻ line on a flow page is the factory's part, in the card and the table", async () => {
  await showFlow('fg-alumn1');
  // Aluminum campus's half sends all its Water to the campus's Alumina Solution line, not the
  // whole line's "Send 109.17 m³ back to Alumina Solution, …, and 7.01 m³ to Cooling System in
  // Industrial parts".
  assert.equal(scrapWater(), '♻ Send all of it back to Alumina Solution, which feeds this line.');
  const rows = tableAdvice();
  assert.ok(
    rows.includes(
      '06 | Aluminum Scrap | → Water 58.09 m³/min | ♻ Send all of it back to Alumina Solution, which feeds this line.',
    ),
    rows.join('\n'),
  );
  // An unsplit line's advice is the same as on its card.
  const solution = text(
    $(`#main .gf-card[data-line$="AluminaSolution_C"] .gf-in[data-row$="|Water"] .gf-advice`),
  );
  assert.match(
    solution,
    /^♻ 58\.09 m³ recycled from Aluminum Scrap, 51\.08 m³ recycled from Aluminum Scrap in Industrial parts/,
  );
  assert.ok(
    rows.some(row => row.endsWith(' | ' + solution)),
    'the table repeats the card',
  );
  assert.equal(text($('#main [data-gf-advice-table] caption')), 'Byproducts and water');
  assert.equal(
    $$('#main [data-gf-advice-table] thead th').map(text).join(','),
    '#,Line,Item,Advice',
  );
});

test("the other factory's flow page gives that factory's part of the split row", async () => {
  await showFlow('fg-parts1');
  // Industrial parts' half pools its Water with the Battery line there.
  assert.equal(
    scrapWater(),
    '♻ Pool it with the others: 74.6 m³ in from this line and Battery; out 65.6 m³ to Alumina Solution in Aluminum campus (≈ 7/8) and 9 m³ to Cooling System (≈ 1/8).',
  );
  assert.ok(
    tableAdvice().some(row =>
      row.startsWith('03 | Aluminum Scrap | → Water 58.09 m³/min | ♻ Pool'),
    ),
    tableAdvice().join('\n'),
  );
});

// --- Made on site: one note for a mark central lines' byproduct covers ---

const ALPHA = 'fg-alpha1';
const marked = (group: string) => text($(`#section-${group} [data-on-site-marked]`)) || null;
async function showFactories(shown: StoredCalculatedPlan, groups: FactoryGroups, phase: StageKey) {
  location.hash = '#factories';
  go('factories');
  open({ calculated: shown, phase, state: { factoryGroups: groups } });
  render();
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
}

test('a mark the plan makes only as a central byproduct reads that the byproduct covers it', async () => {
  await showFactories(
    generated(),
    {
      groups: [{ id: ALPHA, name: 'Alpha' }],
      assignments: { Recipe_ResidualFuel_C: [{ group: ALPHA, rate: null }] },
      local: { [ALPHA]: ['Heavy Oil Residue'] },
    },
    '3',
  );
  assert.equal(marked(ALPHA), `Marked, not made on site: Heavy Oil Residue ${COVERED}`);
});

test('a mark whose line the central byproduct of a fluid replaces reads the same', async () => {
  // Gamma holds a third of the Dark Matter Crystal line and marks Dark Matter Residue, which the
  // Space Elevator part lines make as a byproduct: recalculated, Gamma gets no line (#1012).
  const GAMMA = 'fg-gamma1';
  const groups: FactoryGroups = {
    groups: [
      { id: GAMMA, name: 'Gamma' },
      { id: 'fg-delta1', name: 'Delta' },
      { id: 'fg-epsil1', name: 'Epsilon' },
    ],
    assignments: {
      Recipe_DarkMatter_C: [GAMMA, 'fg-delta1', 'fg-epsil1'].map(group => ({ group, rate: null })),
    },
    local: { [GAMMA]: ['Dark Matter Residue'] },
  };
  const base = generated();
  const recalculated = generatedWith({ ...base.settings, onSite: onSiteSettings(base, groups) });
  await showFactories(recalculated, groups, '5');
  assert.equal(marked(GAMMA), `Marked, not made on site: Dark Matter Residue ${COVERED}`);
});

test('the note reads plural after two or more marks', () => {
  assert.equal(
    onSiteEntriesText([
      { item: 'Dark Matter Residue', note: COVERED },
      { item: 'Heavy Oil Residue', note: COVERED },
    ]),
    'Dark Matter Residue and Heavy Oil Residue (a byproduct of central lines covers them)',
  );
});

// --- Factories: the jump bar's button with a long unbroken name ---

// The rules of public/style.css with the @media condition they sit in (one level), comments out.
function rules(css: string, media: string | null = null) {
  const out: { media: string | null; selectors: string[]; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf('{', i);
    if (start < 0) break;
    const head = css.slice(i, start).trim();
    let depth = 1,
      end = start + 1;
    for (; depth && end < css.length; end++)
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
    const body = css.slice(start + 1, end - 1);
    if (head.startsWith('@media')) out.push(...rules(body, head));
    else if (!head.startsWith('@'))
      out.push({ media, selectors: head.split(',').map(s => s.trim()), body });
    i = end;
  }
  return out;
}

test('a jump bar button with a long unbroken factory name wraps inside the page', async () => {
  const LONG = 'NorthernCopperWireManufacturingDistrictSeventeenAnnexBuildingABCDEFGHIJKLMNOPQRS';
  const shown = generated();
  const groups = defaultFactoryGroups(shown);
  groups.groups[1] = { ...groups.groups[1]!, name: LONG };
  await showFactories(shown, groups, '3');
  const button = $$('#main .jump-bar .btn').find(element => text(element).includes(LONG));
  assert.ok(button, 'the jump bar has the long name');
  const css = fs.readFileSync('public/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const wraps = rules(css).some(
    rule =>
      rule.media === null &&
      /overflow-wrap:\s*anywhere/.test(rule.body) &&
      rule.selectors.some(selector => {
        for (let node: Element | null = button; node; node = node.parentElement)
          if (node.matches(selector)) return true;
        return false;
      }),
  );
  assert.ok(wraps, 'an overflow-wrap: anywhere rule reaches the button at any width');
  // On a phone the bar still keeps one row and scrolls within itself.
  const phone = rules(css).filter(rule => rule.media && /max-width:\s*720px/.test(rule.media));
  assert.ok(
    phone.some(
      rule => rule.selectors.includes('.jump-bar .btn') && /white-space:\s*nowrap/.test(rule.body),
    ),
  );
});
