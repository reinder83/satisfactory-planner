// A factory group's flow page, #factories/<group>/flow (#894, ui/pages/GroupFlowPage.vue), mounted
// the way the app mounts it, in happy-dom, on the planner's default Phase 3 plan with the default
// factory groups: the route, a missing group, a milestone-only phase, the cards and their words,
// the key, the Sink & storage fold, the table, self links (#898) and the lanes lit by keyboard
// focus. Where the lanes land is measured in a real browser (see the pull request); happy-dom
// lays nothing out.
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
import { laneStyles, laneWires, type RowAnchor } from '../../public/app/views/group-flow-page.ts';
import { LANE_METRICS, laneGutter, laneOffset } from '../../public/app/group-flow.ts';
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
const flowOf = (groupId = 'fg-iron01'): GroupFlow =>
  model.groupFlow(plan.stages['3'], groups, groupId, () => '')!;

beforeEach(() => {
  page();
  setQuery('');
  hooks.withSelf = false;
});

test('#factories/<group>/flow is the factories view and draws the group’s flow page', async () => {
  assert.equal(flowRoute('fg-iron01'), 'factories/fg-iron01/flow');
  assert.equal(flowGroupOf('factories/fg-iron01/flow'), 'fg-iron01');
  assert.equal(flowGroupOf(flowRoute('a/b c')), 'a/b c', 'an id is encoded and decoded');
  assert.equal(flowGroupOf('factories'), null);
  assert.equal(flowGroupOf('factories/%E0%A4%A/flow'), null, 'a broken escape is no group');
  // A reload reads the view from the hash (boot in session.ts), so it lands here again.
  assert.equal(viewOf('factories/fg-iron01/flow'), 'factories');
  assert.equal(viewOf('factories/x/flow/more'), 'plan');
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

test('the cards follow the build order, inputs before outputs, belts under the rate', async () => {
  await show('fg-iron01');
  const flow = flowOf();
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
  assert.match(fed.textContent!, /from 01 /);
  assert.match(fed.querySelector('.gf-num small')!.textContent!, /belt/);
  assert.ok(!fed.classList.contains('outside'), 'a row fed by a lane has no side bar');
  const ore = cards[0]!.querySelector('[data-row^="in|"]')!;
  assert.match(ore.textContent!, /Raw resource/);
  assert.ok(ore.classList.contains('outside'), 'a row fed from outside has the blue bar');
  assert.equal($('.gf-card .gf-swatch'), null, 'no swatch in a row');
});

test('the key lists one colour and dash per item that rides a lane, in lane order', async () => {
  await show('fg-iron01');
  const styles = laneStyles(flowOf().lanes);
  assert.ok(styles.size > 6, 'the iron group needs dashes too');
  const items = $$('[data-gf-key] .gf-key-item').map(item => item.textContent?.trim());
  assert.deepEqual(items, [...styles.keys()]);
  const lines = $$<SVGLineElement>('[data-gf-key] line');
  assert.equal(lines[0]!.style.stroke, 'var(--accent)');
  assert.equal(lines[6]!.style.strokeDasharray, '7 4', 'the seventh item is dashed');
});

test('focusing a card by keyboard lights its lanes and dims the others', async () => {
  await show('fg-iron01');
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  const wires = $$('.gf-wire');
  assert.equal(wires.length, 14, 'one wire per link between the lines');
  assert.ok(
    wires.every(wire => !wire.classList.contains('hot') && !wire.classList.contains('dim')),
  );
  const third = $$('.gf-card')[2]!;
  const link = third.querySelector<HTMLButtonElement>('.rail-link')!;
  link.focus();
  await nextTick();
  assert.equal(document.activeElement, link);
  assert.ok(third.classList.contains('hot'));
  const id = third.dataset.line!;
  const hot = $$('.gf-wire.hot');
  assert.ok(hot.length > 0);
  assert.ok(
    hot.every(wire => wire.dataset.fromRow!.includes(id) || wire.dataset.toRow!.includes(id)),
    'only its own links light up',
  );
  assert.equal($$('.gf-wire.dim').length, wires.length - hot.length);
  link.blur();
  await nextTick();
  assert.equal($$('.gf-wire.dim').length, 0, 'leaving the card puts the lanes back');
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

test('a self link reads "from itself" and "to itself" and rides no lane (#898)', async () => {
  hooks.withSelf = true;
  await show('fg-iron01');
  const card = $$('.gf-card')[0]!;
  const input = card.querySelector('[data-row^="in|"]')!;
  const output = card.querySelector('[data-row^="out|"]')!;
  assert.match(input.textContent!, /from itself/);
  assert.match(output.textContent!, /to .*itself/);
  assert.ok(
    $$('.gf-wire').every(wire => wire.dataset.toRow !== input.getAttribute('data-row')),
    'no lane ends on the row fed only by itself',
  );
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

test('a line’s ↗ opens that factory’s dialog, and closing it returns to the link (#886, #895)', async () => {
  // The page replaced the group's build-order dialog, whose stages linked to their factories.
  await show('fg-iron01');
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

test('each wire runs from its output row’s dot to an arrow tip on the input row’s border', () => {
  const flow = flowOf();
  const anchors = new Map<string, RowAnchor>();
  flow.lines.forEach((line, i) =>
    [...line.inputs, ...line.outputs].forEach((row, j) =>
      anchors.set(row.id, { x: 72, y: i * 100 + j * 20 + 7 }),
    ),
  );
  const wires = laneWires(flow.lanes, anchors, LANE_METRICS.wide);
  assert.equal(wires.length, 14);
  for (const wire of wires) {
    const lane = flow.lanes.find(entry => entry.from === wire.fromRow)!;
    assert.deepEqual(wire.dot, anchors.get(wire.fromRow));
    assert.deepEqual(wire.tip, anchors.get(wire.toRow), 'the tip touches the border at the row');
    const x = 72 - laneOffset(lane.lane, LANE_METRICS.wide);
    assert.equal(wire.path, `M72,${wire.dot.y} H${x} V${wire.tip.y} H65`);
  }
  // A lane, the outermost included, stays inside the gutter.
  const gutter = laneGutter(flow.laneCount, LANE_METRICS.wide);
  assert.equal(72 - laneOffset(flow.laneCount - 1, LANE_METRICS.wide), 72 - gutter + 4);
});
