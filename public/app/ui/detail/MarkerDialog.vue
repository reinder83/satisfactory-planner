<!--
  A marker on the world map (#1283, slice 2), in #detail (kind 'marker'): `id` is the marker's id,
  or 'new:<x>:<y>' for a marker about to be placed at that spot in game units (a click on the map,
  or "Add marker", ui/pages/MapPage.vue). Its name (1 to 60 characters), its type (resource node,
  landmark or note, each with its own icon) and its colour (the type's own, or one of the palette)
  are edited here; Save sends the whole marker as one `mapMarker` update and puts focus on it on
  the map. "Delete marker" removes it with Undo in the toast (ui/map-marker-actions.ts), and
  focus goes to the map. Nothing is saved before Save: Cancel, × and Escape leave the map as it
  was. The spot is shown in game units, which is how a known in-game position can be compared.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { MAP_MARKER_COLORS, MAP_MARKER_NAME_MAX, MAP_MARKER_TYPES } from '../../../state.ts';
import type { MapMarker, MapMarkerColor, MapMarkerType } from '../../../types/index.ts';
import { closeDetail } from '../actions.ts';
import { whileBusy } from '../../busy.ts';
import { required } from '../../format.ts';
import {
  MARKER_COLORS,
  MARKER_TYPES,
  markerSpotText,
  markerTarget,
  newMarkerId,
  newMarkerName,
} from '../../map-markers.ts';
import { state } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { deleteMarker, focusMarker, saveMarker } from '../map-marker-actions.ts';
import DialogFrame from './DialogFrame.vue';

const props = defineProps<{ id: string }>();

// The marker as saved, or a new one at its spot; null once a saved marker is gone (deleted in
// another tab, say).
const target = markerTarget(props.id);
const markers = () => legacy(() => state.mapMarkers ?? []);
const start: MapMarker | null =
  'spot' in target
    ? { id: newMarkerId(), name: newMarkerName(markers()), type: 'landmark', ...target.spot }
    : (markers().find(marker => marker.id === target.id) ?? null);
const isNew = 'spot' in target;
const gone = computed(() => !isNew && !markers().some(marker => marker.id === start?.id));

const name = ref(start?.name ?? '');
const type = ref<MapMarkerType>(start?.type ?? 'landmark');
// '' is the type's own colour.
const color = ref<MapMarkerColor | ''>(start?.color ?? '');
const missing = ref(false);
const ownColor = computed(() => MARKER_COLORS[MARKER_TYPES[type.value].color].label);

async function submit(event: Event) {
  const form = event.currentTarget as HTMLFormElement;
  if (!start || gone.value) return;
  if (!name.value.trim()) {
    missing.value = true;
    form.querySelector<HTMLInputElement>('[data-marker-name]')?.focus();
    return;
  }
  const marker: MapMarker = {
    id: start.id,
    name: name.value.trim(),
    type: type.value,
    ...(color.value ? { color: color.value } : {}),
    x: start.x,
    y: start.y,
  };
  const saved = await whileBusy(form.querySelector<HTMLElement>('[data-marker-save]')!, () =>
    saveMarker(marker),
  );
  if (!saved) return;
  required<HTMLDialogElement>('#detail').close();
  await focusMarker(marker.id);
}

async function remove(event: Event) {
  if (!start) return;
  const done = await whileBusy(event.currentTarget as HTMLElement, () => deleteMarker(start.id));
  if (!done) return;
  required<HTMLDialogElement>('#detail').close();
  document.querySelector<HTMLElement>('#main [data-world-map]')?.focus();
}

function typed() {
  if (missing.value && name.value.trim()) missing.value = false;
}
</script>

<template>
  <DialogFrame :title="isNew ? 'New marker' : 'Edit marker'" subtitle="World map">
    <p v-if="!start || gone" class="notice warn" data-marker-gone>
      This marker is no longer on the map. It was deleted in another tab or on another device.
    </p>
    <form v-else class="marker-form" data-marker-form novalidate @submit.prevent="submit">
      <label class="field"
        >Name<input
          v-model="name"
          type="text"
          :maxlength="MAP_MARKER_NAME_MAX"
          autocomplete="off"
          data-marker-name
          :aria-invalid="missing ? 'true' : undefined"
          :aria-describedby="missing ? 'marker-name-error' : undefined"
          @input="typed"
      /></label>
      <p
        id="marker-name-error"
        class="form-error"
        role="alert"
        v-text="missing ? 'Give the marker a name.' : ''"
      ></p>
      <fieldset class="marker-types">
        <legend>Type</legend>
        <label v-for="kind in MAP_MARKER_TYPES" :key="kind" class="marker-type">
          <input
            v-model="type"
            type="radio"
            name="marker-type"
            :value="kind"
            :data-marker-type="kind"
          />
          <svg class="marker-type-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path :d="MARKER_TYPES[kind].icon" />
          </svg>
          {{ MARKER_TYPES[kind].label }}
        </label>
      </fieldset>
      <label class="field"
        >Colour<select v-model="color" data-marker-color>
          <option value="">The type’s own ({{ ownColor }})</option>
          <option v-for="hue in MAP_MARKER_COLORS" :key="hue" :value="hue">
            {{ MARKER_COLORS[hue].label }}
          </option>
        </select></label
      >
      <p class="small muted" data-marker-spot>
        In the game at {{ markerSpotText(start) }} (game units).
        <template v-if="isNew">Drag the marker or use the arrow keys to move it later.</template>
      </p>
      <div class="detail-actions">
        <button type="submit" class="btn primary" data-marker-save>
          {{ isNew ? 'Place marker' : 'Save' }}
        </button>
        <button type="button" class="btn" data-marker-cancel @click="closeDetail">Cancel</button>
        <button v-if="!isNew" type="button" class="btn danger" data-marker-delete @click="remove">
          Delete marker
        </button>
      </div>
    </form>
  </DialogFrame>
</template>
