// The data behind the Logistics page's Trains tab (#1284, slices 2 to 4): each line's card (its
// train, stops, what each wagon carries and its checks) and each outpost's checks, read from the
// open profile's stations and lines with the plan's node survey and the catalog's stack sizes. The
// line editor (ui/detail/LineDialog.vue) reads its draft through lineView too, so the page and the
// editor show the same answers.
import { FLUIDS } from '../flow.ts';
import { calculated, state, workspace } from '../session.ts';
import {
  consistText,
  DIRECTION_TEXT,
  fillText,
  LINE_COLORS,
  lineChecks,
  outpostChecks,
  wagonCargo,
  wagonFill,
  wagonPlan,
  type ItemFacts,
  type Survey,
  type TrainCheck,
} from '../train-lines.ts';
import { listNames } from '../../wording.ts';
import type { TrainLine, TrainStation } from '../../types/index.ts';

// The page's item facts: the catalog's stack sizes (100 for an item it lacks) and flow.ts's fluids.
export const pageItemFacts = (): ItemFacts => ({
  stack: item => workspace?.catalog?.stacks?.[item] || 100,
  fluid: item => FLUIDS.has(item),
});
// The miner mark and clock the plan's node survey plans with.
export const planSurvey = (): Survey => {
  const survey = calculated?.settings?.extraction;
  return { mark: survey?.mark ?? 3, clock: survey?.clock ?? 2.5 };
};

// One wagon of the table "What each wagon carries".
export interface WagonRow {
  number: number;
  cargo: string;
  mixed: boolean;
  loadAt: string;
  unloadAt: string;
  lane: string;
  fill: string;
  fits: boolean | null;
}
const stationNames = (stops: { station: TrainStation }[]) =>
  [...new Set(stops.map(stop => stop.station.name))].join(', ') || '—';

export function wagonRows(
  line: TrainLine,
  stations: readonly TrainStation[],
  facts: ItemFacts,
): WagonRow[] {
  return wagonPlan(line, stations).map(wagon => {
    const cargo = wagonCargo(wagon);
    const first = wagon.loads[0];
    const fill = first ? wagonFill(wagon, first, line.roundTrip, facts) : null;
    const note = !wagon.loads.length
      ? 'Loads nothing'
      : !wagon.unloads.length
        ? 'Never unloaded'
        : line.roundTrip
          ? '—'
          : 'Enter the round trip';
    return {
      number: wagon.number,
      cargo: cargo.length ? listNames(cargo) : '—',
      mixed: cargo.length > 1,
      loadAt: stationNames(wagon.loads),
      unloadAt: stationNames(wagon.unloads),
      lane: fill
        ? `${fill.lane} (${fill.rate.toLocaleString('en-US')}${fill.fluid ? ' m³' : ''}/min)`
        : '—',
      fill: fill ? fillText(fill) : note,
      fits: fill ? fill.fits : null,
    };
  });
}

// A line as its card and the editor show it.
export interface LineView {
  id: string;
  name: string;
  color: number;
  direction: string;
  mark: string;
  train: string;
  stops: string[];
  roundTrip: string;
  cargo: string;
  wagons: WagonRow[];
  checks: TrainCheck[];
}
export function lineView(
  line: TrainLine,
  index: number,
  stations: readonly TrainStation[],
  facts: ItemFacts,
): LineView {
  const wagons = wagonRows(line, stations, facts);
  const cargo = [...new Set(wagonPlan(line, stations).flatMap(wagonCargo))];
  return {
    id: line.id,
    name: line.name,
    color: index % LINE_COLORS,
    direction: DIRECTION_TEXT[line.direction].label,
    mark: DIRECTION_TEXT[line.direction].mark,
    train: consistText(line.cars),
    stops: line.stops.map(id => stations.find(station => station.id === id)?.name ?? id),
    roundTrip: line.roundTrip
      ? `${line.roundTrip.toLocaleString('en-US')} min round trip`
      : 'Round trip not entered',
    cargo: cargo.length ? listNames(cargo) : 'no cargo yet',
    wagons,
    checks: lineChecks(line, stations, facts),
  };
}

// The open profile's lines and outposts as the Trains tab shows them.
export function trainsView() {
  const stations = state.trainStations ?? [];
  const lines = state.trainLines ?? [];
  const facts = pageItemFacts();
  const survey = planSurvey();
  return {
    stations,
    lines: lines.map((line, i) => lineView(line, i, stations, facts)),
    outposts: Object.fromEntries(
      stations.map(station => [station.id, outpostChecks(station, lines, stations, survey, facts)]),
    ),
  };
}
