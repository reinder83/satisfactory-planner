// A group's flow page for items made on site (#876, #912): when a group marks an item and also
// holds another line making it (the central line, or an alternate recipe), its own line serves
// the group's own demand first and only its excess goes to the sink, while the other lines making
// the item share what leaves the group. Every flow row's links add up to its rate, and what
// crosses the group's edge is groupLinks' links, on the review's case and on random on-site
// configurations (in the style of #897 and #903).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import type { FlowLink, GroupFlow } from '../public/app/group-flow.ts';
import { groupLinks, OUTSIDE } from '../public/app/group-links.ts';
import { UNGROUPED } from '../public/app/group-order.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  StoredStage,
} from '../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22';
const WIRE = 'Recipe_Wire_C';
const ALPHA_WIRE = `${WIRE}:${ALPHA}`;
const belts = (item: string, rate: number) => `${rate} ${item}`;
const sum = (links: FlowLink[]) => links.reduce((total, link) => total + link.rate, 0);
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

let plain: CurrentCalculatedPlan | undefined;
const plainPlan = () => (plain ??= calculate(BASE));
const rowsOf = (stage: StoredStage): CalcRow[] => stage.rows || [];

// What is wrong with one group's flow, as messages: rows whose links do not add up to their
// rate, ports that differ from groupLinks, and ports whose lines' links do not add up to them.
// `rows` counts the rows checked.
function flowProblems(stage: StoredStage, groups: FactoryGroups, id: string, count = { rows: 0 }) {
  const problems: string[] = [];
  const flow = groupFlow(stage, groups, id, belts) as GroupFlow;
  for (const line of flow.lines)
    for (const flowRow of [...line.inputs, ...line.outputs]) {
      count.rows++;
      if (!near(sum(flowRow.links), flowRow.rate))
        problems.push(`${id} ${flowRow.id}: ${sum(flowRow.links)} of ${flowRow.rate}`);
    }
  const links = groupLinks(stage, groups);
  const expected = (inward: boolean) =>
    links
      .filter(link => (inward ? link.to : link.from) === id)
      .flatMap(link =>
        link.items.map(entry => `${inward ? link.from : link.to}|${entry.item}|${entry.rate}`),
      )
      .sort();
  const ports = (list: GroupFlow['ins']) =>
    list.map(port => `${port.place}|${port.item}|${port.rate}`).sort();
  if (JSON.stringify(ports(flow.ins)) !== JSON.stringify(expected(true)))
    problems.push(`${id}: what comes in differs from groupLinks`);
  const outs = [...flow.outs, ...flow.fold.ports];
  if (JSON.stringify(ports(outs)) !== JSON.stringify(expected(false)))
    problems.push(`${id}: what leaves differs from groupLinks`);
  const lineLinks = flow.lines.flatMap(line =>
    [...line.inputs, ...line.outputs].flatMap(flowRow => flowRow.links),
  );
  for (const [inward, list] of [
    [true, flow.ins],
    [false, outs],
  ] as const) {
    const seen = new Set<string>();
    for (const port of list) {
      const key = port.place + '|' + port.item;
      if (seen.has(key)) continue;
      seen.add(key);
      // groupLinks may list an item twice to one place (the sink: a group's own lines' excess and
      // its other lines' share), so the lines' links are measured against both together.
      const portRate = list
        .filter(other => other.place === port.place && other.item === port.item)
        .reduce((total, other) => total + other.rate, 0);
      const carried = lineLinks.filter(link => {
        const end = inward ? link.from : link.to;
        return end.kind === 'place' && end.id === port.place && link.item === port.item;
      });
      if (!near(sum(carried), portRate))
        problems.push(`${id} port ${key}: lines carry ${sum(carried)} of ${portRate}`);
    }
  }
  return problems;
}

test('a group holding the central Wire line as well as its own feeds its own users first (#912)', () => {
  const cable = rowsOf(plainPlan().stages['3']).find(row => row.id === 'Recipe_Cable_C')!.outputs
    .Cable!;
  const marking: FactoryGroups = {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: BETA, name: 'Beta' },
    ],
    assignments: {
      Recipe_Stator_C: [{ group: ALPHA, rate: null }],
      Recipe_Cable_C: [{ group: BETA, rate: cable / 2 }],
    },
    local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
  };
  const stage = calculate({ ...BASE, onSite: onSiteSettings(plainPlan(), marking) }).stages['3'];
  // After the recalculation the central Wire line is assigned to Alpha as well.
  const groups: FactoryGroups = {
    ...marking,
    assignments: { ...marking.assignments, [WIRE]: [{ group: ALPHA, rate: null }] },
  };
  for (const id of [ALPHA, BETA]) assert.deepEqual(flowProblems(stage, groups, id), [], id);
  const flow = groupFlow(stage, groups, ALPHA, belts)!;
  const wireOut = (line: string) =>
    flow.lines.find(entry => entry.id === line)!.outputs.find(row => row.item === 'Wire')!;
  // Alpha's own line makes what Stator uses: all of it goes to Stator, none leaves the group.
  const own = wireOut(ALPHA_WIRE);
  const stator = flow.lines
    .find(entry => entry.id === 'Recipe_Stator_C')!
    .inputs.find(row => row.item === 'Wire')!;
  assert.ok(near(own.rate, stator.rate), 'the own line makes what Stator uses');
  assert.deepEqual(
    own.links.map(link => [link.to, near(link.rate, own.rate)]),
    [[{ kind: 'line', id: 'Recipe_Stator_C' }, true]],
  );
  // The central line's Wire all leaves the group: Ungrouped's Cable, the sink and storage.
  const central = wireOut(WIRE);
  assert.ok(central.links.every(link => link.to.kind === 'place'));
  assert.ok(near(sum(central.links), central.rate), `${sum(central.links)} of ${central.rate}`);
  assert.ok(central.links.some(link => link.to.id === UNGROUPED));
  assert.ok(central.links.some(link => link.to.id === OUTSIDE.surplus));
});

// A small seeded generator, so a failure can be replayed.
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  return { next, pick };
}

// A random on-site configuration on the phase-3 plan: two or three groups holding random rows
// (whole or split), each marking one or two items its rows use and the plan makes; the plan
// recalculated with those marks, and then, in most configurations, some lines making a marked
// item (the central line, or a line for another group) also placed in the marking group.
function configuration(seed: number) {
  const { next, pick } = random(seed);
  const rows = rowsOf(plainPlan().stages['3']).filter(row => !row.id.startsWith('power-'));
  const groups: FactoryGroups['groups'] = Array.from(
    { length: 2 + Math.floor(next() * 2) },
    (_, i) => ({ id: `fg-rand${i}`, name: `Group ${i}` }),
  );
  const assignments: FactoryGroups['assignments'] = {};
  for (const row of rows) {
    const roll = next();
    if (roll < 0.35) continue;
    const first = pick(groups).id;
    if (roll < 0.8) assignments[row.id] = [{ group: first, rate: null }];
    else {
      const second = pick(groups.filter(group => group.id !== first)).id;
      assignments[row.id] = [
        { group: first, rate: null },
        { group: second, rate: null },
      ];
    }
  }
  const made = new Set(rows.flatMap(row => Object.keys(row.outputs || {})));
  const local: FactoryGroups['local'] = {};
  for (const group of groups) {
    const used = [
      ...new Set(
        rows
          .filter(row => assignments[row.id]?.some(entry => entry.group === group.id))
          .flatMap(row => Object.keys(row.inputs || {}))
          .filter(item => made.has(item)),
      ),
    ].sort();
    if (!used.length) continue;
    const items = new Set([pick(used)]);
    if (next() < 0.4) items.add(pick(used));
    local[group.id] = [...items].sort();
  }
  const makes = (row: CalcRow, items: string[]) =>
    items.some(item => (row.outputs?.[item] || 0) > 0);
  let holdsAnother = false;
  // Some lines making an item a group marks are in that group when it recalculates.
  for (const [group, items] of Object.entries(local))
    for (const row of rows)
      if (makes(row, items) && next() < 0.4) {
        assignments[row.id] = [{ group, rate: null }];
        holdsAnother = true;
      }
  const marking: FactoryGroups = { groups, assignments, local };
  const plan = calculate({ ...BASE, onSite: onSiteSettings(plainPlan(), marking) });
  // And some Ungrouped lines making it are placed in it after the recalculation, as in the
  // review's case. (Moving another group's own line, or a line out of another group, would make
  // the plan stale: that group's own line would no longer match its demand.)
  const after: FactoryGroups['assignments'] = { ...assignments };
  for (const [group, items] of Object.entries(local))
    for (const row of rowsOf(plan.stages['3']))
      if (!row.onSite && !after[row.id]?.length && makes(row, items) && next() < 0.7) {
        after[row.id] = [{ group, rate: null }];
        holdsAnother = true;
      }
  return { plan, groups: { groups, assignments: after, local }, holdsAnother };
}

test('on random on-site configurations every flow row adds up and the ports match groupLinks', () => {
  const count = { rows: 0 };
  const problems: string[] = [];
  let configurations = 0,
    holding = 0;
  for (let seed = 1; seed <= 18; seed++) {
    const { plan, groups, holdsAnother } = configuration(seed);
    configurations++;
    if (holdsAnother) holding++;
    for (const [phase, stage] of Object.entries(plan.stages)) {
      // Only a plan that makes what it asks for promises rows that add up.
      if (!stage.feasible) continue;
      for (const group of groups.groups)
        for (const problem of flowProblems(stage, groups, group.id, count))
          problems.push(`seed ${seed}, phase ${phase}: ${problem}`);
    }
  }
  assert.equal(configurations, 18);
  assert.ok(holding >= 12, `${holding} configurations hold another maker of a marked item`);
  assert.ok(count.rows > 1000, `${count.rows} rows checked`);
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
});
