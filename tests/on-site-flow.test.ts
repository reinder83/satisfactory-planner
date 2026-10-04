// A group's flow page for items made on site (#876, #912): when a group marks an item and also
// holds another line making it (the central line, or an alternate recipe), its own line serves
// the group's own demand first and only its excess goes to the sink, while the other lines making
// the item share what leaves the group. Every flow row's links add up to its rate, and what
// crosses the group's edge is groupLinks' links, on the review's case and on random on-site
// configurations (in the style of #897 and #903), also after group edits that change what a
// marking group asks for (#918): then a group's own line sends the sink no more than the plan's
// surplus, and offers the rest of its excess to the other places, so the books still balance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import type { FlowEnd, FlowLink, GroupFlow } from '../public/app/group-flow.ts';
import { groupLinks, itemBooks, OUTSIDE, placeTotal } from '../public/app/group-links.ts';
import { UNGROUPED } from '../public/app/group-order.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  GroupAssignment,
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
  // review's case. (Edits that change what a marking group asks for are in `edited` below.)
  const after: FactoryGroups['assignments'] = { ...assignments };
  for (const [group, items] of Object.entries(local))
    for (const row of rowsOf(plan.stages['3']))
      if (!row.onSite && !after[row.id]?.length && makes(row, items) && next() < 0.7) {
        after[row.id] = [{ group, rate: null }];
        holdsAnother = true;
      }
  return { plan, groups: { groups, assignments: after, local }, holdsAnother };
}

// The groups of a configuration edited further after the recalculation, as a user may (#918):
// some lines using an item a group marks leave that group, wholly or in part, for another group
// or Ungrouped; some lines making it that sit in another group move into the marking group, or
// join it beside their own; and some groups' own lines are assigned to another group, which does
// not move them while their group exists (rowMemberships). A marking group's own line then makes
// more, or less, than its group asks for. `moved` counts the rows moved.
function edited(
  plan: CurrentCalculatedPlan,
  groups: FactoryGroups,
  seed: number,
): { groups: FactoryGroups; moved: number } {
  const { next, pick } = random(seed + 0x918);
  const seen = new Set<string>();
  const rows = Object.values(plan.stages)
    .flatMap(rowsOf)
    .filter(row => !row.id.startsWith('power-') && !seen.has(row.id) && !!seen.add(row.id));
  const assignments: FactoryGroups['assignments'] = { ...groups.assignments };
  const uses = (row: CalcRow, items: string[]) => items.some(item => (row.inputs?.[item] || 0) > 0);
  const makes = (row: CalcRow, items: string[]) =>
    items.some(item => (row.outputs?.[item] || 0) > 0);
  // A group the memberships are not in, if there is one.
  const elsewhere = (memberships: GroupAssignment[]) => {
    const free = groups.groups.filter(
      group => !memberships.some(membership => membership.group === group.id),
    );
    return free.length ? pick(free).id : undefined;
  };
  let moved = 0;
  for (const [group, items] of Object.entries(groups.local || {}))
    for (const row of rows) {
      if (row.onSite) continue;
      const memberships = assignments[row.id] || [];
      const inGroup = memberships.some(membership => membership.group === group);
      if (inGroup && uses(row, items) && next() < 0.5) {
        const rest = memberships.filter(membership => membership.group !== group);
        const roll = next(),
          target = elsewhere(memberships);
        // Out to Ungrouped (or its other groups), to another group, or split with another group.
        if (roll < 0.25 || !target) assignments[row.id] = rest;
        else
          assignments[row.id] =
            roll < 0.7
              ? [...rest, { group: target, rate: null }]
              : [...memberships, { group: target, rate: null }];
        moved++;
      } else if (!inGroup && memberships.length && makes(row, items) && next() < 0.5) {
        assignments[row.id] =
          next() < 0.5 ? [{ group, rate: null }] : [...memberships, { group, rate: null }];
        moved++;
      }
    }
  for (const row of rows) {
    const target = row.onSite && elsewhere([{ group: row.onSite.group, rate: null }]);
    if (target && next() < 0.3) assignments[row.id] = [{ group: target, rate: null }];
  }
  return { groups: { ...groups, assignments }, moved };
}

// What is wrong with a phase's books (#918), as messages: the sink taking more of an item than
// the plan's surplus, or the places asking for an item getting less than they ask for while the
// plan makes enough of it (counted without groups).
function bookProblems(stage: StoredStage, groups: FactoryGroups): string[] {
  const problems: string[] = [];
  const tolerance = (rate: number) => 1e-6 * Math.max(1, rate);
  const sunk = new Map<string, number>();
  for (const link of groupLinks(stage, groups))
    if (link.to === OUTSIDE.surplus)
      for (const entry of link.items)
        sunk.set(entry.item, (sunk.get(entry.item) || 0) + entry.rate);
  for (const [item, rate] of sunk) {
    const surplus = stage.surplus?.[item] || 0;
    if (rate > surplus + tolerance(surplus))
      problems.push(`the sink takes ${rate} ${item} of a surplus of ${surplus}`);
  }
  const whole = itemBooks(stage, { groups: [], assignments: {} });
  const books = itemBooks(stage, groups);
  for (const item of Object.keys(books.demand)) {
    const needed = placeTotal(whole.demand[item]);
    const enough = placeTotal(whole.supply[item]) >= needed - tolerance(needed);
    const made = placeTotal(books.supply[item]),
      asked = placeTotal(books.demand[item]);
    if (enough && made < asked - tolerance(asked))
      problems.push(`${item}: the places get ${made} of the ${asked} they ask for`);
  }
  return problems;
}

// Whether the groups' own lines make more of an item beyond their groups' demand than the plan
// sinks (ItemBooks.local against the stage's surplus).
const overSink = (stage: StoredStage, groups: FactoryGroups): boolean =>
  Object.entries(itemBooks(stage, groups).local).some(([item, lines]) => {
    const excess = [...lines.values()].reduce(
      (total, line) => total + Math.max(0, line.made - line.asked),
      0,
    );
    return excess > (stage.surplus?.[item] || 0) + 1e-6;
  });

// The problems of the books and of every group's flow, in each phase that makes what it asks for
// (only such a plan promises rows that add up).
function planProblems(
  plan: CurrentCalculatedPlan,
  groups: FactoryGroups,
  label: string,
  count: { rows: number },
): string[] {
  const problems: string[] = [];
  for (const [phase, stage] of Object.entries(plan.stages)) {
    if (!stage.feasible) continue;
    for (const problem of bookProblems(stage, groups))
      problems.push(`${label}, phase ${phase}: ${problem}`);
    for (const group of groups.groups)
      for (const problem of flowProblems(stage, groups, group.id, count))
        problems.push(`${label}, phase ${phase}: ${problem}`);
  }
  return problems;
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
    problems.push(...planProblems(plan, groups, `seed ${seed}`, count));
  }
  assert.equal(configurations, 18);
  assert.ok(holding >= 12, `${holding} configurations hold another maker of a marked item`);
  assert.ok(count.rows > 1000, `${count.rows} rows checked`);
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
});

test('after group edits that change what a marking group asks for, the books still balance (#918)', () => {
  const count = { rows: 0 };
  const problems: string[] = [];
  let edits = 0,
    reshared = 0;
  for (let seed = 1; seed <= 18; seed++) {
    const configured = configuration(seed);
    const { groups, moved } = edited(configured.plan, configured.groups, seed);
    if (moved) edits++;
    problems.push(...planProblems(configured.plan, groups, `seed ${seed} edited`, count));
    // The phases where the groups' own lines make more beyond their groups' demand than the plan
    // sinks, so some of it is offered to the other places.
    for (const stage of Object.values(configured.plan.stages))
      if (stage.feasible && overSink(stage, groups)) reshared++;
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
  assert.ok(edits >= 15, `${edits} configurations edited`);
  assert.ok(reshared >= 40, `${reshared} phases offer an own line's excess to the other places`);
  assert.ok(count.rows > 1000, `${count.rows} rows checked`);
});

test("the issue's case: a group's own Iron Rod line sends the sink only the plan's surplus (#918)", () => {
  // Seed 16: Group 2 marks Iron Rod and holds the central Rotor line; Group 0 marks Rotor. In
  // Phase 2 Group 2's own Iron Rod line makes 150 for the 147 its group asks, and the plan sinks
  // 15. After the recalculation half the Rotor line joins Group 0, so Group 2 asks only 117.
  const { plan, groups: configured } = configuration(16);
  const stage = plan.stages['2'];
  const ownLine = rowsOf(stage).find(row => row.id === 'Recipe_IronRod_C:fg-rand2')!;
  assert.equal(ownLine.outputs['Iron Rod'], 150);
  assert.equal(stage.surplus?.['Iron Rod'], 15);
  const groups: FactoryGroups = {
    ...configured,
    assignments: {
      ...configured.assignments,
      Recipe_Rotor_C: [
        { group: 'fg-rand2', rate: null },
        { group: 'fg-rand0', rate: null },
      ],
    },
  };
  const books = itemBooks(stage, groups);
  assert.equal(books.local['Iron Rod']!.get('fg-rand2')!.asked, 117);
  const links = groupLinks(stage, groups);
  const ironRod = (from: string | null, to: string) =>
    links
      .filter(link => (from === null || link.from === from) && link.to === to)
      .flatMap(link => link.items)
      .filter(entry => entry.item === 'Iron Rod')
      .reduce((total, entry) => total + entry.rate, 0);
  assert.ok(ironRod(null, OUTSIDE.surplus) <= 15 + 1e-9, `${ironRod(null, OUTSIDE.surplus)} sunk`);
  // Group 0 gets all the Iron Rod it asks for, part of it from Group 2's own line.
  const asked = books.demand['Iron Rod']!.get('fg-rand0')!;
  assert.ok(near(ironRod(null, 'fg-rand0'), asked), `${ironRod(null, 'fg-rand0')} of ${asked}`);
  assert.ok(ironRod('fg-rand2', 'fg-rand0') > 0, 'Group 2 sends Group 0 Iron Rod');
  assert.deepEqual(bookProblems(stage, groups), []);
  // The sink takes its 15 from the own line's excess of 33, and the other 18 are offered.
  assert.ok(near(books.sunk['Iron Rod']!.get('fg-rand2')!, 15));
  assert.ok(near(books.offered['Iron Rod']!.get('fg-rand2')!, 18));
  // Every place's input rows add up, and the own line's output row too.
  for (const group of groups.groups)
    assert.deepEqual(flowProblems(stage, groups, group.id), [], group.id);
  const flow = groupFlow(stage, groups, 'fg-rand2', belts)!;
  const out = flow.lines
    .find(line => line.id === ownLine.id)!
    .outputs.find(row => row.item === 'Iron Rod')!;
  assert.ok(near(sum(out.links), 150));
  const toSink = out.links.filter(
    link => link.to.kind === 'place' && link.to.id === OUTSIDE.surplus,
  );
  assert.ok(near(sum(toSink), 15), `${sum(toSink)} to the sink`);
});

// The books, links and group flows of plans whose groups leave every marking group asking for
// what its own lines were sized to, recorded before #918
// (tests/fixtures/on-site-books-2026-10-04.json): the Alpha, Beta and Gamma plan of
// tests/ui/on-site-flow-dialog.test.ts, the configurations of seeds 1 to 4 above (Phase 3) and the
// frozen plan without lines made on site, with marking groups. Each case keeps its stage, so the
// check reads no planner. The factory dialog's flows of the same cases are checked in that test.
// The links and group flows were recorded again when #1022 changed how an item is shared out
// (shareOut: each group uses its own supply first): every place still sends and receives the same
// net amount of each item, only by fewer links and never both ways. The books themselves, which
// #918 must leave alone, offer nothing in any of these cases.
interface RecordedCase {
  label: string;
  stage: StoredStage;
  groups: FactoryGroups;
  links: ReturnType<typeof groupLinks>;
  flows: Record<string, unknown>;
}
const recorded: { cases: RecordedCase[] } = JSON.parse(
  fs.readFileSync('tests/fixtures/on-site-books-2026-10-04.json', 'utf8'),
);
// A group flow as recorded: each line's rows with their links, and the ports.
const flowRecord = (flow: GroupFlow) => {
  const end = (flowEnd: FlowEnd) => flowEnd.kind[0] + ':' + flowEnd.id;
  return {
    lines: flow.lines.map(line => [
      line.id,
      line.share,
      [...line.inputs, ...line.outputs].map(flowRow => [
        flowRow.id,
        flowRow.rate,
        flowRow.links.map(link => [
          end(link.from),
          end(link.to),
          link.rate,
          link.loop ? 1 : 0,
          link.self ? 1 : 0,
        ]),
      ]),
    ]),
    ins: flow.ins.map(port => [port.place, port.item, port.rate]),
    outs: [...flow.outs, ...flow.fold.ports].map(port => [port.place, port.item, port.rate]),
  };
};

test('plans whose groups were not edited after the recalculation keep exactly the books they had (#918)', () => {
  assert.equal(recorded.cases.length, 6);
  for (const entry of recorded.cases) {
    const { stage, groups } = entry;
    assert.deepEqual(itemBooks(stage, groups).offered, {}, `${entry.label}: nothing offered`);
    assert.deepEqual(groupLinks(stage, groups), entry.links, entry.label);
    for (const group of groups.groups)
      assert.deepEqual(
        flowRecord(groupFlow(stage, groups, group.id, belts)!),
        entry.flows[group.id],
        `${entry.label}: ${group.id}`,
      );
  }
});
