// Train stations and lines on the world map (#1284, slice 4): which stations stand on the map and
// which can still be placed, a station's accessible name, the lines drawn between the stations
// (a solid line back and forth ⇄, dashed one-way →, in the line's colour), and the toasts. A
// station's place is `trainStations[].place` (state version 30), in game units as a factory's, and
// moves with the same keys (nudgedMarker in map-markers.ts); the stations are the same ones the
// Logistics page's Trains tab lists, so one placed or added here shows there and the other way
// round.
import { DIRECTION_TEXT, LINE_COLORS } from './train-lines.ts';
import { worldToImage, type WorldPoint } from './world-map.ts';
import type { FactoryPlace, TrainLine, TrainStation } from '../types/index.ts';

// The train station icon, an SVG path in a 20 × 20 box: a locomotive's front with its two lamps.
export const STATION_ICON =
  'M5 2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2l1.5 3h-2.2l-1.5-3H7.2l-1.5 3H3.5L5 15a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v4h10V5Zm1 6.5a1.2 1.2 0 1 0 0 .1Zm8 0a1.2 1.2 0 1 0 0 .1Z';

export interface PlacedStation {
  station: TrainStation;
  place: FactoryPlace;
}
// The stations on the map, in the profile's order (which is also the tab order).
export const placedStations = (stations: readonly TrainStation[]): PlacedStation[] =>
  stations.flatMap(station => (station.place ? [{ station, place: station.place }] : []));
// The stations not on the map yet: what "Place station" offers.
export const unplacedStations = (stations: readonly TrainStation[]): TrainStation[] =>
  stations.filter(station => !station.place);

// A station's accessible name on the map: its name, the lines that call there, and the keys.
export function stationAria(station: TrainStation, lines: readonly TrainLine[]): string {
  const names = lines.filter(line => line.stops.includes(station.id)).map(line => line.name);
  const calls = names.length ? ` Lines: ${names.join(', ')}.` : '';
  return `${station.name}, train station.${calls} Enter edits it, the arrow keys move it, Delete takes it off the map.`;
}

// One line as the map draws it: its path through the placed stations it calls at, in px on the
// map at natural size (scaled with the zoom by the caller), its colour, whether it is dashed
// (one-way), and its label at the middle of its first leg.
export interface MapLine {
  id: string;
  color: number;
  dashed: boolean;
  points: { x: number; y: number }[];
  closed: boolean;
  label: { x: number; y: number; text: string };
}
// The lines with at least two placed stops; `spot` gives a station's spot now (a drag not saved
// yet included).
export function mapLines(
  lines: readonly TrainLine[],
  stations: readonly TrainStation[],
  spot: (station: TrainStation) => WorldPoint | undefined,
): MapLine[] {
  return lines.flatMap((line, index) => {
    const points = line.stops.flatMap(id => {
      const station = stations.find(entry => entry.id === id);
      const at = station && spot(station);
      return at ? [worldToImage(at)] : [];
    });
    if (points.length < 2) return [];
    const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
    return [
      {
        id: line.id,
        color: index % LINE_COLORS,
        dashed: line.direction === 'oneWay',
        points,
        closed: line.direction === 'oneWay' && points.length > 2,
        label: {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          text: `${line.name} ${DIRECTION_TEXT[line.direction].mark}`,
        },
      },
    ];
  });
}
// A drawn line's SVG path at `zoom`.
export const mapLinePath = (line: MapLine, zoom: number): string =>
  line.points.map((p, i) => `${i ? 'L' : 'M'}${p.x * zoom},${p.y * zoom}`).join(' ') +
  (line.closed ? ' Z' : '');

// The toasts.
export const stationOffMapNews = (name: string) => `Took “${name}” off the map.`;
export const stationBackOnMapNews = (name: string) => `“${name}” is back on the map.`;
