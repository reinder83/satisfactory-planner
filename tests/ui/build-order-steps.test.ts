// A factory's build order page as a step list (BO-1 to BO-4, #1346, ui/pages/GroupFlowPage.vue):
// numbered steps with a status each, the current step open as a card and the rest folded to one
// row; every input naming its source as a chip that goes to that step or factory, with its rate
// and belts on one line; a "Comes in" row whose inputs that are not arriving take the problem
// colour; and the Built counter and Mark running on the open card, on the phase on screen only.
// The default Phase 3 plan and groups: fg-iron01 has 11 lines, fg-oilcp1 has 5 in Phase 3 and 8
// in Phase 5. Where things land is measured in a real browser (see the pull request).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import * as model from '../../public/app/group-flow.ts';
import { heldBack } from '../../public/app/views/calculated.ts';
import { flowRoute, setQuery, state, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { comesIn, flowNames, linkChips } from '../../public/app/views/group-flow-page.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { FactoryGroups, ProgressState, UpdateOp } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const IRON = 'fg-iron01';
const OIL = 'fg-oilcp1';
const flowOf = (groupId = IRON) => model.groupFlow(plan.stages['3'], groups, groupId, () => '')!;
const key = (id: string) => `calc-3-${id}`;

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
async function show(
  groupId: string,
  {
    checks = {},
    factoryGroups = groups,
    query = '',
  }: { checks?: Record<string, boolean>; factoryGroups?: FactoryGroups; query?: string } = {},
) {
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { checks, factoryGroups } as Partial<ProgressState>,
  });
  location.hash = '#' + flowRoute(groupId, '3') + query;
  go(viewOf(location.hash.slice(1)));
  render();
  await settle();
}
const navOf = (id: string) => $(`[data-step-nav="${id}"]`)!;
const stateOf = (id: string) => navOf(id).querySelector<HTMLElement>('[data-state]')?.dataset.state;
const openCards = () => $$('#main .gf-card').map(card => card.dataset.line);
const folds = () => $$('#main [data-step-row]').map(row => row.dataset.stepRow);

beforeEach(() => {
  page();
  setQuery('');
});

test('BO-1: numbered steps with a status each; the step to build next is open, the rest folded', async () => {
  await show(IRON);
  const lines = flowOf().lines;
  const nav = $$('[data-gf-steps] [data-step-nav]');
  assert.deepEqual(
    nav.map(button => button.dataset.stepNav),
    lines.map(line => line.id),
    'one entry per line, in build order',
  );
  assert.match(nav[0]!.textContent!, /^\s*01\b/);
  assert.equal($('[data-gf-steps]')!.getAttribute('aria-label'), 'Build steps');
  assert.equal(stateOf(lines[0]!.id), 'next', 'the first line not running is the one to build');
  assert.match(text(navOf(lines[0]!.id)), /Build next/, 'said in words too');
  assert.equal(navOf(lines[0]!.id).getAttribute('aria-current'), 'step');
  assert.deepEqual(openCards(), [lines[0]!.id], 'only the current step is a card');
  assert.deepEqual(
    folds(),
    lines.slice(1).map(line => line.id),
    'every other step is one row',
  );
  assert.ok($('[data-gf-next]'), 'the card says Build next');
  assert.equal($$('[data-gf-next]').length, 1);
  // A fold names the step, its machines and what it needs, and says it is closed.
  const fold = $<HTMLButtonElement>(`[data-step-row="${lines[1]!.id}"]`)!;
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.match(text(fold), new RegExp(`^02 ${lines[1]!.name}`));
  assert.match(text(fold), /needs /);
});

test('BO-1: a running step is folded to one row with a tick, and the next step is open', async () => {
  const lines = flowOf().lines;
  await show(IRON, { checks: { [key(lines[0]!.id)]: true } });
  assert.equal(stateOf(lines[0]!.id), 'running');
  assert.equal(text(navOf(lines[0]!.id).querySelector('[data-state]')), '✓ Running');
  assert.equal(stateOf(lines[1]!.id), 'next');
  assert.deepEqual(openCards(), [lines[1]!.id]);
  assert.ok(folds().includes(lines[0]!.id), 'the finished step is one row');
  // A count of built machines shows in the list; a step with none says nothing.
  await show(IRON, { checks: {}, factoryGroups: groups });
  assert.equal(
    navOf(lines[0]!.id).querySelector('[data-state]')!.textContent!.includes('✓'),
    false,
  );
});

test('BO-1: picking a step in the list or a fold opens it, moves focus to it and folds the old one', async () => {
  await show(IRON);
  const lines = flowOf().lines;
  navOf(lines[3]!.id).click();
  await settle();
  assert.deepEqual(openCards(), [lines[3]!.id]);
  assert.equal(document.activeElement, $(`.gf-card[data-line="${lines[3]!.id}"]`));
  assert.equal(navOf(lines[3]!.id).getAttribute('aria-current'), 'step');
  assert.ok(folds().includes(lines[0]!.id), 'the first one is folded again');
  $<HTMLButtonElement>(`[data-step-row="${lines[5]!.id}"]`)!.click();
  await settle();
  assert.deepEqual(openCards(), [lines[5]!.id]);
  // Expand all opens every step, and its button says how to go back.
  const all = $<HTMLButtonElement>('[data-gf-all]')!;
  assert.equal(text(all), `Expand all ${lines.length} steps`);
  all.click();
  await settle();
  assert.equal(openCards().length, lines.length);
  assert.equal(folds().length, 0);
  assert.equal(text($('[data-gf-all]')), 'Show the current step only');
});

test('BO-2: an input names its source as a chip that moves to that step; rate and belts share a line', async () => {
  const lines = flowOf().lines;
  await show(IRON, { checks: { [key(lines[0]!.id)]: true } });
  const second = lines[1]!;
  const input = $(`.gf-card [data-row="${second.inputs[0]!.id}"]`)!;
  const chip = input.querySelector<HTMLButtonElement>('button.gf-chip')!;
  assert.equal(text(chip), 'from 01');
  assert.equal(chip.getAttribute('aria-label'), `Go to step 01 ${lines[0]!.name}`);
  // Rate then belts, in one flex row: "525/min" and "· 2 × Mk.4 belts".
  const figures = input.querySelector('.gf-num')!;
  assert.match(figures.querySelector('b')!.textContent!, /^[\d.,]+\/min$/);
  assert.match(figures.querySelector('small')!.textContent!, /^· .*belt/);
  assert.deepEqual(
    [...figures.children].map(child => child.tagName),
    ['B', 'SMALL'],
    'no line break element between them',
  );
  assert.deepEqual(openCards(), [second.id]);
  chip.click();
  await settle();
  assert.deepEqual(openCards(), [lines[0]!.id], 'the chip opens the step it names');
  assert.equal(document.activeElement, $(`.gf-card[data-line="${lines[0]!.id}"]`));
  // The source's own outputs name where they go the same way.
  const out = $(`.gf-card [data-row="${lines[0]!.outputs[0]!.id}"]`)!;
  assert.match(text(out.querySelector('.gf-chips')), /^to \d\d/);
  // A raw resource is plain text, not a control.
  $<HTMLButtonElement>(`[data-step-nav="${lines[0]!.id}"]`)!.click();
  await settle();
  const raw = $(`.gf-card [data-row^="in|"].outside`)!;
  assert.equal(raw.querySelectorAll('button, a').length, 0, 'nothing to press on a raw source');
  assert.match(text(raw.querySelector('.gf-chip.plain')), /Raw resource/);
});

test('BO-2: the chips are one per source: a line, itself or another factory', () => {
  const flow = flowOf();
  const names = flowNames(flow);
  const line = flow.lines[1]!;
  const from = linkChips(line.inputs[0]!.links, names, 'from');
  assert.deepEqual(
    from.map(chip => [chip.kind, chip.text, chip.target]),
    [['line', 'from 01', flow.lines[0]!.id]],
  );
  const self = {
    ...line.inputs[0]!.links[0]!,
    from: { kind: 'line' as const, id: line.id },
    to: { kind: 'line' as const, id: line.id },
    self: true,
  };
  assert.deepEqual(
    linkChips([self, self], names, 'to').map(chip => [chip.kind, chip.text]),
    [['plain', 'to itself']],
    'the same end once, a self link plain',
  );
  const outside = flow.lines
    .flatMap(item => item.inputs)
    .find(row => row.links[0]!.from.kind === 'place')!;
  assert.equal(linkChips(outside.links, names, 'from')[0]!.kind, 'plain');
});

// A lone Stator line is ticked running with nothing feeding it: it is held back, short of an
// input that a factory of its own makes (as the factories page's banner, #1342, has it).
const STATORS = 'fg-stator1';
const WIRES = 'fg-wires01';
const rows = plan.stages['3'].rows!;
const stator = rows.find(row => row.id === 'Recipe_Stator_C')!;
function heldScenario() {
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { checks: { [key(stator.id)]: true } },
  });
  const hold = heldBack(stator.id);
  assert.ok(hold, 'a lone Stator line is held back');
  const maker = rows.find(row => (row.outputs[hold.shortOf] ?? 0) > 0)!;
  const factoryGroups: FactoryGroups = {
    groups: [
      { id: STATORS, name: 'Stators' },
      { id: WIRES, name: 'Wire works' },
    ],
    assignments: {
      [stator.id]: [{ group: STATORS, rate: null }],
      [maker.id]: [{ group: WIRES, rate: null }],
    },
  };
  return { short: hold.shortOf, factoryGroups };
}

test('BO-2: another factory is a place with a page of its own', () => {
  const { factoryGroups } = heldScenario();
  const flow = model.groupFlow(plan.stages['3'], factoryGroups, STATORS, () => '')!;
  const grouped = flow.ins.find(port => port.kind === 'group')!;
  assert.equal(grouped.place, WIRES);
  assert.ok(flowNames(flow).groups.has(WIRES));
});

test('BO-2: another factory is a link to its build order, keeping the phase tab', async () => {
  const { short, factoryGroups } = heldScenario();
  await show(STATORS, { checks: { [key(stator.id)]: true }, factoryGroups });
  const input = $(`.gf-card [data-row$="|${short}"].gf-in`)!;
  const link = input.querySelector<HTMLAnchorElement>('a.gf-chip')!;
  assert.equal(text(link), 'Wire works');
  assert.equal(link.getAttribute('href'), '#' + flowRoute(WIRES, '3'));
  assert.equal(link.getAttribute('aria-label'), 'Open the build order of Wire works');
});

test('BO-3: "Comes in" lists the inputs; one a running line is short of is flagged in words', async () => {
  const { short, factoryGroups } = heldScenario();
  await show(STATORS, { checks: { [key(stator.id)]: true }, factoryGroups });
  const row = $('[data-gf-comes-in]')!;
  assert.equal(text(row.querySelector('h2')), 'Comes in');
  const items = $$('[data-comes-in]');
  assert.ok(items.length >= 2, 'one chip per input');
  const lacking = $(`[data-comes-in="${short}"]`)!;
  assert.ok(lacking.classList.contains('problem'), 'in the problem colour');
  assert.equal(lacking.dataset.arriving, 'none');
  assert.match(text(lacking), new RegExp(`^${short} 0 of [\\d.,]+\\s?(m³)?/min .*not arriving`));
  assert.ok(
    lacking.querySelector('[aria-hidden="true"]'),
    'a ⚠ beside the words, not colour alone',
  );
  const fine = items.filter(item => item !== lacking);
  assert.ok(fine.every(item => !item.classList.contains('problem')));
  assert.ok(
    items.every(item => /\/min/.test(item.textContent!)),
    'each has its rate',
  );
});

test('BO-3: with nothing held back no input is flagged, and another phase flags none', async () => {
  await show(IRON);
  assert.ok($$('[data-comes-in]').length > 0);
  assert.equal($$('[data-comes-in].problem').length, 0);
  const { factoryGroups } = heldScenario();
  await show(STATORS, {
    checks: { [key(stator.id)]: true },
    factoryGroups,
    query: '&view=4',
  });
  assert.ok($('[data-gf-readonly]'), 'another phase is open');
  assert.equal($$('[data-comes-in].problem').length, 0, 'no running lines there to hold back');
});

test('BO-3: what arrives of the rate is 0, part of it, or the held item flagged in full', () => {
  const [first, second, third] = flowOf().ins;
  assert.ok(first && second && third, 'the iron factory takes three or more inputs');
  const held = new Set([first.item, second.item]);
  const [a, b, c] = comesIn([first, second, third], held, {
    [first.item]: 0,
    [second.item]: second.rate / 2,
  });
  assert.deepEqual([a!.state, a!.arriving], ['none', 0]);
  assert.deepEqual([b!.state, b!.arriving], ['short', second.rate / 2]);
  assert.deepEqual([c!.state, c!.arriving], ['ok', null]);
  const [all] = comesIn([first], new Set([first.item]), { [first.item]: first.rate * 10 });
  assert.equal(all!.arriving, first.rate, 'never more than the rate asked');
});

test('BO-4: the open card has the Built counter and Mark running, saved as the factories card does', async () => {
  const lines = flowOf().lines;
  await show(IRON);
  const card = $(`.gf-card[data-line="${lines[0]!.id}"]`)!;
  const counter = card.querySelector<HTMLElement>('[data-built-counter]')!;
  assert.ok(counter, 'a Built counter');
  assert.equal(counter.getAttribute('aria-label'), `Built machines: ${lines[0]!.name}`);
  const box = card.querySelector<HTMLInputElement>(`input[data-check="${key(lines[0]!.id)}"]`)!;
  assert.equal(box.getAttribute('aria-label'), `Mark running: ${lines[0]!.name}`);
  assert.equal(box.checked, false);
  assert.match(text(box.closest('label')), /^Mark running$/);
  assert.equal($$('#main .gf-card [data-built-counter]').length, 1, 'on the open card only');
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  box.focus();
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(
    calls.filter(([path]) => path === '/api/update').length,
    1,
    'one write, the same check the factories card writes',
  );
  assert.equal(state.checks[key(lines[0]!.id)], true);
  // The card the user was on stays open (so focus is not lost); the list moves on.
  assert.deepEqual(openCards(), [lines[0]!.id]);
  assert.equal(stateOf(lines[0]!.id), 'running');
  assert.equal(stateOf(lines[1]!.id), 'next');
  assert.equal(document.activeElement, box, 'focus stays on the box that was pressed');
});

test('BO-4: counting built machines on the card shows the count in the list', async () => {
  const lines = flowOf().lines;
  await show(IRON);
  const card = $(`.gf-card[data-line="${lines[0]!.id}"]`)!;
  const plus = card.querySelector<HTMLButtonElement>('[data-built-step="1"]')!;
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  plus.click();
  await settle();
  assert.equal(calls.filter(([path]) => path === '/api/update').length, 1);
  const needed = card.querySelector('.built-of')!.textContent!.replace(/\D/g, '');
  assert.equal(text(navOf(lines[0]!.id).querySelector('[aria-hidden="true"]')), `1/${needed}`);
  assert.equal(stateOf(lines[0]!.id), 'next', 'still the one to build, now part built');
});

test('BO-4: another phase’s tab has no counter, no Mark running and no status (#1317)', async () => {
  await show(OIL, { query: '&view=5' });
  assert.ok($('[data-gf-readonly]'));
  $<HTMLButtonElement>('[data-gf-all]')!.click();
  await settle();
  assert.ok($$('#main .gf-card').length > 1, 'every step open to look at');
  assert.equal($$('#main [data-built-counter]').length, 0);
  assert.equal($$('#main .gf-card input').length, 0);
  assert.equal($$('#main [data-step-nav] [data-state]').length, 0);
  assert.equal($$('#main .gf-card [data-gf-next]').length, 0, 'nothing is "to build next"');
  assert.equal($$('#main [data-step-nav][aria-current="step"]').length, 1, 'but one is open');
});
