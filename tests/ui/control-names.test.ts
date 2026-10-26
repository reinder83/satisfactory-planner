// Repeated controls say what they belong to (#1254, WCAG 2.4.6 and 4.1.2): the Factories page has
// a Running box per production line and Logistics a By select (and Round trip, Fuel) per link,
// which were all named just "Running" and "By". Each name starts with the visible label
// (WCAG 2.5.3 Label in Name) and then names the line or the link; the visible text is unchanged.
// The save dot and ADA's mark stop blinking under reduced motion (WCAG 2.2.2).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import {
  $,
  $$,
  applyUpdate,
  catalog,
  evil,
  generated,
  go,
  open,
  openMigrated,
  page,
  stubFetch,
} from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const noMarkup = () => assert.equal(document.querySelector('x-evil'), null);
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
});

test('each Running box is named after its production line', async () => {
  openMigrated();
  go('factories');
  render();
  await nextTick();
  const cards = $$('#main .factory-card');
  assert.ok(cards.length > 5, 'the page lists several lines');
  for (const card of cards) {
    const box = card.querySelector<HTMLInputElement>('input[data-check]')!;
    const name = card.querySelector('button.name')!.textContent!.trim();
    assert.equal(box.getAttribute('aria-label'), 'Running: ' + name);
    assert.equal(box.closest('label')!.textContent!.trim(), 'Running', 'visible label unchanged');
  }
  const names = new Set(cards.map(card => card.querySelector('button.name')!.textContent));
  const labels = new Set(
    cards.map(card => card.querySelector('input[data-check]')!.getAttribute('aria-label')),
  );
  assert.equal(labels.size, names.size, 'as many distinct names as lines');
});

test('each link’s By, Round trip and Fuel are named after the link, names escaped', async () => {
  const plan = generated();
  const factoryGroups = defaultFactoryGroups(plan);
  factoryGroups.groups[0]!.name = evil;
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: { version: 3, factoryGroups },
  });
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  go('logistics');
  render();
  await nextTick();
  noMarkup();
  const selects = $$<HTMLSelectElement>('[data-link-mode]');
  assert.ok(selects.length > 3, 'several links');
  for (const select of selects) {
    const row = select.closest<HTMLElement>('[data-link-out]')!;
    const from = row.closest('[data-group-card]')!.querySelector('h3')!.textContent!.trim();
    const to = row.querySelector('.flow-end b')!.textContent!.trim();
    const label = select.getAttribute('aria-label')!;
    assert.ok(label.startsWith('By: '), label);
    assert.ok(label.endsWith(` to ${to}`), label);
    // A raw resource's card heading adds what it is; the link names the place.
    assert.ok(from.startsWith(label.slice('By: '.length, -` to ${to}`.length)), label);
  }
  const labels = selects.map(select => select.getAttribute('aria-label'));
  assert.equal(new Set(labels).size, labels.length, 'every link its own name');
  assert.ok(labels.some(label => label!.startsWith(`By: ${evil} to `)), 'user text as text');
  // A road vehicle adds a round trip and a fuel, named after the same link.
  const select = selects.find(one =>
    [...one.options].some(option => option.value === 'truck' && !option.disabled),
  )!;
  const key = select.dataset.linkMode!;
  const between = select.getAttribute('aria-label')!.slice('By: '.length);
  select.value = 'truck';
  select.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(
    $(`[data-link-trip="${key}"]`)!.getAttribute('aria-label'),
    'Round trip in minutes: ' + between,
  );
  assert.equal($(`[data-link-fuel="${key}"]`)!.getAttribute('aria-label'), 'Fuel: ' + between);
  noMarkup();
});

test('under reduced motion the save dot and ADA’s mark, in every tone, do not blink', () => {
  const css = fs.readFileSync('public/style.css', 'utf8');
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .map(match => match[1])
    .join('\n');
  const still = [...blocks.matchAll(/([^{}]+)\{\s*animation: none;/g)].flatMap(match =>
    match[1]!.split(',').map(selector => selector.trim()),
  );
  for (const selector of ['.dot', '.ada-mark', ".ada[data-tone] .ada-mark"])
    assert.ok(still.includes(selector), `${selector} in ${JSON.stringify(still)}`);
  // The fault tone's blink is .ada[data-tone='fault'] .ada-mark: the reduced-motion rule needs
  // the same weight and comes later in the file to win.
  const fault = css.indexOf(".ada[data-tone='fault'] .ada-mark {");
  assert.ok(fault > 0 && fault < css.indexOf('@media (prefers-reduced-motion: reduce)'));
});
