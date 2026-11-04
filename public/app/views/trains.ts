// The data behind the Logistics page's Trains tab (#1284, slices 2 to 4): each line's card (its
// train, stops, what each wagon carries and its checks) and each outpost's checks, read from the
// open profile's stations and lines with the plan's node survey and the catalog's stack sizes. The
// line editor (ui/detail/LineDialog.vue) reads its draft through lineView too, so the page and the
// editor show the same answers.
import { bestLane, FLUIDS } from '../flow.ts';
import { groupLinks, placeName } from '../group-links.ts';
import { carrierTransport, linkCarrier } from '../logistics.ts';
import { calcStage, calculated, state, workspace } from '../session.ts';
import type { ProposalWorld, TrainLinkInput } from '../train-proposal.ts';
import { factoryGroupsState } from './factories.ts';
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

// The links of the phase shown that go by train (#1301): mode 'train' saved on the link, as the
// Between factories tab and the flow page read it (linkCarrier), with the round trip saved there.
export function phaseTrainLinks(): TrainLinkInput[] {
  const stage = calcStage();
  if (!calculated || !stage?.rows?.length) return [];
  const groups = factoryGroupsState();
  if (!groups.groups.length) return [];
  return groupLinks(stage, groups, calculated.settings.onSite).flatMap(link => {
    const transport = carrierTransport(linkCarrier(groups.links, link.from, link.to));
    return transport?.mode === 'train'
      ? [{ from: link.from, to: link.to, items: link.items, roundTripMin: transport.roundTripMin }]
      : [];
  });
}
// The mark number of a lane: 'Mk.4' is 4.
const markNumber = (mark: string) => Number(/\d+/.exec(mark)?.[0] ?? 1);
// What the proposal reads of the open profile and the phase shown.
export function proposalWorld(): ProposalWorld {
  const groups = factoryGroupsState().groups;
  const raw = calcStage()?.raw;
  return {
    groups,
    ...(state.factoryPlaces ? { places: state.factoryPlaces } : {}),
    stations: state.trainStations ?? [],
    lines: state.trainLines ?? [],
    facts: pageItemFacts(),
    belt: markNumber(bestLane(false).mark),
    pipe: markNumber(bestLane(true).mark),
    name: place => placeName(place, groups, raw),
  };
}
