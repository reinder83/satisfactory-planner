<!--
  A train line (#1284, slice 2), in #detail (kind 'line'): `id` is the line's id, or 'new' for one
  about to be added (the Logistics page's "+ Add train line"). Its name (1 to 60 characters), its
  train front to back (+ Wagon, + Locomotive, − Last car: a wagon goes in front of a rear
  locomotive), its stops in order (stations of the profile; added from a select, moved up and down
  and removed with buttons), its direction (a one-way loop, or back and forth, which needs a
  locomotive at both ends) and its round trip in minutes are edited here. The checks and what each
  wagon carries follow the draft as it changes (views/trains.ts), and "Add rear locomotive" in a
  check adds one to the draft. Changes are announced; nothing is saved before Add line or Save,
  which sends the whole line as one `trainLine` update and puts focus on the line's Edit button on
  the page: Cancel, × and Escape leave the line as it was. "Delete line" removes it with Undo in the
  toast (ui/train-line-actions.ts).
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  ROUND_TRIP_MAX,
  roundTripOf,
  TRAIN_CAR_MAX,
  TRAIN_LINE_NAME_MAX,
  TRAIN_STOP_MAX,
} from '../../../state.ts';
import type { TrainCar, TrainDirection, TrainLine } from '../../../types/index.ts';
import { announce } from '../../announce.ts';
import { whileBusy } from '../../busy.ts';
import { required } from '../../format.ts';
import { state } from '../../session.ts';
import { moveAt, removeAt } from '../../train-stations.ts';
import {
  DIRECTION_TEXT,
  newLineId,
  newLineName,
  withRearLoco,
  withWagon,
} from '../../train-lines.ts';
import { lineView, pageItemFacts } from '../../views/trains.ts';
import { closeDetail } from '../actions.ts';
import { legacy } from '../bridge.ts';
import LineChecks from '../factories/LineChecks.vue';
import LineWagons from '../factories/LineWagons.vue';
import { deleteLine, focusLine, saveLine } from '../train-line-actions.ts';
import DialogFrame from './DialogFrame.vue';

const props = defineProps<{ id: string }>();

const lines = () => legacy(() => state.trainLines ?? []);
const stations = computed(() => legacy(() => state.trainStations ?? []));
const isNew = props.id === 'new';
const start: TrainLine | null = isNew
  ? {
      id: newLineId(),
      name: newLineName(lines()),
      cars: ['loco', 'wagon'],
      stops: [],
      direction: 'oneWay',
    }
  : (lines().find(line => line.id === props.id) ?? null);
const gone = computed(() => !isNew && !lines().some(line => line.id === start?.id));

const name = ref(start?.name ?? '');
const missing = ref(false);
const cars = ref<TrainCar[]>([...(start?.cars ?? [])]);
const direction = ref<TrainDirection>(start?.direction ?? 'oneWay');
// The round trip as typed ('' for none entered).
const trip = ref<number | ''>(start?.roundTrip ?? '');
const badTrip = ref(false);
// The stops being edited, each with a key of its own so a moved stop keeps its row.
let nextKey = 0;
const stops = ref<{ key: number; station: string }[]>(
  (start?.stops ?? []).map(station => ({ key: nextKey++, station })),
);
const stationName = (id: string) => stations.value.find(station => station.id === id)?.name ?? id;
const toAdd = ref(stations.value[0]?.id ?? '');

const form = ref<HTMLFormElement | null>(null);
async function focusOn(selector: string) {
  await nextTick();
  form.value?.querySelector<HTMLElement>(selector)?.focus();
}

// The line as the draft has it now, for the checks and the wagon table.
const draftLine = computed<TrainLine>(() => {
  const minutes = trip.value === '' ? null : roundTripOf(trip.value);
  return {
    id: start?.id ?? 'tl-draft',
    name: name.value.trim() || (start?.name ?? ''),
    cars: cars.value,
    stops: stops.value.map(stop => stop.station),
    direction: direction.value,
    ...(minutes ? { roundTrip: minutes } : {}),
  };
});
const preview = computed(() =>
  legacy(() => lineView(draftLine.value, 0, stations.value, pageItemFacts())),
);

// The train, front to back: "Locomotive", "Wagon 2", "Rear locomotive".
function carName(car: TrainCar, i: number): string {
  if (car === 'wagon')
    return `Wagon ${cars.value.slice(0, i + 1).filter(entry => entry === 'wagon').length}`;
  return i > 0 && i === cars.value.length - 1 ? 'Rear locomotive' : 'Locomotive';
}
const full = computed(() => cars.value.length >= TRAIN_CAR_MAX);
function addWagon() {
  if (full.value) return;
  cars.value = withWagon(cars.value, direction.value);
  announce(`Wagon added. The train has ${cars.value.length} cars.`);
}
function addLoco() {
  if (full.value) return;
  cars.value = withRearLoco(cars.value);
  announce(`Locomotive added at the rear. The train has ${cars.value.length} cars.`);
}
async function removeLast() {
  if (!cars.value.length) return;
  cars.value = cars.value.slice(0, -1);
  announce(`Last car removed. The train has ${cars.value.length} cars.`);
  if (!cars.value.length) await focusOn('[data-line-add-wagon]');
}
// "Add rear locomotive" in a check: one more car in the draft, focus on + Locomotive.
async function fixRear() {
  addLoco();
  await focusOn('[data-line-add-loco]');
}

function addStop() {
  if (!toAdd.value || stops.value.length >= TRAIN_STOP_MAX) return;
  stops.value = [...stops.value, { key: nextKey++, station: toAdd.value }];
  announce(`${stationName(toAdd.value)} added as stop ${stops.value.length}.`);
}
async function moveStop(at: number, by: -1 | 1, which: 'up' | 'down') {
  const to = at + by;
  if (to < 0 || to >= stops.value.length) return;
  const key = stops.value[at]!.key;
  stops.value = moveAt(stops.value, at, by);
  announce(`Stop moved to position ${to + 1} of ${stops.value.length}.`);
  // At an end the button pressed is disabled, so focus takes the other one.
  const ends = to === 0 ? 'up' : to === stops.value.length - 1 ? 'down' : null;
  const button = ends === which ? (which === 'up' ? 'down' : 'up') : which;
  await focusOn(`[data-stop-key="${key}"] [data-stop-${button}]`);
}
async function removeStop(at: number) {
  const after = stops.value[at + 1]?.key ?? stops.value[at - 1]?.key ?? null;
  const removed = stops.value[at]!;
  stops.value = removeAt(stops.value, at);
  announce(`${stationName(removed.station)} removed. ${stops.value.length} stops left.`);
  await focusOn(
    after === null ? '[data-stop-select]' : `[data-stop-key="${after}"] [data-stop-remove]`,
  );
}

async function submit(event: Event) {
  const element = event.currentTarget as HTMLFormElement;
  if (!start || gone.value) return;
  if (!name.value.trim()) {
    missing.value = true;
    element.querySelector<HTMLInputElement>('[data-line-name]')?.focus();
    return;
  }
  const minutes = trip.value === '' ? null : roundTripOf(trip.value);
  badTrip.value = trip.value !== '' && minutes === null;
  if (badTrip.value) {
    element.querySelector<HTMLInputElement>('[data-line-trip]')?.focus();
    return;
  }
  const line: TrainLine = { ...draftLine.value, id: start.id, name: name.value.trim() };
  const saved = await whileBusy(element.querySelector<HTMLElement>('[data-line-save]')!, () =>
    saveLine(line),
  );
  if (!saved) return;
  required<HTMLDialogElement>('#detail').close();
  await focusLine(line.id);
}
async function removeLine(event: Event) {
  if (!start) return;
  const done = await whileBusy(event.currentTarget as HTMLElement, () => deleteLine(start.id));
  if (!done) return;
  required<HTMLDialogElement>('#detail').close();
  await nextTick();
  document.querySelector<HTMLElement>('#main [data-line-add]')?.focus();
}
function typed() {
  if (missing.value && name.value.trim()) missing.value = false;
}
</script>

<template>
  <DialogFrame :title="isNew ? 'New train line' : 'Edit train line'" subtitle="Train lines">
    <p v-if="!start || gone" class="notice warn" data-line-gone>
      This train line is gone. It was deleted in another tab or on another device.
    </p>
    <form
      v-else
      ref="form"
      class="station-form line-form"
      data-line-form
      novalidate
      @submit.prevent="submit"
    >
      <label class="field"
        >Name<input
          v-model="name"
          type="text"
          :maxlength="TRAIN_LINE_NAME_MAX"
          autocomplete="off"
          data-line-name
          :aria-invalid="missing ? 'true' : undefined"
          :aria-describedby="missing ? 'line-name-error' : undefined"
          @input="typed"
      /></label>
      <p
        id="line-name-error"
        class="form-error"
        role="alert"
        v-text="missing ? 'Give the line a name.' : ''"
      ></p>
      <fieldset class="station-platforms" data-line-train>
        <legend>Train, front to back</legend>
        <p v-if="!cars.length" class="small" data-line-no-cars>No cars yet.</p>
        <ol v-else class="line-consist" aria-label="Cars, front to back">
          <li v-for="(car, i) in cars" :key="i" :class="['line-car', car]" :data-car="car">
            {{ carName(car, i) }}
          </li>
        </ol>
        <div class="platform-tools">
          <button type="button" class="btn" :disabled="full" data-line-add-wagon @click="addWagon">
            + Wagon
          </button>
          <button type="button" class="btn" :disabled="full" data-line-add-loco @click="addLoco">
            + Locomotive
          </button>
          <button
            type="button"
            class="btn"
            :disabled="!cars.length"
            data-line-remove-car
            @click="removeLast"
          >
            − Last car
          </button>
        </div>
      </fieldset>
      <fieldset class="station-platforms" data-line-stops>
        <legend>Stops, in order</legend>
        <p v-if="!stations.length" class="small" data-line-no-stations>
          This profile has no train stations yet. Add them under Train stations first.
        </p>
        <p v-else-if="!stops.length" class="small" data-line-no-stops>No stops yet.</p>
        <ol v-if="stops.length" class="platform-list">
          <li
            v-for="(stop, i) in stops"
            :key="stop.key"
            class="platform-row line-stop"
            :data-stop="i"
            :data-stop-key="stop.key"
          >
            <strong class="platform-number"
              >Stop {{ i + 1 }}: {{ stationName(stop.station) }}</strong
            >
            <div class="platform-tools">
              <button
                type="button"
                class="btn"
                :disabled="i === 0"
                :aria-label="`Move up: stop ${i + 1}, ${stationName(stop.station)}`"
                data-stop-up
                @click="moveStop(i, -1, 'up')"
              >
                ↑
              </button>
              <button
                type="button"
                class="btn"
                :disabled="i === stops.length - 1"
                :aria-label="`Move down: stop ${i + 1}, ${stationName(stop.station)}`"
                data-stop-down
                @click="moveStop(i, 1, 'down')"
              >
                ↓
              </button>
              <button
                type="button"
                class="btn danger"
                :aria-label="`Remove: stop ${i + 1}, ${stationName(stop.station)}`"
                data-stop-remove
                @click="removeStop(i)"
              >
                Remove
              </button>
            </div>
          </li>
        </ol>
        <div v-if="stations.length" class="platform-head line-stop-add">
          <label class="field"
            >Station to add<select v-model="toAdd" data-stop-select>
              <option v-for="station in stations" :key="station.id" :value="station.id">
                {{ station.name }}
              </option>
            </select></label
          >
          <button
            type="button"
            class="btn"
            :disabled="stops.length >= TRAIN_STOP_MAX"
            data-stop-add
            @click="addStop"
          >
            + Add stop
          </button>
        </div>
      </fieldset>
      <fieldset class="station-platforms" data-line-direction-field>
        <legend>Direction</legend>
        <label v-for="(text, key) in DIRECTION_TEXT" :key="key" class="check-row"
          ><input
            v-model="direction"
            type="radio"
            name="line-direction"
            :value="key"
            :data-line-direction-choice="key"
          />
          <span aria-hidden="true">{{ text.mark }}</span> {{ text.label }}</label
        >
        <p class="small muted">
          A one-way loop runs back to the first stop after the last. Back and forth runs out and
          back the same way, so it needs a locomotive at each end.
        </p>
      </fieldset>
      <label class="field line-trip"
        >Round trip (minutes)<input
          v-model.number="trip"
          type="number"
          inputmode="decimal"
          min="0.1"
          :max="ROUND_TRIP_MAX"
          step="0.1"
          data-line-trip
          :aria-invalid="badTrip ? 'true' : undefined"
          aria-describedby="line-trip-help line-trip-error"
      /></label>
      <p id="line-trip-help" class="small muted">
        How long the train takes to come back to the first stop. Time one round in the game, or
        leave it empty for now.
      </p>
      <p
        id="line-trip-error"
        class="form-error"
        role="alert"
        v-text="
          badTrip ? `Give the round trip in minutes, above 0 and at most ${ROUND_TRIP_MAX}.` : ''
        "
      ></p>
      <section class="line-preview" aria-labelledby="line-checks-title">
        <h3 id="line-checks-title">Checks</h3>
        <LineChecks :checks="preview.checks" :line-name="preview.name" @fix="fixRear" />
        <LineWagons :rows="preview.wagons" :line-name="preview.name" />
      </section>
      <div class="detail-actions">
        <button type="submit" class="btn primary" data-line-save>
          {{ isNew ? 'Add line' : 'Save' }}
        </button>
        <button type="button" class="btn" data-line-cancel @click="closeDetail">Cancel</button>
        <button v-if="!isNew" type="button" class="btn danger" data-line-delete @click="removeLine">
          Delete line
        </button>
      </div>
    </form>
  </DialogFrame>
</template>
