// Markers on the world map (#1283, slice 2 of 3): the words, icons and colours of a marker's type,
// the palette a marker may pick from, where a key press moves a marker, and the toasts. The saved
// shape and its limits are in state/validate.ts (validateMapMarkers: `mapMarkers`, state version
// 27); a marker's spot is in the game's world units, which world-map.ts converts to the image.
import type {
  MapLayer,
  MapLayers,
  MapMarker,
  MapMarkerColor,
  MapMarkerType,
} from '../types/index.ts';
import { WORLD_MAP, imageToWorld, worldToImage, type WorldPoint } from './world-map.ts';

// Each type's name, its own colour (used while the marker picks none) and its icon: an SVG path in
// a 20 × 20 box, drawn in the marker's dark ink on its colour.
export const MARKER_TYPES: Record<
  MapMarkerType,
  { label: string; color: MapMarkerColor; icon: string }
> = {
  resource: { label: 'Resource node', color: 'orange', icon: 'M10 2 17 9 10 18 3 9Z' },
  landmark: { label: 'Landmark', color: 'blue', icon: 'M5 2h2v16H5ZM7 3h9l-2.5 3.5L16 10H7Z' },
  note: {
    label: 'Note',
    color: 'yellow',
    icon: 'M3 3h14v10H9l-4 4v-4H3ZM6 6v1.6h8V6Zm0 3v1.6h6V9Z',
  },
};
// The palette, each colour light enough for the dark icon on it and for the map behind it.
export const MARKER_COLORS: Record<MapMarkerColor, { label: string; hex: string }> = {
  orange: { label: 'Orange', hex: '#f89c1c' },
  yellow: { label: 'Yellow', hex: '#f5d547' },
  green: { label: 'Green', hex: '#6ee7a8' },
  blue: { label: 'Blue', hex: '#7cc4ff' },
  purple: { label: 'Purple', hex: '#c9a7ff' },
  red: { label: 'Red', hex: '#ff8a73' },
};
// The colour a marker is drawn in: its own, else its type's.
export const markerHex = (marker: Pick<MapMarker, 'type' | 'color'>): string =>
  MARKER_COLORS[marker.color ?? MARKER_TYPES[marker.type].color].hex;

// A marker's accessible name: its name and type first, then what the keys do.
export const markerAria = (marker: Pick<MapMarker, 'name' | 'type'>): string =>
  `${marker.name}, ${MARKER_TYPES[marker.type].label}. Enter edits it, the arrow keys move it, Delete removes it.`;

// Whether the profile shows `layer` of the map: every layer is shown unless it was hidden.
export const mapLayerShown = (layers: MapLayers | undefined, layer: MapLayer): boolean =>
  layers?.[layer] !== false;

// A new marker's id: 'mk-' and ten base-36 characters (mapMarkerId in state/validate.ts).
export function newMarkerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return 'mk-' + [...bytes].map(byte => (byte % 36).toString(36)).join('');
}
// The name a new marker starts with, "Marker 4", one no marker has yet.
export function newMarkerName(markers: Pick<MapMarker, 'name'>[]): string {
  const taken = new Set(markers.map(marker => marker.name));
  let number = markers.length + 1;
  while (taken.has(`Marker ${number}`)) number++;
  return `Marker ${number}`;
}

// A world point kept on the map, in whole game units.
export function onMap(point: WorldPoint): WorldPoint {
  const { west, east, north, south } = WORLD_MAP.bounds;
  const within = (value: number, low: number, high: number) =>
    Math.round(Math.min(Math.max(value, low), high)) || 0;
  return { x: within(point.x, west, east), y: within(point.y, north, south) };
}

// How far an arrow key moves a focused marker, in px on screen, and with Shift: the same distance
// on screen at every zoom, so a step is always visible and never jumps across the map.
export const MARKER_NUDGE = 8;
export const MARKER_NUDGE_SHIFT = 40;
const NUDGES: Record<string, [x: number, y: number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
// Where an arrow key `key` moves a marker at `point` on a map drawn at `zoom`, kept on the map; null
// for any other key.
export function nudgedMarker(
  point: WorldPoint,
  key: string,
  shift: boolean,
  zoom: number,
): WorldPoint | null {
  const direction = NUDGES[key];
  if (!direction) return null;
  const step = (shift ? MARKER_NUDGE_SHIFT : MARKER_NUDGE) / zoom;
  const at = worldToImage(point);
  return onMap(imageToWorld({ x: at.x + direction[0] * step, y: at.y + direction[1] * step }));
}

// A marker's spot as the dialog says it, in game units: "x −120,500, y 48,250".
const units = (value: number) => value.toLocaleString('en-US').replace('-', '−');
export const markerSpotText = (point: WorldPoint): string =>
  `x ${units(point.x)}, y ${units(point.y)}`;

// The marker dialog's target (#detail, kind 'marker'): a marker's id, or a new marker's spot.
export const newMarkerTarget = (point: WorldPoint): string => `new:${point.x}:${point.y}`;
export function markerTarget(id: string): { id: string } | { spot: WorldPoint } {
  const match = /^new:(-?\d+):(-?\d+)$/.exec(id);
  return match ? { spot: onMap({ x: Number(match[1]), y: Number(match[2]) }) } : { id };
}

// The toasts.
export const markerDeletedNews = (name: string) => `Deleted marker “${name}”.`;
export const markerRestoredNews = (name: string) => `Marker “${name}” is back on the map.`;
