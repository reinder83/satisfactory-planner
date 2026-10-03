// Lines made on site on a factory group's flow page (#896, part of #883 and #868): on a plan where
// two groups, Alpha and Beta, both mark Wire as made on site, and a third, Gamma, holds the
// central Wire line, each marking group's flow shows its own Wire line (`<recipeId>:<groupId>`)
// as a card of its own feeding that group's consumers, the central line's card feeds only the
// remaining consumers, and no Wire link runs between the groups, matching groupLinks. Each own
// line's card is named as its build-plan step is ("Wire for Alpha", rowStepTitle), the central
// one plainly "Wire". The plans are the planner's own, calculated in Node (generatedWith).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { groupFlow } from '../../public/app/group-flow.ts';
import type { FlowLine, FlowLink, GroupFlow } from '../../public/app/group-flow.ts';
import { groupLinks, OUTSIDE } from '../../public/app/group-links.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { flowRoute, setQuery, state, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { buildRowName } from '../../public/app/views/calculated.ts';
import { $, $$, evil, generatedWith, go, open, page } from './setup.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  GAMMA = 'fg-gamma3';
const WIRE = 'Recipe_Wire_C';
// A group's own Wire line (`<recipeId>:<groupId>`).
const ownLine = (groupId: string) => `${WIRE}:${groupId}`;
const belts = (item: string, rate: number) => `${rate} ${item}`;
const sum = (links: readonly FlowLink[]) => links.reduce((total, link) => total + link.rate, 0);
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

// Alpha builds Stator and Beta half of Cable, both marking Wire; Gamma holds the rest of Cable
// and the central Wire line. The plan is recalculated with those marks, as the Factories page
// does, so Alpha and Beta each get a Wire line of their own.
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
const stage: StoredStage = plan.stages['3'];
const rows: CalcRow[] = stage.rows || [];

const flowOf = (groupId: string): GroupFlow => groupFlow(stage, groups, groupId, belts)!;
const lineOf = (flow: GroupFlow, id: string): FlowLine | undefined =>
  flow.lines.find(line => line.id === id);
const wireOut = (line: FlowLine) => line.outputs.find(row => row.item === 'Wire')!;
const wireIn = (line: FlowLine) => line.inputs.find(row => row.item === 'Wire')!;

// Opens the flow page of `groupId`, as a deep link would.
async function show(groupId: string, factoryGroups: FactoryGroups = groups) {
  open({ calculated: structuredClone(plan), state: { factoryGroups } });
  location.hash = '#' + flowRoute(groupId);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
}
const cardTitle = (id: string) =>
  $(`#main .gf-card[data-line="${id}"] .gf-head .rail-link`)?.textContent?.trim();

beforeEach(() => {
  page();
  setQuery('');
});

test('the plan has a Wire line of its own for Alpha and for Beta beside the central one', () => {
  assert.ok(stage.feasible, 'the recalculated phase fits');
  for (const groupId of [ALPHA, BETA]) {
    const row = rows.find(candidate => candidate.id === ownLine(groupId));
    assert.ok(row, `${groupId}'s own Wire line`);
    assert.deepEqual(row.onSite, { group: groupId, recipe: WIRE });
  }
  assert.ok(
    rows.some(row => row.id === WIRE && !row.onSite),
    'the central Wire line',
  );
});

test('each marking group shows its own Wire line as a card that feeds its own consumers', () => {
  for (const [groupId, consumer] of [
    [ALPHA, 'Recipe_Stator_C'],
    [BETA, 'Recipe_Cable_C'],
  ] as const) {
    const flow = flowOf(groupId);
    const own = lineOf(flow, ownLine(groupId))!;
    assert.ok(own, `${groupId} has a card for its own line`);
    assert.equal(lineOf(flow, WIRE), undefined, `${groupId} has no card for the central line`);
    const user = lineOf(flow, consumer)!;
    // The consumer's Wire comes from the group's own line only, all of it.
    assert.deepEqual(
      wireIn(user).links.map(link => link.from),
      [{ kind: 'line', id: own.id }],
    );
    assert.ok(near(sum(wireIn(user).links), wireIn(user).rate));
    // The own line feeds that consumer first; whatever is left over goes to the sink, never to
    // another group.
    const out = wireOut(own);
    const toUser = out.links.filter(link => link.to.kind === 'line' && link.to.id === consumer);
    assert.ok(near(sum(toUser), wireIn(user).rate), `${groupId}: all of the consumer's Wire`);
    assert.ok(near(sum(out.links), out.rate), `${groupId}: the own line's links add up`);
    assert.deepEqual(
      out.links.filter(link => link.to.kind === 'place').map(link => link.to.id),
      out.links.filter(link => link.to.kind === 'place').map(() => OUTSIDE.surplus),
      `${groupId}: nothing leaves for another group`,
    );
    // No Wire comes in from outside the group.
    assert.deepEqual(
      flow.ins.filter(port => port.item === 'Wire'),
      [],
    );
  }
});

test('the central Wire line feeds only the consumers the own lines leave', () => {
  const flow = flowOf(GAMMA);
  const central = lineOf(flow, WIRE)!;
  assert.ok(central, 'Gamma has a card for the central Wire line');
  for (const id of [ALPHA, BETA].map(ownLine)) assert.equal(lineOf(flow, id), undefined);
  const out = wireOut(central);
  assert.ok(near(sum(out.links), out.rate), `${sum(out.links)} of ${out.rate}`);
  const ends = out.links.map(link => link.to.id);
  assert.ok(ends.includes('Recipe_Cable_C'), 'it feeds Gamma’s own half of Cable');
  assert.ok(!ends.includes(ALPHA) && !ends.includes(BETA), 'never Alpha or Beta');
  // Gamma's half of Cable takes its Wire from the central line alone.
  const cable = lineOf(flow, 'Recipe_Cable_C')!;
  assert.deepEqual(
    wireIn(cable).links.map(link => link.from),
    [{ kind: 'line', id: WIRE }],
  );
  assert.ok(near(sum(wireIn(cable).links), wireIn(cable).rate));
});

test('no Wire link runs between the marking groups or to them, as groupLinks says', () => {
  const marking = new Set([ALPHA, BETA]);
  const wireLinks = groupLinks(stage, groups).filter(link =>
    link.items.some(entry => entry.item === 'Wire'),
  );
  assert.deepEqual(
    wireLinks.filter(link => marking.has(link.to)).map(link => `${link.from} > ${link.to}`),
    [],
  );
  assert.deepEqual(
    wireLinks
      .filter(link => marking.has(link.from) && link.to !== OUTSIDE.surplus)
      .map(link => `${link.from} > ${link.to}`),
    [],
  );
  // Every flow agrees with groupLinks: each port is a link of groupLinks with its rate, and every
  // row's links add up to its rate.
  const links = groupLinks(stage, groups);
  for (const group of groups.groups) {
    const flow = flowOf(group.id);
    const expected = (inward: boolean) =>
      links
        .filter(link => (inward ? link.to : link.from) === group.id)
        .flatMap(link =>
          link.items.map(entry => `${inward ? link.from : link.to}|${entry.item}|${entry.rate}`),
        )
        .sort();
    const ports = (list: GroupFlow['ins']) =>
      list.map(port => `${port.place}|${port.item}|${port.rate}`).sort();
    assert.deepEqual(ports(flow.ins), expected(true), `${group.name}: what comes in`);
    assert.deepEqual(
      ports([...flow.outs, ...flow.fold.ports]),
      expected(false),
      `${group.name}: what leaves`,
    );
    for (const line of flow.lines)
      for (const row of [...line.inputs, ...line.outputs])
        assert.ok(near(sum(row.links), row.rate), `${group.name} ${row.id}`);
  }
});

test('an own line’s card is named as its build-plan step, "Wire for Alpha"', async () => {
  await show(ALPHA);
  assert.equal(buildRowName(ownLine(ALPHA)), 'Wire for Alpha');
  assert.equal(cardTitle(ownLine(ALPHA)), 'Wire for Alpha ↗');
  // The Stator card says where its Wire comes from by the same name, and so does the table.
  const statorWire = $(`#main [data-row="in|Recipe_Stator_C|Wire"]`)!;
  assert.match(statorWire.textContent ?? '', /from \d\d Wire for Alpha/);
  const cells = $$('#main [data-gf-table] td').map(cell => cell.textContent?.trim());
  assert.ok(cells.includes('Wire for Alpha'), 'the lines table names it');
  assert.ok(
    cells.some(cell => /^\d\d Wire for Alpha$/.test(cell ?? '')),
    'the connections table names it',
  );

  await show(BETA);
  assert.equal(cardTitle(ownLine(BETA)), 'Wire for Beta ↗');

  // The central line keeps its plain name.
  await show(GAMMA);
  assert.equal(cardTitle(WIRE), 'Wire ↗');
});

test('a renamed group renames its line’s card, and a hostile name stays text', async () => {
  const renamed: FactoryGroups = {
    ...groups,
    groups: groups.groups.map(group => (group.id === ALPHA ? { ...group, name: evil } : group)),
  };
  await show(ALPHA, renamed);
  assert.equal(state.factoryGroups?.groups?.[0]?.name, evil);
  assert.equal(cardTitle(ownLine(ALPHA)), `Wire for ${evil} ↗`);
  assert.equal($('#main x-evil'), null);
});
