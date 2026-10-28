<!--
  #map, the world map (#1283): the owner's image of the whole map (WORLD_MAP in world-map.ts, with
  its calibration to the game's world coordinates) in a box that pans and zooms as a factory's flow
  graph does (useGraphPanZoom, graph-pan-zoom.ts): the wheel zooms around the pointer, a drag on
  the map moves it, two fingers pinch, and − / + / Fit zoom around the middle. The box takes focus,
  and then the arrow keys move the map (Shift: further) and + and − zoom it. It opens fitted to the
  box; the view is the tab's alone and never saved.

  Markers (slice 2): the profile's `mapMarkers` (state version 27), each an icon in its type's
  shape and its colour with its name beside it, at its spot in game units. A click on the map, or
  "Add marker" (the middle of the view, for the keyboard), opens the marker dialog
  (ui/detail/MarkerDialog.vue) for a new marker there; a press on a marker without a drag opens it
  to edit, as Enter does on a focused one. A drag moves a marker (GraphLineDrag, so the flow
  graph's drag-versus-click and pinch come along) and saves it when it ends; on a focused marker
  the arrow keys move it a few px on screen (Shift: further), saved once they rest, and Delete
  removes it, with Undo in the toast (ui/map-marker-actions.ts). "Show on the map" hides or shows
  the markers for this profile (`mapLayers`). The layers of later slices (factories, #1283 slice
  3; train stations and lines, #1284) get their switches with their content.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { save, toast } from '../../api.ts';
import { GRAPH_ZOOM, panGraphBy } from '../../graph-view.ts';
import {
  MARKER_TYPES,
  mapLayerShown,
  markerAria,
  markerHex,
  newMarkerTarget,
  nudgedMarker,
  onMap,
} from '../../map-markers.ts';
import { state } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  WORLD_MAP,
  imageToWorld,
  worldToImage,
  type ImagePoint,
  type WorldPoint,
} from '../../world-map.ts';
import { MAP_MARKER_MAX } from '../../../state.ts';
import type { MapMarker } from '../../../types/index.ts';
import { legacy } from '../bridge.ts';
import { showDetail } from '../detail.ts';
import { useGraphPanZoom, type GraphLineDrag } from '../detail/graph-pan-zoom.ts';
import { deleteMarker, saveMarker } from '../map-marker-actions.ts';
import PageHeader from '../PageHeader.vue';

// How far (px on screen) an arrow key moves the map, and with Shift.
const KEY_STEP = 80;
const KEY_STEP_SHIFT = 320;
// How long after the last arrow key a moved marker is saved (as the flow graph's nudges).
const NUDGE_SAVE_DELAY = 600;

const box = ref<HTMLElement | null>(null);
const natural = { width: WORLD_MAP.width, height: WORLD_MAP.height };

const markers = computed(() => legacy(() => state.mapMarkers ?? []));
const showMarkers = computed(() => legacy(() => mapLayerShown(state.mapLayers, 'markers')));
// Spots a drag or an arrow key gave a marker that are not saved yet, in game units, by marker id:
// drawn instead of the saved spot until the save is back.
const moved = reactive<Record<string, WorldPoint>>({});
const spotOf = (marker: MapMarker): WorldPoint => moved[marker.id] ?? marker;

// A marker's node id for the pan and zoom (`data-node`), and the marker it names.
const NODE = 'marker:';
const markerOf = (node: string) =>
  node.startsWith(NODE) ? markers.value.find(m => m.id === node.slice(NODE.length)) : undefined;
// A drag works in whole image px (useGraphPanZoom rounds), so it starts from the marker's spot
// rounded to the image and moves the exact spot by as many px: a drag straight across keeps the
// marker's y exactly.
const dragFrom = new Map<string, { image: ImagePoint; world: WorldPoint }>();
const drag: GraphLineDrag = {
  at(node) {
    const marker = markerOf(node);
    if (!marker) return null;
    const world = spotOf(marker);
    const exact = worldToImage(world);
    const image = { x: Math.round(exact.x), y: Math.round(exact.y) };
    dragFrom.set(node, { image, world });
    return image;
  },
  move(node, to) {
    const marker = markerOf(node);
    const from = dragFrom.get(node);
    if (!marker || !from) return;
    const now = imageToWorld(to),
      start = imageToWorld(from.image);
    moved[marker.id] = onMap({
      x: from.world.x + now.x - start.x,
      y: from.world.y + now.y - start.y,
    });
  },
  drop(node) {
    const marker = markerOf(node);
    if (marker) void saveSpot(marker.id);
  },
};
const { zoom, panning, moving, show, zoomIn, zoomOut, fit, handlers, onClickCapture } =
  useGraphPanZoom(box, () => natural, drag);
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);

onMounted(async () => {
  await nextTick();
  await fit();
});

// Each marker as drawn: where its pin's middle is on the drawn map (px), its colour and icon.
const drawn = computed(() =>
  markers.value.map(marker => {
    const at = worldToImage(spotOf(marker));
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

// Saving a moved marker: at once when a drag ends or it loses focus, NUDGE_SAVE_DELAY after the
// last arrow key, and before the page goes; only when it moved.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
async function saveSpot(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const spot = moved[id];
  if (!spot) return;
  const marker = state.mapMarkers?.find(entry => entry.id === id);
  if (!marker || (marker.x === spot.x && marker.y === spot.y)) {
    delete moved[id];
    return;
  }
  await saveMarker({ ...marker, x: spot.x, y: spot.y });
  // A later move made meanwhile stays to be saved.
  if (moved[id] === spot) delete moved[id];
}
const saveLater = (id: string) => {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => void saveSpot(id), NUDGE_SAVE_DELAY),
  );
};
onBeforeUnmount(() => {
  for (const id of [...timers.keys()]) void saveSpot(id);
});

// The spot in game units under client point (x, y), kept on the map.
function spotAt(x: number, y: number): WorldPoint | null {
  const layer = box.value?.querySelector('[data-map-layer]');
  if (!layer) return null;
  const rect = layer.getBoundingClientRect();
  return onMap(imageToWorld({ x: (x - rect.left) / zoom.value, y: (y - rect.top) / zoom.value }));
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
// A click on the map (not on a marker, and not the end of a drag, which onClickCapture swallows)
// places a marker there while the markers are shown.
function onMapClick(e: MouseEvent) {
  if (!showMarkers.value || (e.target as Element).closest('[data-node]')) return;
  placeAt(spotAt(e.clientX, e.clientY));
}
// "Add marker": in the middle of the map's view.
function addInMiddle() {
  const el = box.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  placeAt(
    spotAt(
      rect.left + el.clientLeft + el.clientWidth / 2,
      rect.top + el.clientTop + el.clientHeight / 2,
    ),
  );
}
const edit = (id: string) => showDetail({ kind: 'marker', id });

// Brings marker `id` into view inside the box, as far as it is out of it.
async function keepInView(id: string) {
  await nextTick();
  const el = box.value;
  const shown = drawn.value.find(item => item.marker.id === id);
  if (!el || !shown) return;
  const margin = 48;
  const into = (at: number, offset: number, visible: number) =>
    at - margin < offset
      ? at - margin
      : at + margin > offset + visible
        ? at + margin - visible
        : offset;
  el.scrollLeft = into(shown.left, el.scrollLeft, el.clientWidth);
  el.scrollTop = into(shown.top, el.scrollTop, el.clientHeight);
}
// On a focused marker: an arrow key moves it (Shift: further), Delete or Backspace removes it.
// Enter and Space press the button, which opens it. Ctrl, ⌘ and Alt are the browser's.
function onMarkerKey(e: KeyboardEvent, marker: MapMarker) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    void removeMarker(marker.id);
    return;
  }
  const to = nudgedMarker(spotOf(marker), e.key, e.shiftKey, zoom.value);
  if (!to) return;
  e.preventDefault();
  moved[marker.id] = to;
  saveLater(marker.id);
  void keepInView(marker.id);
}
// Delete on a focused marker: focus goes to the map, where a second Delete removes nothing.
async function removeMarker(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  delete moved[id];
  if (await deleteMarker(id)) box.value?.focus();
}

// "Show on the map": the markers' switch, saved for this profile at once.
async function toggleMarkers(e: Event) {
  const input = e.currentTarget as HTMLInputElement;
  try {
    await save({ type: 'mapLayer', layer: 'markers', value: input.checked });
  } catch {
    // Refused (save() said why): the box shows what is saved again.
    input.checked = showMarkers.value;
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
// marker keeps its own keys; Ctrl, ⌘ and Alt are the browser's (Ctrl + zooms the page).
function onKey(e: KeyboardEvent) {
  const el = box.value;
  if (!el || e.target !== el || e.ctrlKey || e.metaKey || e.altKey) return;
  const arrow = ARROWS[e.key];
  if (arrow) {
    e.preventDefault();
    const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
    const area = { width: el.clientWidth, height: el.clientHeight };
    const view = { zoom: zoom.value, left: el.scrollLeft, top: el.scrollTop };
    void show(panGraphBy(view, arrow[0] * step, arrow[1] * step, area, natural));
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
      <template v-if="showMarkers">
        Click the map to place a marker there, or press Add marker. Drag a marker to move it; on a
        focused marker the arrow keys move it, Enter edits it and Delete removes it.
      </template>
      <template v-else-if="markers.length">The markers are hidden.</template>
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
      </div>
      <fieldset class="map-layers" data-map-layers>
        <legend>Show on the map</legend>
        <label class="map-layer-toggle"
          ><input
            type="checkbox"
            :checked="showMarkers"
            data-map-layer-toggle="markers"
            @change="toggleMarkers"
          />
          Markers <span class="muted" data-map-marker-count>({{ markers.length }})</span></label
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
      v-on="handlers"
      @click.capture="onClickCapture"
      @keydown="onKey"
    >
      <div
        class="map-layer"
        :style="{ width: natural.width * zoom + 'px', height: natural.height * zoom + 'px' }"
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
            @blur="saveSpot(item.marker.id)"
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
