// The factory dialog of a factory group's own line made on site (#946, part of #868) is headed as
// its build-plan step and its flow-page card name it, "Wire for Alpha" (buildRowName), however it
// is opened: the flow page's "↗", the build-plan step's "Production line ↗" (whose name says the same)
// and the factory card. The dialog is named by that heading (aria-labelledby="detail-title"), so
// its name tells the group's line from the central one, which keeps its plain "Wire". A renamed
// group renames the heading, and a hostile group name stays text. The plan is the planner's own,
// calculated in Node with Alpha and Beta marking Wire, as on-site-flow-cards.test.ts makes it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { onSiteSettings } from '../../public/app/on-site.ts';
import {
  flowRoute,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  viewOf,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, evil, generatedWith, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  GAMMA = 'fg-gamma3';
const WIRE = 'Recipe_Wire_C';
const ownLine = (groupId: string) => `${WIRE}:${groupId}`;

const plain = generatedWith(BASE);
const cableRate = plain.stages['3'].rows!.find(row => row.id === 'Recipe_Cable_C')!.outputs.Cable!;
const groups: FactoryGroups = {
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
    { id: GAMMA, name: 'Gamma' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: ALPHA, rate: null }],
    Recipe_Cable_C: [
      { group: BETA, rate: cableRate / 2 },
      { group: GAMMA, rate: null },
    ],
    [WIRE]: [{ group: GAMMA, rate: null }],
  },
  local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
};
const plan = generatedWith({ ...BASE, onSite: onSiteSettings(plain, groups) });
const renamed = (name: string): FactoryGroups => ({
  ...groups,
  groups: groups.groups.map(group => (group.id === ALPHA ? { ...group, name } : group)),
});

// The attributes index.html gives <dialog id="detail"> (aria-labelledby among them), which page()
// leaves out: the dialog is checked as the app ships it.
const shipped = readFileSync('public/index.html', 'utf8');
const detailAttrs = [
  ...(/<dialog\s+id="detail"([^>]*)>/.exec(shipped)?.[1] ?? '').matchAll(/([\w-]+)="([^"]*)"/g),
];

beforeEach(() => {
  page();
  const dialog = $<HTMLDialogElement>('#detail')!;
  for (const [, name, value] of detailAttrs) dialog.setAttribute(name!, value!);
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
});

// Opens `route` (a page's hash route) of the plan above with `factoryGroups`, as a deep link does.
async function show(route: string, factoryGroups: FactoryGroups = groups) {
  open({ calculated: structuredClone(plan), state: { factoryGroups } });
  location.hash = '#' + route;
  go(viewOf(route));
  render();
  await nextTick();
  await nextTick();
}

// Presses the page's link `selector` and returns the dialog it opened: its heading and its
// accessible name, the text of the elements its aria-labelledby points at.
async function openBy(selector: string) {
  const link = $<HTMLElement>(selector);
  assert.ok(link, selector + ' is on the page');
  link.click();
  await nextTick();
  const dialog = $<HTMLDialogElement>('#detail')!;
  assert.ok(dialog.open, 'the dialog is open');
  const ids = (dialog.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  assert.deepEqual(ids, ['detail-title']);
  const name = ids
    .map(id => document.getElementById(id))
    .map(el => {
      assert.ok(el && dialog.contains(el), 'aria-labelledby points inside the dialog');
      return el.textContent!.trim();
    })
    .join(' ');
  // A link's name: its aria-label where it has one (the build-plan step's "Production line ↗").
  const linkName = link.getAttribute('aria-label') ?? link.textContent!.trim();
  return { link: linkName, heading: $('#detail h2')!.textContent, name };
}
const flowLink = (id: string) => `#main .gf-card[data-line="${id}"] .gf-head .rail-link`;
const stepLink = (id: string) => `#main [data-task="calc-3-${id}"] .task-link[data-calc-factory]`;
const cardLink = (id: string) => `#main .factory-card button.name[data-calc-factory="${id}"]`;

test('the flow page’s "Wire for Alpha ↗" opens a dialog headed and named "Wire for Alpha"', async () => {
  await show(flowRoute(ALPHA));
  const opened = await openBy(flowLink(ownLine(ALPHA)));
  assert.equal(opened.link, 'Wire for Alpha ↗');
  assert.equal(opened.heading, 'Wire for Alpha');
  assert.equal(opened.name, 'Wire for Alpha');

  await show(flowRoute(BETA));
  const beta = await openBy(flowLink(ownLine(BETA)));
  assert.equal(beta.heading, 'Wire for Beta');
  assert.equal(beta.name, 'Wire for Beta');
});

test('the central line’s dialog keeps its plain heading, "Wire"', async () => {
  await show(flowRoute(GAMMA));
  const opened = await openBy(flowLink(WIRE));
  assert.equal(opened.link, 'Wire ↗');
  assert.equal(opened.heading, 'Wire');
  assert.equal(opened.name, 'Wire');
});

test('the build-plan step’s "Production line" button and the dialog it opens name the same line', async () => {
  await show('plan');
  const own = await openBy(stepLink(ownLine(ALPHA)));
  assert.equal(own.link, 'Production line: Wire for Alpha');
  assert.equal(own.heading, 'Wire for Alpha');
  assert.equal(own.name, 'Wire for Alpha');
  $<HTMLDialogElement>('#detail')!.close();

  const central = await openBy(stepLink(WIRE));
  assert.equal(central.link, 'Production line: Wire');
  assert.equal(central.heading, 'Wire');
});

test('the factory card opens the same heading; the card keeps "Wire" and its site line', async () => {
  await show('factories');
  const card = $(cardLink(ownLine(ALPHA)))!.closest('.factory-card')!;
  assert.equal(card.querySelector('[data-on-site]')?.textContent, 'Made on site for Alpha');
  const own = await openBy(cardLink(ownLine(ALPHA)));
  assert.equal(own.link, 'Wire');
  assert.equal(own.heading, 'Wire for Alpha');
  assert.equal(own.name, 'Wire for Alpha');
  // The heading names the group, and the dialog has no separate "Made on site for Alpha" line
  // (the deliveries' note may name it too, #965).
  assert.doesNotMatch($('#detail')!.textContent!, /Made on site for/);
  $<HTMLDialogElement>('#detail')!.close();

  const central = await openBy(cardLink(WIRE));
  assert.equal(central.heading, 'Wire');
  assert.equal(central.name, 'Wire');
});

test('a renamed group renames the heading, and a removed one keeps the plan’s name', async () => {
  await show(flowRoute(ALPHA), renamed('Alpha Works'));
  const opened = await openBy(flowLink(ownLine(ALPHA)));
  assert.equal(opened.heading, 'Wire for Alpha Works');
  assert.equal(opened.name, 'Wire for Alpha Works');

  // With Alpha gone the line is named as the plan was calculated, as its step is.
  const without: FactoryGroups = {
    ...groups,
    groups: groups.groups.filter(group => group.id !== ALPHA),
  };
  await show('plan', without);
  const step = await openBy(stepLink(ownLine(ALPHA)));
  assert.equal(step.link, 'Production line: Wire for Alpha');
  assert.equal(step.heading, 'Wire for Alpha');
});

test('a hostile group name stays text in the heading and the dialog’s name', async () => {
  await show(flowRoute(ALPHA), renamed(evil));
  const opened = await openBy(flowLink(ownLine(ALPHA)));
  assert.equal(opened.heading, `Wire for ${evil}`);
  assert.equal(opened.name, `Wire for ${evil}`);
  assert.equal($('#detail x-evil'), null);
  assert.equal($$('x-evil').length, 0);

  await show('plan', renamed(evil));
  const step = await openBy(stepLink(ownLine(ALPHA)));
  assert.equal(step.link, `Production line: Wire for ${evil}`);
  assert.equal(step.heading, `Wire for ${evil}`);
  assert.equal($$('x-evil').length, 0);
});
