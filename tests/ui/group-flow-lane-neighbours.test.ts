// The lane styles of a factory group's flow page by where the lanes run (#920). Lanes are packed
// into gutter columns by assignLanes, so two items side by side in the gutter can be any two
// items, and red-green colour blindness turns --accent, --red, --gold and --green into one run of
// yellows. What laneStyles guarantees, and what is tested here:
// 1. Lanes of two items in neighbouring gutter columns whose rows overlap never share a dash,
//    whenever one dash per item can keep them apart; always when every item rides one lane.
// 2. Lanes of two items of the red-green family whose rows overlap, in any columns, never share
//    a dash.
// 3. Where no dashes keep them apart, lanes beside each other on one dash take different hue
//    families while one is left (four items each beside the other three, below).
// 4. The same lanes always get the same styles, and the key shows each wire's style.
// The overlaps are worked out here from the rows' order down the cards, not with the module's
// own helper.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { test } from 'vitest';
import { assignLanes, groupFlow } from '../../public/app/group-flow.ts';
import type { FlowLine, FlowLink, FlowRow } from '../../public/app/group-flow.ts';
import { flowRoute, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { laneStyles, type LaneFlow } from '../../public/app/views/group-flow-page.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $$, generated, go, open, page } from './setup.ts';
import type { StageKey } from '../../public/types/index.ts';

const RED_GREEN = ['var(--accent)', 'var(--red)', 'var(--gold)', 'var(--green)'];
const familyOf = (color: string) => (RED_GREEN.includes(color) ? 'red-green' : color);

// Every pair of lanes of different items whose rows overlap down the cards (inclusive: two lanes
// ending on one input row meet there), with whether they lie in neighbouring columns.
interface Meeting {
  a: string;
  b: string;
  beside: boolean;
}
function meetings(flow: LaneFlow): Meeting[] {
  const rows = flow.lines.flatMap(line => [...line.inputs, ...line.outputs].map(row => row.id));
  const spans = flow.lanes.map(lane => {
    const at = [lane.from, ...lane.to].map(id => rows.indexOf(id));
    return { item: lane.item, lane: lane.lane, lo: Math.min(...at), hi: Math.max(...at) };
  });
  return spans.flatMap((a, i) =>
    spans
      .slice(i + 1)
      .filter(b => a.item !== b.item && a.lo <= b.hi && b.lo <= a.hi)
      .map(b => ({ a: a.item, b: b.item, beside: Math.abs(a.lane - b.lane) === 1 })),
  );
}

// Guarantees 1 (when `separable`), 2 and 3 on one flow; `what` names it in a failure.
function checkStyles(flow: LaneFlow, what: string, separable: boolean) {
  const styles = laneStyles(flow);
  for (const { a, b, beside } of meetings(flow)) {
    const one = styles.get(a)!,
      other = styles.get(b)!;
    const pair = `${what}: ${a} (${one.color} [${one.dash}]) and ${b} (${other.color} [${other.dash}])`;
    if (beside && separable) assert.notEqual(one.dash, other.dash, pair + ' run beside each other');
    if (beside && one.dash === other.dash)
      assert.notEqual(familyOf(one.color), familyOf(other.color), pair + ' look alike');
    if (familyOf(one.color) === 'red-green' && familyOf(other.color) === 'red-green')
      assert.notEqual(one.dash, other.dash, pair + ' overlap in the red-green family');
  }
}

const plan = generated();
const groups = defaultFactoryGroups(plan);
const flowOf = (phase: StageKey, groupId: string) =>
  groupFlow(plan.stages[phase], groups, groupId, () => '')!;

test('Iron & steel works in Phase 3: Iron Plate and Steel Beam run beside each other on other dashes', () => {
  const flow = flowOf('3', 'fg-iron01');
  // The issue's example: the two lanes lie in neighbouring columns and overlap.
  assert.ok(
    meetings(flow).some(
      ({ a, b, beside }) => beside && [a, b].sort().join() === 'Iron Plate,Steel Beam',
    ),
    'Iron Plate and Steel Beam run beside each other',
  );
  const styles = laneStyles(flow);
  assert.notEqual(styles.get('Iron Plate')!.dash, styles.get('Steel Beam')!.dash);
  assert.equal(styles.size, 10, 'ten items ride lanes');
  checkStyles(flow, 'Iron & steel works', true);
});

test('every group of the default plan, in every phase, keeps the rules', () => {
  let checked = 0;
  for (const phase of Object.keys(plan.stages) as StageKey[])
    for (const group of groups.groups) {
      const flow = flowOf(phase, group.id);
      if (!flow.lanes.length) continue;
      // An item made by several lines rides several lanes; these still separate.
      checkStyles(flow, `${group.name} in Phase ${phase}`, true);
      checked++;
    }
  assert.ok(checked > 20, `${checked} flows with lanes`);
});

// A small seeded generator, so a failure repeats.
function random(seed: number) {
  let state = seed;
  return (n: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * n);
  };
}
const flowRow = (id: string, item: string, links: FlowLink[]): FlowRow => ({
  id,
  item,
  rate: 1,
  belts: '',
  links,
});
// `count` lines in a row; line i makes item I<i mod items> and uses up to three items made by
// other lines (mostly earlier ones, sometimes a later one, as a loop does). With `items` equal to
// `count` every item rides one lane; with fewer, several lines make the same item.
function layout(seed: number, count: number, items: number): LaneFlow {
  const pick = random(seed);
  const made = (i: number) => `I${i % items}`;
  const uses = Array.from({ length: count }, (_, i) => {
    const from = new Map<string, number[]>();
    for (let k = pick(4); k > 0; k--) {
      const source = pick(5) ? pick(Math.max(i, 1)) : pick(count);
      if (source === i || made(source) === made(i)) continue;
      from.set(made(source), [...new Set([...(from.get(made(source)) ?? []), source])]);
    }
    return from;
  });
  const link = (item: string, from: number, to: number): FlowLink => ({
    item,
    rate: 1,
    belts: '',
    from: { kind: 'line', id: `L${from}` },
    to: { kind: 'line', id: `L${to}` },
    loop: from > to,
    self: false,
  });
  const lines: FlowLine[] = Array.from({ length: count }, (_, i) => ({
    id: `L${i}`,
    no: i + 1,
    recipe: `L${i}`,
    name: `L${i}`,
    machine: 'Constructor',
    machines: 1,
    lastClock: 100,
    share: 1,
    machinesHere: 1,
    mw: 0,
    inputs: [...uses[i]!].map(([item, sources]) =>
      flowRow(
        `in|L${i}|${item}`,
        item,
        sources.map(source => link(item, source, i)),
      ),
    ),
    outputs: [
      flowRow(
        `out|L${i}|${made(i)}`,
        made(i),
        uses.flatMap((from, to) => (from.get(made(i))?.includes(i) ? [link(made(i), i, to)] : [])),
      ),
    ],
  }));
  return { lines, lanes: assignLanes(lines) };
}

test('generated layouts with one lane per item never put one dash beside itself', () => {
  let beside = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const count = 3 + (seed % 14);
    const flow = layout(seed, count, count);
    assert.ok(
      flow.lanes.every((lane, i) => flow.lanes.findIndex(other => other.item === lane.item) === i),
      'one lane per item',
    );
    beside += meetings(flow).filter(meeting => meeting.beside).length;
    checkStyles(flow, `seed ${seed}`, true);
  }
  assert.ok(beside > 400, `${beside} pairs of lanes beside each other were checked`);
});

// Whether some dash per item keeps every pair of items beside each other apart, by trying them
// all (the generated layouts below have at most seven items).
function separable(flow: LaneFlow): boolean {
  const items = [...new Set(flow.lanes.map(lane => lane.item))];
  const pairs = meetings(flow).filter(meeting => meeting.beside);
  for (let code = 0; code < 3 ** items.length; code++) {
    const dash = (item: string) => Math.floor(code / 3 ** items.indexOf(item)) % 3;
    if (pairs.every(({ a, b }) => dash(a) !== dash(b))) return true;
  }
  return false;
}

test('generated layouts where items ride several lanes keep them apart whenever dashes can', () => {
  let several = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const count = 4 + (seed % 12);
    const flow = layout(seed, count, 2 + (seed % 6));
    if (flow.lanes.some((lane, i) => flow.lanes.findIndex(o => o.item === lane.item) !== i))
      several++;
    checkStyles(flow, `seed ${seed}`, separable(flow));
  }
  assert.ok(several > 200, `${several} layouts with an item on several lanes`);
});

test('four items each beside the other three: no dashes keep them apart, the families do', () => {
  // Eight full-height lanes in the columns A B C D A C B D: every two of the four items have
  // lanes in neighbouring columns, so two of them must share a dash.
  const rows = Array.from({ length: 10 }, (_, i) => flowRow(`r${i}`, 'x', []));
  const line: FlowLine = {
    id: 'L',
    no: 1,
    recipe: 'L',
    name: 'L',
    machine: 'Constructor',
    machines: 1,
    lastClock: 100,
    share: 1,
    machinesHere: 1,
    mw: 0,
    inputs: rows,
    outputs: [],
  };
  const flow: LaneFlow = {
    lines: [line],
    lanes: [...'ABCDACBD'].map((item, lane) => ({
      lane,
      line: 'L',
      item,
      from: 'r0',
      to: ['r9'],
      links: [],
    })),
  };
  assert.equal(separable(flow), false);
  checkStyles(flow, 'A B C D', false);
});

test('the same lanes always get the same styles, by the key’s order', () => {
  const flow = flowOf('3', 'fg-iron01');
  const first = laneStyles(flow);
  assert.deepEqual([...laneStyles(structuredClone(flow))], [...first]);
  assert.deepEqual([...laneStyles(flowOf('3', 'fg-iron01'))], [...first]);
  assert.deepEqual(
    [...first.keys()],
    [...new Set(flow.lanes.map(lane => lane.item))],
    'the key lists items in the order their lanes first appear',
  );
  for (let seed = 1; seed <= 50; seed++)
    assert.deepEqual([...laneStyles(layout(seed, 12, 5))], [...laneStyles(layout(seed, 12, 5))]);
});

test('the key above the cards shows the style each item’s wires are drawn in', async () => {
  page();
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  location.hash = '#' + flowRoute('fg-iron01');
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  const styles = laneStyles(flowOf('3', 'fg-iron01'));
  const key = new Map(
    $$('[data-gf-key] .gf-key-item').map(entry => {
      const line = entry.querySelector<SVGLineElement>('line')!;
      return [entry.textContent!.trim(), [line.style.stroke, line.style.strokeDasharray]];
    }),
  );
  assert.deepEqual(
    [...key],
    [...styles].map(([item, style]) => [item, [style.color, style.dash]]),
  );
  const wires = $$('.gf-wire');
  assert.ok(wires.length > 0);
  for (const wire of wires) {
    // A wire starts on an output row, 'out|<row>|<item>'.
    const item = wire.dataset.fromRow!.split('|').pop()!;
    const path = wire.querySelector<SVGPathElement>('path')!;
    assert.deepEqual([path.style.stroke, path.style.strokeDasharray], key.get(item), item);
  }
});
