// The colour and dash of each item's lanes on a factory group's flow page (#909): lanes must
// not differ by colour alone (WCAG 1.4.1), so neighbouring items differ in dash from the first
// item on, the first items never share both colour and dash, and the same lanes always get the
// same styles. Lanes that never run beside each other or overlap keep this preferred order;
// tests/ui/group-flow-lane-neighbours.test.ts covers lanes that do (#920).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { laneStyleAt, laneStyles, type LaneFlow } from '../../public/app/views/group-flow-page.ts';

// A lane per item, in the given order, on rows no line has: no two lanes meet.
const lanesOf = (items: readonly string[]): LaneFlow => ({
  lines: [],
  lanes: items.map((item, lane) => ({
    lane,
    line: `l${lane}`,
    item,
    from: `out|${lane}`,
    to: [],
    links: [],
  })),
});
const items = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i}`);

// The six colours times the three dashes.
const DISTINCT = 18;

test('the first six items differ in dash from their neighbours, not by colour alone', () => {
  const styles = [...laneStyles(lanesOf(items(6))).values()];
  assert.equal(styles.length, 6);
  for (let i = 1; i < styles.length; i++)
    assert.notEqual(styles[i]!.dash, styles[i - 1]!.dash, `items ${i - 1} and ${i} share a dash`);
  assert.equal(new Set(styles.map(style => style.color)).size, 6, 'six different colours');
  assert.equal(new Set(styles.map(style => style.dash)).size, 3, 'all three dashes in use');
});

test('neighbouring items never share a dash, also across a round of the colours', () => {
  for (let n = 1; n < DISTINCT + 6; n++)
    assert.notEqual(laneStyleAt(n).dash, laneStyleAt(n - 1).dash, `items ${n - 1} and ${n}`);
});

test('no two of the first 18 items share both colour and dash', () => {
  const seen = new Set<string>();
  for (let n = 0; n < DISTINCT; n++) {
    const { color, dash } = laneStyleAt(n);
    const key = `${color}|${dash}`;
    assert.ok(!seen.has(key), `item ${n} repeats ${key}`);
    seen.add(key);
  }
});

test('the warm hues are never neighbours or on one dash among the first six', () => {
  const warm = new Set(['var(--accent)', 'var(--red)', 'var(--gold)']);
  const styles = Array.from({ length: 6 }, (_, n) => laneStyleAt(n));
  const warmAt = styles.flatMap((style, n) => (warm.has(style.color) ? [n] : []));
  assert.equal(warmAt.length, 3);
  for (let i = 1; i < warmAt.length; i++) assert.ok(warmAt[i]! - warmAt[i - 1]! > 1);
  assert.equal(new Set(warmAt.map(n => styles[n]!.dash)).size, 3);
});

test('only the :root colour tokens and a small set of dashes are used', () => {
  for (let n = 0; n < 40; n++) {
    const { color, dash } = laneStyleAt(n);
    assert.match(color, /^var\(--(accent|blue|red|green|gold|ink)\)$/);
    assert.ok(['', '7 4', '2 3'].includes(dash), `item ${n} has dash ${dash}`);
  }
});

test('the assignment is deterministic: by first appearance, whatever the lane count', () => {
  const order = ['Iron Ingot', 'Steel Ingot', 'Iron Plate', 'Iron Rod', 'Screw', 'Steel Pipe'];
  // Each item rides two lanes, the second time after all others have appeared.
  const lanes = lanesOf([...order, ...order.slice().reverse()]);
  const first = laneStyles(lanes),
    again = laneStyles(lanes);
  assert.deepEqual([...first.keys()], order);
  assert.deepEqual([...first], [...again]);
  assert.deepEqual(
    [...first.values()],
    order.map((_, n) => laneStyleAt(n)),
  );
  assert.deepEqual(laneStyleAt(0), { color: 'var(--accent)', dash: '' });
  assert.deepEqual(laneStyleAt(1), { color: 'var(--blue)', dash: '7 4' });
});
