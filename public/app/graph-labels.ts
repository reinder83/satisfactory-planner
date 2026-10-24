// Where the flow graph's edge labels go (#1231, part of #1201). Each label starts at the middle of
// its curve; where it would cover a box, a tag or a label placed before it, it slides along its
// own curve to the first free spot (t = 0.5 ± 0.04, ± 0.08, … within 0.05–0.95). The labels are
// placed top to bottom. flowGraph and placedGraph place every label of the graph at rest this way
// and never leave one out (one with no free spot stays at its curve's middle); the dialog spreads
// the labels a hovered or focused box lights up the same way, and there a label with no free spot
// is left out: its value stays in its line's hover title and in "The graph as a table". Plain
// arithmetic, no session.
import type { GraphPoint } from './graph-view.ts';

// One curve of an arrow, as SVG draws a cubic Bézier: from, two control points, to.
export interface GraphCurve {
  from: GraphPoint;
  c1: GraphPoint;
  c2: GraphPoint;
  to: GraphPoint;
}

// A point of `curve` at `t` from 0 to 1.
export function curveAt(curve: GraphCurve, t: number): GraphPoint {
  const u = 1 - t;
  const mix = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return {
    x: mix(curve.from.x, curve.c1.x, curve.c2.x, curve.to.x),
    y: mix(curve.from.y, curve.c1.y, curve.c2.y, curve.to.y),
  };
}

// A straight run as a curve (a loop's lane under the boxes), so a label slides along it too.
export const straightCurve = (from: GraphPoint, to: GraphPoint): GraphCurve => ({
  from,
  c1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
  c2: { x: from.x + ((to.x - from.x) * 2) / 3, y: from.y + ((to.y - from.y) * 2) / 3 },
  to,
});

// How a label slides along its curve: from the middle out, `step` at a time each way, never
// nearer its ends than `min` and `max`.
export const LABEL_SLIDE = { step: 0.04, min: 0.05, max: 0.95 } as const;
// The points along a curve a label tries, in order: 0.5, 0.46, 0.54, 0.42, 0.58, … 0.06, 0.94.
const SLIDE_TS: readonly number[] = (() => {
  const spots = [0.5];
  for (let k = 1; ; k++) {
    const before = Math.round((0.5 - k * LABEL_SLIDE.step) * 100) / 100,
      after = Math.round((0.5 + k * LABEL_SLIDE.step) * 100) / 100;
    if (before < LABEL_SLIDE.min && after > LABEL_SLIDE.max) return spots;
    if (before >= LABEL_SLIDE.min) spots.push(before);
    if (after <= LABEL_SLIDE.max) spots.push(after);
  }
})();
export const labelSlides = (): readonly number[] => SLIDE_TS;

// A box by its middle and size: a node's, a tag's or a placed label's.
export interface GraphBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
const covers = (one: GraphBox, other: GraphBox): boolean =>
  Math.abs(one.x - other.x) < (one.width + other.width) / 2 &&
  Math.abs(one.y - other.y) < (one.height + other.height) / 2;

// A label to place: the curves it may sit on, in the order it tries them (the label slides along
// each in turn), and its width.
export interface LabelToPlace {
  id: string;
  width: number;
  curves: readonly GraphCurve[];
}
// Where a label went: its middle, and the curve it sits on.
export interface PlacedLabel {
  x: number;
  y: number;
  curve: GraphCurve;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

// `labels`, each `height` tall, placed top to bottom (by the middle of their first curve; ties in
// the order given) where they cover none of `obstacles` and no label placed before; each kept
// inside the drawing's top and left edges. A label with no free spot on any of its curves is
// null, or with `keepAll` at the middle of its first curve.
export function spreadLabels(
  labels: readonly LabelToPlace[],
  height: number,
  obstacles: readonly GraphBox[],
  keepAll: boolean,
): Map<string, PlacedLabel | null> {
  const placed: GraphBox[] = [...obstacles];
  const result = new Map<string, PlacedLabel | null>();
  const boxAt = (curve: GraphCurve, t: number, width: number): GraphBox => {
    const point = curveAt(curve, t);
    return {
      x: Math.max(width / 2, point.x),
      y: Math.max(height / 2, point.y),
      width,
      height,
    };
  };
  const order = labels
    .filter(label => label.curves.length)
    .map((label, i) => ({ label, i, y: curveAt(label.curves[0]!, 0.5).y }))
    .sort((a, b) => a.y - b.y || a.i - b.i);
  for (const { label } of order) {
    let spot: { box: GraphBox; curve: GraphCurve } | null = null;
    for (const curve of label.curves) {
      for (const t of SLIDE_TS) {
        const box = boxAt(curve, t, label.width);
        if (!placed.some(other => covers(box, other))) {
          spot = { box, curve };
          break;
        }
      }
      if (spot) break;
    }
    // The filter above keeps labels with a curve.
    const first = label.curves[0]!;
    if (!spot && keepAll) spot = { box: boxAt(first, 0.5, label.width), curve: first };
    if (spot) placed.push(spot.box);
    result.set(label.id, spot && { x: tenth(spot.box.x), y: tenth(spot.box.y), curve: spot.curve });
  }
  return result;
}
