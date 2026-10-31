// The train network diagram (#1284, slice 4) on the Logistics page's Trains tab, as plain
// arithmetic the component (ui/factories/TrainDiagram.vue) draws in inline SVG, laid out the way a
// factory's flow graph is (flow-graph.ts): stations in columns by where they sit along the lines
// (each stop one column right of the stop before it, so pick-ups sit left and drop-offs right),
// one colour per line, parallel lines side by side. A station the user moved sits where they put
// it (`spots`, the stored `trainLayout.stations`, on the flow graph's 5-unit grid); the others at
// their automatic spots, and every line follows its stations.
import { snapUnit } from './graph-layout.ts';
import { DIRECTION_TEXT, LINE_COLORS } from './train-lines.ts';
import type { TrainLine, TrainPlatformKind, TrainStation } from '../types/index.ts';

// The drawing's sizes, in its own units (1 unit is 1 px at 100%).
export const DIAGRAM = {
  width: 200,
  height: 64,
  columnGap: 120,
  rowGap: 48,
  margin: 30,
  // How far apart lines between the same stations run.
  parallel: 7,
  // How far a line that runs back left (or to a station in the same column) swings out.
  swing: 60,
  nameChars: 26,
  captionChars: 30,
  platformGlyphs: 8,
} as const;

export interface DiagramStation {
  id: string;
  name: string;
  shortName: string;
  caption: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // The first platforms' kinds, drawn as glyphs in the box; `more` counts the rest.
  platforms: TrainPlatformKind[];
  more: number;
  // The lines that call here, by id.
  lines: string[];
}
export interface DiagramSegment {
  id: string;
  line: string;
  color: number;
  path: string;
  // Arrowheads: at the end always, at the start too back and forth.
  both: boolean;
  dashed: boolean;
}
export interface DiagramLabel {
  line: string;
  color: number;
  text: string;
  x: number;
  y: number;
}
export interface TrainDiagramModel {
  width: number;
  height: number;
  stations: DiagramStation[];
  segments: DiagramSegment[];
  labels: DiagramLabel[];
}

const shorten = (text: string, chars: number) =>
  text.length > chars ? text.slice(0, chars - 1).trimEnd() + '…' : text;

// Each station's column: 0, or one right of the stop before it on any line, as far right as its
// furthest such stop puts it (bounded, so a line that calls at a station twice stays put).
export function stationColumns(
  stations: readonly Pick<TrainStation, 'id'>[],
  lines: readonly Pick<TrainLine, 'stops'>[],
): Record<string, number> {
  const known = new Set(stations.map(station => station.id));
  const column: Record<string, number> = Object.fromEntries(stations.map(({ id }) => [id, 0]));
  for (let pass = 0; pass < stations.length; pass++) {
    let changed = false;
    for (const line of lines)
      line.stops.forEach((id, i) => {
        const before = line.stops[i - 1];
        if (!i || !before || !known.has(id) || !known.has(before) || before === id) return;
        const next = Math.min(stations.length - 1, column[before]! + 1);
        if (next > column[id]!) {
          column[id] = next;
          changed = true;
        }
      });
    if (!changed) break;
  }
  return column;
}
// Each station's automatic top-left corner: its column, and its place among the stations of that
// column in the profile's order.
export function automaticSpots(
  stations: readonly Pick<TrainStation, 'id'>[],
  lines: readonly Pick<TrainLine, 'stops'>[],
): Record<string, [number, number]> {
  const column = stationColumns(stations, lines);
  const rows: Record<number, number> = {};
  return Object.fromEntries(
    stations.map(({ id }) => {
      const col = column[id] ?? 0;
      const row = (rows[col] = (rows[col] ?? -1) + 1);
      return [
        id,
        [
          DIAGRAM.margin + col * (DIAGRAM.width + DIAGRAM.columnGap),
          DIAGRAM.margin + row * (DIAGRAM.height + DIAGRAM.rowGap),
        ] as [number, number],
      ];
    }),
  );
}

// The middle of a cubic curve (t = 0.5), where a line's label goes.
const middle = (a: number, b: number, c: number, d: number) =>
  0.125 * a + 0.375 * (b + c) + 0.125 * d;

// The curve from station `from` to station `to`, `off` units down from their middles: from the
// right side to the left side when `to` lies to the right, and swinging out around them otherwise.
function curve(from: DiagramStation, to: DiagramStation, off: number) {
  const y1 = from.y + from.height / 2 + off;
  const y2 = to.y + to.height / 2 + off;
  if (to.x >= from.x + from.width) {
    const x1 = from.x + from.width,
      x2 = to.x,
      mx = (x1 + x2) / 2;
    return {
      d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
      points: [x1, mx, mx, x2],
      ys: [y1, y1, y2, y2],
    };
  }
  // Back to the left: from the left side round to the right side; within one column: right side
  // to right side.
  const left = to.x + to.width <= from.x;
  const x1 = left ? from.x : from.x + from.width;
  const x2 = to.x + to.width;
  const c1 = left ? x1 - DIAGRAM.swing : x1 + DIAGRAM.swing;
  const c2 = x2 + DIAGRAM.swing;
  return {
    d: `M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`,
    points: [x1, c1, c2, x2],
    ys: [y1, y1, y2, y2],
  };
}

// The segments a line draws: each stop to the next and, for a one-way loop of three stops or
// more, the last back to the first. A stop of a station not drawn is passed over.
function lineSegments(
  line: TrainLine,
  at: Map<string, DiagramStation>,
): [DiagramStation, DiagramStation][] {
  const stops = line.stops.flatMap(id => at.get(id) ?? []);
  const pairs: [DiagramStation, DiagramStation][] = [];
  for (let i = 1; i < stops.length; i++)
    if (stops[i - 1] !== stops[i]) pairs.push([stops[i - 1]!, stops[i]!]);
  if (line.direction === 'oneWay' && stops.length > 2 && stops.at(-1) !== stops[0])
    pairs.push([stops.at(-1)!, stops[0]!]); // at least three stops, checked above
  return pairs;
}

// The diagram of `stations` and `lines` with the stored spots of moved stations, `cargo` giving
// each line's cargo for its label and `caption` each station's second line (its owner).
export function trainDiagram(
  stations: readonly TrainStation[],
  lines: readonly TrainLine[],
  spots: Readonly<Record<string, readonly [number, number]>>,
  cargo: (line: TrainLine) => string[],
  caption: (station: TrainStation) => string,
): TrainDiagramModel {
  const automatic = automaticSpots(stations, lines);
  const drawn = stations.map((station): DiagramStation => {
    const [x, y] = spots[station.id] ?? automatic[station.id] ?? [DIAGRAM.margin, DIAGRAM.margin];
    return {
      id: station.id,
      name: station.name,
      shortName: shorten(station.name, DIAGRAM.nameChars),
      caption: shorten(caption(station), DIAGRAM.captionChars),
      x,
      y,
      width: DIAGRAM.width,
      height: DIAGRAM.height,
      platforms: station.platforms.slice(0, DIAGRAM.platformGlyphs).map(platform => platform.kind),
      more: Math.max(0, station.platforms.length - DIAGRAM.platformGlyphs),
      lines: lines.filter(line => line.stops.includes(station.id)).map(line => line.id),
    };
  });
  const at = new Map(drawn.map(station => [station.id, station]));
  const segments: DiagramSegment[] = [];
  const labels: DiagramLabel[] = [];
  const spread = Math.min(DIAGRAM.parallel, 48 / Math.max(1, lines.length));
  lines.forEach((line, index) => {
    const color = index % LINE_COLORS;
    const off = (index - (lines.length - 1) / 2) * spread;
    lineSegments(line, at).forEach(([from, to], i) => {
      const shape = curve(from, to, off);
      segments.push({
        id: `${line.id}:${i}`,
        line: line.id,
        color,
        path: shape.d,
        both: line.direction === 'backAndForth',
        dashed: line.direction === 'oneWay',
      });
      if (i) return;
      const [x1, c1, c2, x2] = shape.points as [number, number, number, number];
      const [y1, , , y2] = shape.ys as [number, number, number, number];
      const goods = cargo(line);
      labels.push({
        line: line.id,
        color,
        text: `${line.name} ${DIRECTION_TEXT[line.direction].mark} ${goods.length ? goods.join(', ') : 'no cargo yet'}`,
        x: middle(x1, c1, c2, x2),
        y: middle(y1, y1, y2, y2) - 8,
      });
    });
  });
  const width = Math.max(
    DIAGRAM.width + 2 * DIAGRAM.margin,
    ...drawn.map(station => station.x + station.width + DIAGRAM.margin + DIAGRAM.swing),
  );
  const height = Math.max(
    DIAGRAM.height + 2 * DIAGRAM.margin,
    ...drawn.map(station => station.y + station.height + DIAGRAM.margin),
  );
  return { width, height, stations: drawn, segments, labels };
}

// What a save stores (trainLayout): the spots of the stations in `keep` (whole units on the grid),
// the zoom to two decimals and the scroll offsets in whole px; each left out when it says nothing,
// and null when nothing is left.
export function trainLayoutToSave(
  spots: Readonly<Record<string, readonly [number, number]>>,
  view: { zoom: number; left: number; top: number } | null,
  keep: ReadonlySet<string>,
) {
  const layout: {
    stations?: Record<string, [number, number]>;
    zoom?: number;
    pan?: [number, number];
  } = {};
  const kept = Object.entries(spots).filter(([id]) => keep.has(id));
  if (kept.length)
    layout.stations = Object.fromEntries(
      kept.map(([id, [x, y]]) => [id, [snapUnit(x), snapUnit(y)]]),
    );
  if (view) {
    const zoom = Math.round(view.zoom * 100) / 100;
    if (zoom !== 1) layout.zoom = zoom;
    const pan: [number, number] = [
      Math.max(0, Math.round(view.left)),
      Math.max(0, Math.round(view.top)),
    ];
    if (pan[0] || pan[1]) layout.pan = pan;
  }
  return Object.keys(layout).length ? layout : null;
}
