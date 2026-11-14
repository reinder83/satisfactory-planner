// A factory group's flow page, #factories/<group>/flow (#894, ui/pages/GroupFlowPage.vue), mounted
// the way the app mounts it, in happy-dom, on the planner's default Phase 3 plan with the default
// factory groups: the route, a missing group, a milestone-only phase, the steps and their words,
// the Sink & storage fold, the table and self links (#898). The step list, chips, "Comes in" row
// and counter are in build-order-steps.test.ts; where things land is measured in a real browser
// (see the pull request), as happy-dom lays nothing out.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import * as model from '../../public/app/group-flow.ts';
import type { FlowLink, GroupFlow } from '../../public/app/group-flow.ts';
import { flowGroupOf, flowRoute, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { vuePage } from '../../public/app/ui/pages.ts';
import CalculatedFactoriesPage from '../../public/app/ui/pages/CalculatedFactoriesPage.vue';
import GroupFlowPage from '../../public/app/ui/pages/GroupFlowPage.vue';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, evil, generated, go, open, page } from './setup.ts';
import type { FactoryGroups, Phase } from '../../public/types/index.ts';

// A self link (#898) the model on main does not make yet: while `withSelf` is set, the flow of
// the open group gets one on its first line's first input and output, as #903 adds them.
const hooks = vi.hoisted(() => ({ withSelf: false }));
vi.mock('../../public/app/group-flow.ts', async original => {
  const actual = await original<typeof import('../../public/app/group-flow.ts')>();
  return {
    ...actual,
    groupFlow: (...args: Parameters<typeof actual.groupFlow>) => {
      const flow = actual.groupFlow(...args);
      if (!hooks.withSelf || !flow?.lines[0]) return flow;
      const line = flow.lines[0];
      const input = line.inputs[0]!,
        output = line.outputs[0]!;
      const self: FlowLink & { self: boolean } = {
        item: output.item,
        rate: 1,
        belts: '1 × Mk.1 belt',
        from: { kind: 'line', id: line.id },
        to: { kind: 'line', id: line.id },
        loop: false,
        self: true,
      };
      input.links.push(self);
      output.links.push(self);
      return flow;
    },
  };
});

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const iron = groups.groups.find(group => group.id === 'fg-iron01')!;

// Opens the flow page of `groupId` in `phase`, as a deep link or reload would.
async function show(groupId: string, { phase = '3' as Phase, factoryGroups = groups } = {}) {
  open({ calculated: structuredClone(plan), phase, state: { factoryGroups } });
  location.hash = '#' + flowRoute(groupId);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
}
// Opens every step as a card, as "Expand all" does.
async function expandAll() {
  $<HTMLButtonElement>('[data-gf-all]')!.click();
  await nextTick();
}
const flowOf = (groupId = 'fg-iron01'): GroupFlow =>
  model.groupFlow(plan.stages['3'], groups, groupId, () => '')!;

beforeEach(() => {
  page();
  setQuery('');
  hooks.withSelf = false;
});

test('#factories/<group>/flow is the factories view and draws the group’s flow page', async () => {
  assert.equal(flowRoute('fg-iron01', '3'), 'factories/fg-iron01/flow?phase=3');
  assert.equal(flowGroupOf('factories/fg-iron01/flow'), 'fg-iron01');
  assert.equal(flowGroupOf(flowRoute('a/b c', '3')), 'a/b c', 'an id is encoded and decoded');
  assert.equal(flowGroupOf('factories'), null);
  assert.equal(flowGroupOf('factories/%E0%A4%A/flow'), null, 'a broken escape is no group');
  // A reload reads the view from the hash (boot in session.ts), so it lands here again.
  assert.equal(viewOf('factories/fg-iron01/flow'), 'factories');
  assert.equal(viewOf('factories/x/flow/more'), 'notfound', 'no such address');
  assert.equal(vuePage('factories', null, true, 'factories/fg-iron01/flow'), GroupFlowPage);
  assert.equal(vuePage('factories', null, true, 'factories'), CalculatedFactoriesPage);
  assert.equal(vuePage('factories', null), CalculatedFactoriesPage);

  await show('fg-iron01');
  assert.equal($('#main h1')?.textContent, iron.name);
  assert.equal($('[data-gf-back]')?.getAttribute('href'), '#factories');
  assert.ok(
    $$('#main button').some(button => button.textContent?.trim() === 'Print'),
    'a Print button',
  );
  assert.equal($('.nav a.active')?.getAttribute('href'), '#factories', 'Factories stays marked');
});

test('the steps follow the build order, inputs before outputs, belts beside the rate', async () => {
  await show('fg-iron01');
  const flow = flowOf();
  assert.equal($$('.gf-card').length, 1, 'only the current step is open as a card');
  await expandAll();
  const cards = $$('.gf-card');
  assert.deepEqual(
    cards.map(card => card.dataset.line),
    flow.lines.map(line => line.id),
  );
  assert.match(cards[0]!.querySelector('.chain-no')!.textContent!, /^01$/);
  flow.lines.forEach((line, i) => {
    const rows = [...cards[i]!.querySelectorAll<HTMLElement>('[data-row]')].map(
      row => row.dataset.row,
    );
    assert.deepEqual(
      rows,
      [...line.inputs, ...line.outputs].map(row => row.id),
      line.recipe,
    );
  });
  // A link from another line names it; a raw resource says so.
  const second = flow.lines[1]!;
  const fed = cards[1]!.querySelector(`[data-row="${second.inputs[0]!.id}"]`)!;
  assert.match(fed.querySelector('.gf-chip')!.textContent!, /^\s*from 01\s*$/);
  assert.match(fed.querySelector('.gf-num small')!.textContent!, /^· .*belt/);
  assert.ok(!fed.classList.contains('outside'), 'a row fed by a lane has no side bar');
  const ore = cards[0]!.querySelector('[data-row^="in|"]')!;
  assert.match(ore.textContent!, /Raw resource/);
  assert.ok(ore.classList.contains('outside'), 'a row fed from outside has the blue bar');
});

test('Sink & storage is folded until it is opened, and the table repeats every link', async () => {
  await show('fg-iron01');
  const flow = flowOf();
  const fold = $<HTMLDetailsElement>('[data-gf-fold]')!;
  assert.equal(fold.open, false);
  assert.match(fold.querySelector('summary')!.textContent!, /Sink & storage/);
  assert.match(fold.querySelector('summary')!.textContent!, new RegExp(`${flow.fold.items} items`));
  fold.open = true;
  assert.equal(fold.querySelectorAll('.gf-row').length, flow.fold.ports.length);
  const inputs = flow.lines.flatMap(line => line.inputs.flatMap(row => row.links));
  const leaving = flow.lines.flatMap(line =>
    line.outputs.flatMap(row => row.links.filter(link => link.to.kind === 'place')),
  );
  assert.equal($$('[data-gf-connection]').length, inputs.length + leaving.length);
  assert.equal($<HTMLDetailsElement>('[data-gf-table]')!.open, false);
});

test('a self link reads "from itself" and "to itself" and has no chip to go to (#898)', async () => {
  hooks.withSelf = true;
  await show('fg-iron01');
  await expandAll();
  const card = $$('.gf-card')[0]!;
  const input = card.querySelector('[data-row^="in|"]')!;
  const output = card.querySelector('[data-row^="out|"]')!;
  assert.match(input.textContent!, /from itself/);
  assert.match(output.textContent!, /to .*itself/);
  assert.equal(input.querySelectorAll('button.gf-chip').length, 0, 'no chip to go to');
  assert.ok($$('[data-gf-connection]').some(row => row.textContent!.includes('itself')));
});

test('an address naming no group says so, and the group name is text', async () => {
  await show('fg-gone');
  assert.ok($('[data-gf-missing]'), 'a removed or mistyped group');
  assert.equal($('.gf-card'), null);
  const hostile: FactoryGroups = {
    groups: [{ id: 'fg-x', name: evil }],
    assignments: Object.fromEntries(
      Object.entries(groups.assignments).map(([id, list]) => [
        id,
        list.map(entry => ({ ...entry, group: 'fg-x' })),
      ]),
    ),
  };
  await show('fg-x', { factoryGroups: hostile });
  assert.equal($('#main h1')?.textContent, evil);
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
});

test('the table breaks only the cells holding a group’s long name (#988)', async () => {
  // Ordinary names: no cell breaks, so the table is laid out as it was before #988.
  await show('fg-iron01');
  assert.ok($$('[data-gf-connection]').length, 'the table lists connections');
  assert.equal($$('[data-gf-table] .gf-cell-name').length, 0);
  // The other groups take the longest one-word name label() allows: the cells naming them break,
  // and no other cell does.
  const longName = 'Pars' + 'A'.repeat(76);
  const renamed: FactoryGroups = {
    ...groups,
    groups: groups.groups.map(group =>
      group.id === 'fg-iron01' ? group : { ...group, name: longName },
    ),
  };
  await show('fg-iron01', { factoryGroups: renamed });
  const cells = $$('[data-gf-table] td');
  assert.ok(
    cells.some(cell => cell.textContent === longName),
    'a connection names another group',
  );
  for (const cell of cells)
    assert.equal(
      cell.classList.contains('gf-cell-name'),
      cell.textContent!.includes(longName),
      cell.textContent!,
    );
});

test('a line’s ↗ opens that factory’s dialog, and closing it returns to the link (#886, #895)', async () => {
  // The page replaced the group's build-order dialog, whose stages linked to their factories.
  await show('fg-iron01');
  await expandAll();
  const flow = flowOf();
  const links = $$<HTMLButtonElement>('#main .gf-head .rail-link');
  assert.equal(links.length, flow.lines.length, 'one link per line');
  const line = flow.lines[1]!;
  const link = links[1]!;
  assert.equal(link.dataset.calcFactory, line.id);
  assert.equal(link.textContent!.trim(), line.recipe + ' ↗');
  link.focus();
  link.click();
  const dialog = $<HTMLDialogElement>('#detail')!;
  assert.ok(dialog.open, 'the factory dialog opens over the page');
  const row = plan.stages['3'].rows!.find(r => r.id === line.id)!;
  assert.equal($('#detail h2')!.textContent, row.name);
  assert.ok($('#main .gf-card'), 'the page stays under it');
  dialog.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  assert.equal(document.activeElement, link, 'closing returns focus to the ↗ link');
});

test('a milestone-only phase shows the factories page’s "Go to Phase N" notice', async () => {
  await show('fg-iron01', { phase: '1' });
  assert.ok($('[data-milestone-only]'));
  assert.match($('[data-go-to-start-phase]')!.textContent!, /Go to Phase 3/);
  assert.equal($('.gf-card'), null);
  assert.equal($('[data-gf-missing]'), null, 'the group is there, only not in this phase');
  assert.equal($('#main h1')?.textContent, iron.name);
});
