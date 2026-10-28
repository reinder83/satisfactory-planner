// Factories on the world map (#1283, slice 3 of 3): which factories are on the map and which can
// still be placed, a factory's icon and accessible name, and the toasts. The saved shape and its
// limits are in state/validate.ts (validateFactoryPlaces: `factoryPlaces`, state version 28, by
// factory group id); a place is in the game's world units, as a marker's spot, and moves with the
// same keys (nudgedMarker in map-markers.ts). Lines in no factory ("Ungrouped") have no place:
// only a factory of the profile can be placed, each at most once.
import { onMap } from './map-markers.ts';
import { imageToWorld, worldToImage, type WorldPoint } from './world-map.ts';
import type { FactoryGroup, FactoryPlace, FactoryPlaces } from '../types/index.ts';

// The factory icon, an SVG path in a 20 × 20 box: a building with a sawtooth roof and a chimney,
// drawn in the accent colour on the dark round pin.
export const FACTORY_ICON = 'M2 18V9l4-3v3l4-3v3l4-3V3h3v15ZM5 12v2h2v-2Zm4 0v2h2v-2Zm4 0v2h2v-2Z';

// One factory as the map draws it: its group's id and name and its place.
export interface PlacedFactory {
  id: string;
  name: string;
  place: FactoryPlace;
}
// The factories on the map, in the Factories page's order (which is also the tab order).
export const placedFactories = (
  groups: readonly Pick<FactoryGroup, 'id' | 'name'>[],
  places: FactoryPlaces | undefined,
): PlacedFactory[] =>
  groups.flatMap(({ id, name }) => {
    const place = places?.[id];
    return place ? [{ id, name, place }] : [];
  });
// The factories not on the map yet, in the same order: what "Place factory" offers.
export const unplacedFactories = (
  groups: readonly Pick<FactoryGroup, 'id' | 'name'>[],
  places: FactoryPlaces | undefined,
): Pick<FactoryGroup, 'id' | 'name'>[] => groups.filter(({ id }) => !places?.[id]);

// "Place factory" keeps a new pin's middle at least PIN_CLEAR px on screen from every pin on the
// map (a pin is 28 px across), so it never lands on one: from the middle of the view it steps
// PLACE_STEP px on screen diagonally, down and right, then up and left, one step further each
// time, until a spot is free. At an edge of the map a step is kept on it.
export const PIN_CLEAR = 32;
export const PLACE_STEP = 36;
const PLACE_TRIES = 40;
// The first free spot for a new factory from `middle`, with `pins` (the factories and markers on
// the map, in game units) on a map drawn at `zoom`; `middle` itself when no step is free.
export function freePlace(
  middle: WorldPoint,
  pins: readonly WorldPoint[],
  zoom: number,
): WorldPoint {
  const drawn = pins.map(pin => worldToImage(pin));
  const covers = (spot: WorldPoint) => {
    const at = worldToImage(spot);
    return drawn.some(pin => Math.hypot(pin.x - at.x, pin.y - at.y) * zoom < PIN_CLEAR);
  };
  const from = worldToImage(middle);
  for (let step = 0; step <= PLACE_TRIES; step++)
    for (const sign of step ? [1, -1] : [1]) {
      const by = (sign * step * PLACE_STEP) / zoom;
      const spot = onMap(imageToWorld({ x: from.x + by, y: from.y + by }));
      if (!covers(spot)) return spot;
    }
  return onMap(middle);
}

// A factory's accessible name on the map: its name first, then what the keys do. It is a link to
// the factory's build order (its flow page), as "Build order →" on the Factories page is.
export const factoryAria = (name: string): string =>
  `${name}, factory. Enter opens its build order, the arrow keys move it, Delete takes it off the map.`;

// The toasts.
export const factoryRemovedNews = (name: string) => `Took “${name}” off the map.`;
export const factoryRestoredNews = (name: string) => `“${name}” is back on the map.`;
