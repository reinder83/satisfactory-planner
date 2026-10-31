<!--
  #map, the world map (#1283): the owner's image of the whole map (WORLD_MAP in world-map.ts, with
  its calibration to the game's world coordinates) in a box that pans and zooms as a factory's flow
  graph does (useGraphPanZoom, graph-pan-zoom.ts): the wheel zooms around the pointer, a drag on
  the map moves it, two fingers pinch, and − / + / Fit zoom around the middle. The box takes focus,
  and then the arrow keys move the map (Shift: further) and + and − zoom it. It opens fitted to the
  box, in its middle; the view is the tab's alone and never saved. The box scrolls half its size
  past each edge of the map (#1289), so a drag moves the map at any zoom, in any direction.

  Markers (slice 2): the profile's `mapMarkers` (state version 27), each an icon in its type's
  shape and its colour with its name beside it, at its spot in game units. A click on the map, or
  "Add marker" (the middle of the view, for the keyboard), opens the marker dialog
  (ui/detail/MarkerDialog.vue) for a new marker there; a press on a marker without a drag opens it
  to edit, as Enter does on a focused one. A drag moves a marker (GraphLineDrag, so the flow
  graph's drag-versus-click and pinch come along) and saves it when it ends; on a focused marker
  the arrow keys move it a few px on screen (Shift: further), saved once they rest, and Delete
  removes it, with Undo in the toast (ui/map-marker-actions.ts).

  Factories (slice 3): the profile's `factoryPlaces` (state version 28), each a round factory icon
  with the factory's name beside it, a link to the factory's build order (its flow page, as "Build
  order →" on the Factories page). "Place factory" puts the factory picked beside it in the middle
  of the view, a step aside from any pin already there (freePlace), and focuses it; a factory is
  placed at most once, so the picker offers only those not on the map. A drag or the arrow keys
  move a factory as they move a marker, and Delete takes it off the map with Undo
  (ui/map-factory-actions.ts), back where the keys last moved it. A press without a drag follows
  the link.

  Train stations and lines (#1284, slice 4): the profile's train stations with a place on the map
  (`trainStations[].place`, state version 30), each a square pin with the train icon and its name,
  the same stations the Logistics page's Trains tab lists. "Add train station" opens the station
  editor for a new station in the middle of the view; "Place station" puts the station picked beside
  it there. A press without a drag, or Enter, opens the station's editor; a drag or the arrow keys
  move it as a marker, and Delete takes it off the map (the station stays) with Undo
  (ui/train-station-actions.ts). The train lines are drawn between their placed stops in each
  line's colour: solid back and forth (⇄), dashed one-way (→), with the line's name.

  "Show on the map" hides or shows the factories, the train stations, the train lines and the
  markers for this profile (`mapLayers`).
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { save, toast } from '../../api.ts';
import { GRAPH_ZOOM, panGraphBy } from '../../graph-view.ts';
import {
  FACTORY_ICON,
  factoryAria,
  freePlace,
  placedFactories,
  unplacedFactories,
  type PlacedFactory,
} from '../../map-factories.ts';
import {
  MARKER_TYPES,
  mapLayerShown,
  markerAria,
  markerHex,
  newMarkerTarget,
  nudgedMarker,
  onMap,
} from '../../map-markers.ts';
import {
  mapLinePath,
  mapLines,
  placedStations,
  STATION_ICON,
  stationAria,
  unplacedStations,
  type PlacedStation,
} from '../../map-stations.ts';
import { flowRoute, state } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  WORLD_MAP,
  imageToWorld,
  worldToImage,
  type ImagePoint,
  type WorldPoint,
} from '../../world-map.ts';
import { MAP_MARKER_MAX, TRAIN_STATION_MAX } from '../../../state.ts';
import type { MapLayer, MapMarker } from '../../../types/index.ts';
import { legacy } from '../bridge.ts';
import { showDetail } from '../detail.ts';
import { useGraphPanZoom, type GraphLineDrag } from '../detail/graph-pan-zoom.ts';
import { focusFactory, removeFactoryPlace, saveFactoryPlace } from '../map-factory-actions.ts';
import { deleteMarker, saveMarker } from '../map-marker-actions.ts';
import { focusStation, removeStationPlace, saveStationPlace } from '../train-station-actions.ts';
import PageHeader from '../PageHeader.vue';

// How far (px on screen) an arrow key moves the map, and with Shift.
const KEY_STEP = 80;
const KEY_STEP_SHIFT = 320;
// How long after the last arrow key a moved marker or factory is saved (as the flow graph's
// nudges).
const NUDGE_SAVE_DELAY = 600;

const box = ref<HTMLElement | null>(null);
const natural = { width: WORLD_MAP.width, height: WORLD_MAP.height };

const markers = computed(() => legacy(() => state.mapMarkers ?? []));
const showMarkers = computed(() => legacy(() => mapLayerShown(state.mapLayers, 'markers')));
const groups = computed(() => legacy(() => state.factoryGroups?.groups ?? []));
const factories = computed(() => legacy(() => placedFactories(groups.value, state.factoryPlaces)));
const toPlace = computed(() => legacy(() => unplacedFactories(groups.value, state.factoryPlaces)));
const showFactories = computed(() => legacy(() => mapLayerShown(state.mapLayers, 'factories')));
const stations = computed(() => legacy(() => state.trainStations ?? []));
const lines = computed(() => legacy(() => state.trainLines ?? []));
const onMapStations = computed(() => placedStations(stations.value));
const stationsToPlace = computed(() => unplacedStations(stations.value));
const showStations = computed(() => legacy(() => mapLayerShown(state.mapLayers, 'stations')));
const showLines = computed(() => legacy(() => mapLayerShown(state.mapLayers, 'trainLines')));

// What can be dragged and nudged, by its node id for the pan and zoom (`data-node`): a marker
// ('marker:<id>'), a factory ('factory:<group id>') or a train station ('station:<id>').
const MARKER = 'marker:';
const FACTORY = 'factory:';
const STATION = 'station:';
const stationOf = (node: string) =>
  node.startsWith(STATION)
    ? onMapStations.value.find(placed => placed.station.id === node.slice(STATION.length))
    : undefined;
const markerOf = (node: string) =>
  node.startsWith(MARKER) ? markers.value.find(m => m.id === node.slice(MARKER.length)) : undefined;
const factoryOf = (node: string) =>
  node.startsWith(FACTORY)
    ? factories.value.find(f => f.id === node.slice(FACTORY.length))
    : undefined;
// Spots a drag or an arrow key gave a marker or a factory that are not saved yet, in game units,
// by node id: drawn instead of the saved spot until the save is back.
const moved = reactive<Record<string, WorldPoint>>({});
const markerSpot = (marker: MapMarker): WorldPoint => moved[MARKER + marker.id] ?? marker;
const factorySpot = (factory: PlacedFactory): WorldPoint =>
  moved[FACTORY + factory.id] ?? factory.place;
const stationSpot = (placed: PlacedStation): WorldPoint =>
  moved[STATION + placed.station.id] ?? placed.place;
// The saved spot of node `node`, or null for one that is gone.
function savedSpot(node: string): WorldPoint | null {
  const marker = markerOf(node);
  if (marker) return { x: marker.x, y: marker.y };
  return factoryOf(node)?.place ?? stationOf(node)?.place ?? null;
}
// A drag works in whole image px (useGraphPanZoom rounds), so it starts from the spot rounded to
// the image and moves the exact spot by as many px: a drag straight across keeps y exactly.
const dragFrom = new Map<string, { image: ImagePoint; world: WorldPoint }>();
const drag: GraphLineDrag = {
  at(node) {
    const marker = markerOf(node);
    const factory = marker ? undefined : factoryOf(node);
    const station = marker || factory ? undefined : stationOf(node);
    const world = marker
      ? markerSpot(marker)
      : factory
        ? factorySpot(factory)
        : station
          ? stationSpot(station)
          : null;
    if (!world) return null;
    const exact = worldToImage(world);
    const image = { x: Math.round(exact.x), y: Math.round(exact.y) };
    dragFrom.set(node, { image, world });
    return image;
  },
  move(node, to) {
    const from = dragFrom.get(node);
    if (!from || !savedSpot(node)) return;
    const now = imageToWorld(to),
      start = imageToWorld(from.image);
    moved[node] = onMap({
      x: from.world.x + now.x - start.x,
      y: from.world.y + now.y - start.y,
    });
  },
  drop(node) {
    void saveSpot(node);
  },
};
// Room to drag the map past its edges (#1289): half the box on each side, so a drag moves the map
// at any zoom, also while it is narrower or lower than the box, and any spot of it can come to the
// middle of the box. The box then scrolls from the map's left edge in its middle (scrollLeft 0)
// to its right edge there (scrollLeft the drawn width): scrollLeft is the spot in the middle, so a
// box that changes size keeps it. Measured on opening and whenever the box changes size.
const boxSize = ref({ width: 0, height: 0 });
const room = computed(() => ({ width: boxSize.value.width / 2, height: boxSize.value.height / 2 }));
const measure = () => {
  const el = box.value;
  if (el && (el.clientWidth !== boxSize.value.width || el.clientHeight !== boxSize.value.height))
    boxSize.value = { width: el.clientWidth, height: el.clientHeight };
};
let resized: ResizeObserver | undefined;
const { zoom, panning, moving, show, zoomIn, zoomOut, fit, handlers, onClickCapture } =
  useGraphPanZoom(
    box,
    () => natural,
    drag,
    () => room.value,
  );
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);

// A mouse press on the map itself (not on a marker) starts no text selection and no native drag
// of the image or a selection, which took the pointer from the pan (#1289); the map still takes
// focus, as the press would have given it.
const mapHandlers = {
  ...handlers,
  pointerdown(e: PointerEvent) {
    const el = box.value;
    const target = e.target instanceof Element ? e.target : null;
    if (el && e.pointerType === 'mouse' && !target?.closest('[data-node], button, a, input')) {
      e.preventDefault();
      el.focus({ preventScroll: true });
    }
    handlers.pointerdown(e);
  },
  dragstart: (e: DragEvent) => e.preventDefault(),
};

onMounted(async () => {
  await nextTick();
  measure();
  if (typeof ResizeObserver === 'function' && box.value) {
    resized = new ResizeObserver(measure);
    resized.observe(box.value);
  }
  await nextTick();
  await fit();
});
onBeforeUnmount(() => resized?.disconnect());

// Each marker as drawn: where its pin's middle is on the drawn map (px), its colour and icon.
const drawn = computed(() =>
  markers.value.map(marker => {
    const at = worldToImage(markerSpot(marker));
    return {
      marker,
      left: at.x * zoom.value,
      top: at.y * zoom.value,
      hex: markerHex(marker),
      icon: MARKER_TYPES[marker.type].icon,
      aria: markerAria(marker),
    };
  }),
);
// Each factory as drawn: where its pin's middle is, its link and its name for screen readers.
const drawnFactories = computed(() =>
  factories.value.map(factory => {
    const at = worldToImage(factorySpot(factory));
    return {
      factory,
      left: at.x * zoom.value,
      top: at.y * zoom.value,
      href: '#' + flowRoute(factory.id),
      aria: factoryAria(factory.name),
    };
  }),
);

// Each placed station as drawn, and the train lines between them (solid back and forth, dashed
// one-way), in px on the drawn map.
const drawnStations = computed(() =>
  onMapStations.value.map(placed => {
    const at = worldToImage(stationSpot(placed));
    return {
      station: placed.station,
      left: at.x * zoom.value,
      top: at.y * zoom.value,
      aria: stationAria(placed.station, lines.value),
    };
  }),
);
const drawnLines = computed(() =>
  mapLines(lines.value, stations.value, station => {
    const placed = onMapStations.value.find(entry => entry.station.id === station.id);
    return placed ? stationSpot(placed) : undefined;
  }).map(line => ({
    ...line,
    d: mapLinePath(line, zoom.value),
    labelX: line.label.x * zoom.value,
    labelY: line.label.y * zoom.value - 8,
  })),
);

// Saving a moved marker or factory: at once when a drag ends or it loses focus, NUDGE_SAVE_DELAY
// after the last arrow key, and before the page goes; only when it moved.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
async function saveSpot(node: string) {
  clearTimeout(timers.get(node));
  timers.delete(node);
  const spot = moved[node];
  if (!spot) return;
  const saved = savedSpot(node);
  if (!saved || (saved.x === spot.x && saved.y === spot.y)) {
    delete moved[node];
    return;
  }
  const marker = markerOf(node);
  if (marker) await saveMarker({ ...marker, x: spot.x, y: spot.y });
  else if (node.startsWith(STATION)) await saveStationPlace(node.slice(STATION.length), spot);
  else await saveFactoryPlace(node.slice(FACTORY.length), spot);
  // A later move made meanwhile stays to be saved.
  if (moved[node] === spot) delete moved[node];
}
const saveLater = (node: string) => {
  clearTimeout(timers.get(node));
  timers.set(
    node,
    setTimeout(() => void saveSpot(node), NUDGE_SAVE_DELAY),
  );
};
onBeforeUnmount(() => {
  for (const node of [...timers.keys()]) void saveSpot(node);
});

// The spot in game units under client point (x, y), kept on the map: the point in the box, plus
// how far it is scrolled, less the room before the map.
function spotAt(x: number, y: number): WorldPoint | null {
  const el = box.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return onMap(
    imageToWorld({
      x: (x - rect.left - el.clientLeft + el.scrollLeft - room.value.width) / zoom.value,
      y: (y - rect.top - el.clientTop + el.scrollTop - room.value.height) / zoom.value,
    }),
  );
}
// The middle of the map's view, in game units.
function middleSpot(): WorldPoint | null {
  const el = box.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return spotAt(
    rect.left + el.clientLeft + el.clientWidth / 2,
    rect.top + el.clientTop + el.clientHeight / 2,
  );
}
// The marker dialog for a new marker at `spot`, while the map has room for one.
function placeAt(spot: WorldPoint | null) {
  if (!spot) return;
  if (markers.value.length >= MAP_MARKER_MAX) {
    toast(`The map holds at most ${MAP_MARKER_MAX} markers. Delete one to place another.`, true);
    return;
  }
  showDetail({ kind: 'marker', id: newMarkerTarget(spot) });
}
// A click on the map (not on a marker or a factory, and not the end of a drag, which
// onClickCapture swallows) places a marker there while the markers are shown.
function onMapClick(e: MouseEvent) {
  if (!showMarkers.value || (e.target as Element).closest('[data-node]')) return;
  placeAt(spotAt(e.clientX, e.clientY));
}
// "Add marker": in the middle of the map's view.
const addInMiddle = () => placeAt(middleSpot());
const edit = (id: string) => showDetail({ kind: 'marker', id });

// "Place factory": the factory picked beside it (the first one not on the map until another is
// picked) goes in the middle of the map's view, or a step aside from it as far as a pin already
// covers the middle (freePlace), and focus goes to it there.
const picked = ref('');
const pickedFactory = computed(
  () => toPlace.value.find(group => group.id === picked.value) ?? toPlace.value[0],
);
async function placeFactory() {
  const factory = pickedFactory.value;
  const middle = middleSpot();
  if (!factory || !middle) return;
  const pins = [
    ...factories.value.map(factory => factorySpot(factory)),
    ...markers.value.map(marker => markerSpot(marker)),
  ];
  const spot = freePlace(middle, pins, zoom.value);
  if (await saveFactoryPlace(factory.id, spot)) await focusFactory(factory.id);
}

// The pins already on the map, in game units, which a new one keeps clear of (freePlace).
const pinSpots = () => [
  ...factories.value.map(factory => factorySpot(factory)),
  ...markers.value.map(marker => markerSpot(marker)),
  ...onMapStations.value.map(placed => stationSpot(placed)),
];
// "Add train station": the station editor for a new station in the middle of the view (a step
// aside from any pin there), placed there when it is added.
function addStation() {
  const middle = middleSpot();
  if (!middle) return;
  if (stations.value.length >= TRAIN_STATION_MAX) {
    toast(
      `A profile holds at most ${TRAIN_STATION_MAX} train stations. Delete one to add another.`,
      true,
    );
    return;
  }
  const spot = freePlace(middle, pinSpots(), zoom.value);
  showDetail({ kind: 'station', id: `new:${spot.x}:${spot.y}` });
}
// "Place station": the station picked beside it (the first one not on the map until another is
// picked) goes in the middle of the view, and focus goes to it there.
const pickedStationId = ref('');
const pickedStation = computed(
  () =>
    stationsToPlace.value.find(station => station.id === pickedStationId.value) ??
    stationsToPlace.value[0],
);
async function placeStation() {
  const station = pickedStation.value;
  const middle = middleSpot();
  if (!station || !middle) return;
  const spot = freePlace(middle, pinSpots(), zoom.value);
  if (await saveStationPlace(station.id, spot)) await focusStation(station.id);
}
const editStation = (id: string) => showDetail({ kind: 'station', id });

// Brings what is drawn at (left, top) on the map (px) into view inside the box, as far as it is
// out of it.
async function keepInView(find: () => { left: number; top: number } | undefined) {
  await nextTick();
  const el = box.value;
  const shown = find();
  if (!el || !shown) return;
  const margin = 48;
  const into = (at: number, offset: number, visible: number) =>
    at - margin < offset
      ? at - margin
      : at + margin > offset + visible
        ? at + margin - visible
        : offset;
  el.scrollLeft = into(room.value.width + shown.left, el.scrollLeft, el.clientWidth);
  el.scrollTop = into(room.value.height + shown.top, el.scrollTop, el.clientHeight);
}
// The arrow keys on a focused marker or factory (node `node`, now at `spot`) move it (Shift:
// further), saved once they rest. Returns whether the key was one of them.
function nudge(e: KeyboardEvent, node: string, spot: WorldPoint): boolean {
  const to = nudgedMarker(spot, e.key, e.shiftKey, zoom.value);
  if (!to) return false;
  e.preventDefault();
  moved[node] = to;
  saveLater(node);
  return true;
}
// Ctrl, ⌘ and Alt with a key are the browser's.
const browserKey = (e: KeyboardEvent) => e.ctrlKey || e.metaKey || e.altKey;
const removeKey = (e: KeyboardEvent) => e.key === 'Delete' || e.key === 'Backspace';
// On a focused marker: an arrow key moves it, Delete or Backspace removes it. Enter and Space
// press the button, which opens it.
function onMarkerKey(e: KeyboardEvent, marker: MapMarker) {
  if (browserKey(e)) return;
  if (removeKey(e)) {
    e.preventDefault();
    void removeMarker(marker.id);
  } else if (nudge(e, MARKER + marker.id, markerSpot(marker)))
    void keepInView(() => drawn.value.find(item => item.marker.id === marker.id));
}
// On a focused factory: an arrow key moves it, Delete or Backspace takes it off the map. Enter
// follows the link to its build order.
function onFactoryKey(e: KeyboardEvent, factory: PlacedFactory) {
  if (browserKey(e)) return;
  if (removeKey(e)) {
    e.preventDefault();
    void takeOff(factory.id);
  } else if (nudge(e, FACTORY + factory.id, factorySpot(factory)))
    void keepInView(() => drawnFactories.value.find(item => item.factory.id === factory.id));
}
// On a focused station: an arrow key moves it, Delete or Backspace takes it off the map. Enter and
// Space press the button, which opens its editor.
function onStationKey(e: KeyboardEvent, id: string) {
  if (browserKey(e)) return;
  const placed = onMapStations.value.find(entry => entry.station.id === id);
  if (!placed) return;
  if (removeKey(e)) {
    e.preventDefault();
    void takeOffStation(id);
  } else if (nudge(e, STATION + id, stationSpot(placed)))
    void keepInView(() => drawnStations.value.find(item => item.station.id === id));
}
// Forgets an unsaved move of node `node`, which is going, and returns that spot: Undo puts the
// marker or factory back there, so a move the arrow keys made just before Delete is not lost.
function forget(node: string): WorldPoint | undefined {
  clearTimeout(timers.get(node));
  timers.delete(node);
  const spot = moved[node];
  delete moved[node];
  return spot;
}
// Delete on a focused marker or factory: focus goes to the map, where a second Delete removes
// nothing.
async function removeMarker(id: string) {
  if (await deleteMarker(id, forget(MARKER + id))) box.value?.focus();
}
async function takeOff(id: string) {
  if (await removeFactoryPlace(id, forget(FACTORY + id))) box.value?.focus();
}
async function takeOffStation(id: string) {
  if (await removeStationPlace(id, forget(STATION + id))) box.value?.focus();
}

// "Show on the map": a layer's switch, saved for this profile at once.
async function toggleLayer(e: Event, layer: MapLayer) {
  const input = e.currentTarget as HTMLInputElement;
  try {
    await save({ type: 'mapLayer', layer, value: input.checked });
  } catch {
    // Refused (save() said why): the box shows what is saved again.
    input.checked = mapLayerShown(state.mapLayers, layer);
  }
  render();
}

const ARROWS: Record<string, [x: number, y: number]> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};
// The arrow keys move the focused map, + and − zoom it. Only on the box itself, so a focused
// marker or factory keeps its own keys; Ctrl, ⌘ and Alt are the browser's (Ctrl + zooms the page).
function onKey(e: KeyboardEvent) {
  const el = box.value;
  if (!el || e.target !== el || browserKey(e)) return;
  const arrow = ARROWS[e.key];
  if (arrow) {
    e.preventDefault();
    const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
    const area = { width: el.clientWidth, height: el.clientHeight };
    const view = { zoom: zoom.value, left: el.scrollLeft, top: el.scrollTop };
    void show(panGraphBy(view, arrow[0] * step, arrow[1] * step, area, natural, room.value));
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    void zoomIn();
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    void zoomOut();
  }
}
</script>

<template>
  <PageHeader
    eyebrow="YOUR WORLD"
    title="World map"
    subtitle="The whole map of the game, north up."
  />
  <section class="panel world-map">
    <p class="small muted">
      Drag the map to move it, zoom with the mouse wheel, a pinch or the buttons. Once the map has
      focus, the arrow keys move it (Shift: further) and + and − zoom it.
      <template v-if="showFactories && toPlace.length">
        Place factory puts the factory picked beside it in the middle of the view.
      </template>
      <template v-if="showFactories && factories.length">
        Press a factory to open its build order, or drag it to move it; on a focused factory the
        arrow keys move it, Enter opens it and Delete takes it off the map.
      </template>
      <template v-else-if="!showFactories && factories.length">The factories are hidden.</template>
      <template v-if="showMarkers">
        Click the map to place a marker there, or press Add marker. Drag a marker to move it; on a
        focused marker the arrow keys move it, Enter edits it and Delete removes it.
      </template>
      <template v-else-if="markers.length">The markers are hidden.</template>
      <template v-if="showStations">
        Add train station opens the station editor for a new station in the middle of the view.
        Press a station to edit it, or drag it to move it; on a focused station the arrow keys move
        it, Enter edits it and Delete takes it off the map.
      </template>
      <template v-else-if="onMapStations.length">The train stations are hidden.</template>
      <template v-if="showLines && drawnLines.length">
        Train lines run between their stations: solid back and forth, dashed one-way.
      </template>
    </p>
    <div class="map-bar">
      <div class="fgraph-tools" data-map-tools>
        <button
          class="btn"
          type="button"
          aria-label="Zoom out"
          data-map-zoom="out"
          :disabled="zoom <= GRAPH_ZOOM.min"
          @click="zoomOut"
        >
          −
        </button>
        <span class="fgraph-zoom" data-map-zoom-level>{{ zoomText }}</span>
        <button
          class="btn"
          type="button"
          aria-label="Zoom in"
          data-map-zoom="in"
          :disabled="zoom >= GRAPH_ZOOM.max"
          @click="zoomIn"
        >
          +
        </button>
        <button
          class="btn"
          type="button"
          aria-label="Fit the whole map"
          data-map-zoom="fit"
          @click="fit"
        >
          Fit
        </button>
        <button
          v-if="showMarkers"
          class="btn"
          type="button"
          data-map-add-marker
          @click="addInMiddle"
        >
          + Add marker
        </button>
        <span v-if="showFactories && pickedFactory" class="map-place" data-map-place
          ><select
            :value="pickedFactory.id"
            aria-label="Factory to place on the map"
            data-map-place-select
            @change="picked = ($event.target as HTMLSelectElement).value"
          >
            <option v-for="group in toPlace" :key="group.id" :value="group.id">
              {{ group.name }}
            </option></select
          ><button class="btn" type="button" data-map-place-factory @click="placeFactory">
            + Place factory
          </button></span
        >
        <button
          v-if="showStations"
          class="btn"
          type="button"
          data-map-add-station
          @click="addStation"
        >
          + Add train station
        </button>
        <span v-if="showStations && pickedStation" class="map-place" data-map-station-place
          ><select
            :value="pickedStation.id"
            aria-label="Train station to place on the map"
            data-map-station-select
            @change="pickedStationId = ($event.target as HTMLSelectElement).value"
          >
            <option v-for="station in stationsToPlace" :key="station.id" :value="station.id">
              {{ station.name }}
            </option></select
          ><button class="btn" type="button" data-map-place-station @click="placeStation">
            + Place station
          </button></span
        >
      </div>
      <fieldset class="map-layers" data-map-layers>
        <legend>Show on the map</legend>
        <label class="map-layer-toggle"
          ><input
            type="checkbox"
            :checked="showFactories"
            data-map-layer-toggle="factories"
            @change="toggleLayer($event, 'factories')"
          />
          Factories
          <span class="muted" data-map-factory-count>({{ factories.length }})</span></label
        >
        <label class="map-layer-toggle"
          ><input
            type="checkbox"
            :checked="showMarkers"
            data-map-layer-toggle="markers"
            @change="toggleLayer($event, 'markers')"
          />
          Markers <span class="muted" data-map-marker-count>({{ markers.length }})</span></label
        >
        <label class="map-layer-toggle"
          ><input
            type="checkbox"
            :checked="showStations"
            data-map-layer-toggle="stations"
            @change="toggleLayer($event, 'stations')"
          />
          Train stations
          <span class="muted" data-map-station-count>({{ onMapStations.length }})</span></label
        >
        <label class="map-layer-toggle"
          ><input
            type="checkbox"
            :checked="showLines"
            data-map-layer-toggle="trainLines"
            @change="toggleLayer($event, 'trainLines')"
          />
          Train lines
          <span class="muted" data-map-line-count>({{ drawnLines.length }})</span></label
        >
      </fieldset>
    </div>
    <div
      ref="box"
      :class="['map-scroll', { panning, moving }]"
      tabindex="0"
      role="group"
      aria-label="World map. The arrow keys move it, + and − zoom it."
      data-world-map
      v-on="mapHandlers"
      @click.capture="onClickCapture"
      @keydown="onKey"
    >
      <div
        class="map-room"
        :style="{
          width: natural.width * zoom + 2 * room.width + 'px',
          height: natural.height * zoom + 2 * room.height + 'px',
        }"
        data-map-room
      ></div>
      <div
        class="map-layer"
        :style="{
          left: room.width + 'px',
          top: room.height + 'px',
          width: natural.width * zoom + 'px',
          height: natural.height * zoom + 'px',
        }"
        data-map-layer
        @click="onMapClick"
      >
        <img
          class="map-image"
          :src="WORLD_MAP.src"
          :width="natural.width"
          :height="natural.height"
          alt="The Satisfactory world map, north up"
          draggable="false"
          data-map-image
        />
        <svg
          v-if="showLines && drawnLines.length"
          class="map-lines"
          :width="natural.width * zoom"
          :height="natural.height * zoom"
          aria-hidden="true"
          data-map-lines
        >
          <g
            v-for="line in drawnLines"
            :key="line.id"
            :class="['map-line', 'line-color-' + line.color, { dashed: line.dashed }]"
            :data-map-line="line.id"
          >
            <path class="map-line-shadow" :d="line.d" />
            <path class="map-line-path" :d="line.d" />
            <text class="map-line-label" :x="line.labelX" :y="line.labelY" text-anchor="middle">
              {{ line.label.text }}
            </text>
          </g>
        </svg>
        <template v-if="showFactories">
          <a
            v-for="item in drawnFactories"
            :key="item.factory.id"
            class="map-factory"
            :href="item.href"
            draggable="false"
            :style="{ left: item.left + 'px', top: item.top + 'px' }"
            :data-node="'factory:' + item.factory.id"
            :data-map-factory="item.factory.id"
            :aria-label="item.aria"
            @keydown="onFactoryKey($event, item.factory)"
            @blur="saveSpot('factory:' + item.factory.id)"
          >
            <span class="map-factory-pin" aria-hidden="true"
              ><svg viewBox="0 0 20 20"><path :d="FACTORY_ICON" fill-rule="evenodd" /></svg
            ></span>
            <span class="map-factory-label" aria-hidden="true">{{ item.factory.name }}</span>
          </a>
        </template>
        <template v-if="showStations">
          <button
            v-for="item in drawnStations"
            :key="item.station.id"
            type="button"
            class="map-station"
            :style="{ left: item.left + 'px', top: item.top + 'px' }"
            :data-node="'station:' + item.station.id"
            :data-map-station="item.station.id"
            :aria-label="item.aria"
            @click="editStation(item.station.id)"
            @keydown="onStationKey($event, item.station.id)"
            @blur="saveSpot('station:' + item.station.id)"
          >
            <span class="map-station-pin" aria-hidden="true"
              ><svg viewBox="0 0 20 20"><path :d="STATION_ICON" fill-rule="evenodd" /></svg
            ></span>
            <span class="map-station-label" aria-hidden="true">{{ item.station.name }}</span>
          </button>
        </template>
        <template v-if="showMarkers">
          <button
            v-for="item in drawn"
            :key="item.marker.id"
            type="button"
            class="map-marker"
            :style="{ left: item.left + 'px', top: item.top + 'px', '--marker': item.hex }"
            :data-node="'marker:' + item.marker.id"
            :data-map-marker="item.marker.id"
            :data-marker-kind="item.marker.type"
            :aria-label="item.aria"
            @click="edit(item.marker.id)"
            @keydown="onMarkerKey($event, item.marker)"
            @blur="saveSpot('marker:' + item.marker.id)"
          >
            <span class="map-marker-pin" aria-hidden="true"
              ><svg viewBox="0 0 20 20"><path :d="item.icon" /></svg
            ></span>
            <span class="map-marker-label" aria-hidden="true">{{ item.marker.name }}</span>
          </button>
        </template>
      </div>
    </div>
    <p class="small muted map-credit" data-map-attribution>Map: © Coffee Stain Studios</p>
  </section>
</template>
