<!--
  A train station (#1284, slice 1), in #detail (kind 'station'): `id` is the station's id, 'new'
  for one about to be added (the Logistics page's "+ Add train station"), or 'new:<x>:<y>' for one
  about to be added at that spot of the world map (the map's "+ Add train station", slice 4). Since
  version 30 a loading platform may carry fluids (with the pipe that fills it), an outpost may be
  on oil nodes or resource wells, and a station keeps its place on the map through an edit. Its name (1 to 60
  characters), who it belongs to (a factory of the profile, a mining outpost with its resource and
  nodes, or storage) and its platforms in order are edited here: each platform loads cargo (one
  item, or several for mixed cargo, picked with the item search), unloads or stays empty, and a
  load or unload platform has the belt that feeds or drains it. Platforms are added at the end,
  moved up and down and removed with buttons, so all of it works from the keyboard; a move or a
  removal is announced and focus stays on the platform moved, or goes to the next one. Nothing is
  saved before Save, which sends the whole station as one `trainStation` update and puts focus on
  the station's Edit button on the page: Cancel, × and Escape leave the station as it was. "Delete
  station" removes it with Undo in the toast (ui/train-station-actions.ts).
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  OUTPOST_NODE_MAX,
  TRAIN_CARGO_MAX,
  TRAIN_PLATFORM_KINDS,
  TRAIN_PLATFORM_MAX,
  TRAIN_STATION_NAME_MAX,
} from '../../../state.ts';
import type {
  BeltMark,
  FactoryPlace,
  NodePurityCounts,
  PipeMark,
  StationOwner,
  TrainPlatform,
  TrainPlatformKind,
  TrainStation,
} from '../../../types/index.ts';
import { announce } from '../../announce.ts';
import { whileBusy } from '../../busy.ts';
import { knownItem, required } from '../../format.ts';
import { FLUIDS } from '../../flow.ts';
import { calculated, state } from '../../session.ts';
import {
  beltChoices,
  cargoItems,
  outpostResources,
  PLATFORM_KINDS,
  PURITIES,
  pipeChoices,
  wellsChoice,
  moveAt,
  newStationId,
  newStationName,
  nodesText,
  platformOfKind,
  removeAt,
} from '../../train-stations.ts';
import { closeDetail } from '../actions.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import ItemSearch from '../form/ItemSearch.vue';
import { deleteStation, focusStation, saveStation } from '../train-station-actions.ts';
import DialogFrame from './DialogFrame.vue';

const props = defineProps<{ id: string }>();
const CARGO_ITEMS = cargoItems();
const BELT_CHOICES = beltChoices();
const PIPE_CHOICES = pipeChoices();
const OUTPOST_RESOURCES = outpostResources();

const stations = () => legacy(() => state.trainStations ?? []);
const groups = computed(() => legacy(() => state.factoryGroups?.groups ?? []));
const isNew = props.id === 'new' || props.id.startsWith('new:');
// The spot of the map a new station is added at ('new:<x>:<y>'), in game units.
function newPlace(): FactoryPlace | undefined {
  const [, x, y] = props.id.split(':');
  const spot = { x: Number(x), y: Number(y) };
  return Number.isFinite(spot.x) && Number.isFinite(spot.y) && x && y ? spot : undefined;
}
const placeAt = isNew ? newPlace() : undefined;
const start: TrainStation | null = isNew
  ? {
      id: newStationId(),
      name: newStationName(stations()),
      platforms: [],
      ...(placeAt ? { place: placeAt } : {}),
    }
  : (stations().find(station => station.id === props.id) ?? null);
const gone = computed(() => !isNew && !stations().some(station => station.id === start?.id));

const name = ref(start?.name ?? '');
const missing = ref(false);
// The owner as the select holds it: '' none, 'storage', 'outpost' or 'factory:<group id>'.
const ownerOf = (owner: StationOwner | undefined) =>
  !owner ? '' : owner.kind === 'factory' ? `factory:${owner.id}` : owner.kind;
const owner = ref(ownerOf(start?.owner));
const startOutpost = start?.owner?.kind === 'outpost' ? start.owner : null;
const resource = ref(startOutpost?.resource ?? OUTPOST_RESOURCES[0]!);
// On resource wells (version 30): asked for Crude Oil, which has both; Nitrogen Gas and Water are
// always on wells, the ordinary resources never.
const onWells = ref(!!startOutpost?.wells);
const wellsAsked = computed(() => wellsChoice(resource.value));
const wells = computed(() =>
  wellsAsked.value === 'always' ? true : wellsAsked.value === 'never' ? false : onWells.value,
);
// Each purity's count as typed ('' for none).
const nodes = ref<Record<keyof NodePurityCounts, number | ''>>({
  pure: startOutpost?.nodes.pure ?? '',
  normal: startOutpost?.nodes.normal ?? '',
  impure: startOutpost?.nodes.impure ?? '',
});
const badNodes = ref(false);
// What the plan's node survey counts of the resource picked, as a hint.
const planNodes = computed(() => {
  const survey = legacy(() => calculated?.settings?.extraction);
  const counts = (wells.value ? survey?.wells : survey?.nodes)?.[resource.value];
  return counts ? nodesText(counts, wells.value) : '';
});

// The platforms being edited, each with a key of its own so a moved platform keeps its row.
let nextKey = 0;
const draft = ref<{ key: number; platform: TrainPlatform; search: number }[]>(
  (start?.platforms ?? []).map(platform => ({
    key: nextKey++,
    platform: structuredClone(platform),
    search: 0,
  })),
);
const form = ref<HTMLFormElement | null>(null);
const row = (key: number) =>
  form.value?.querySelector<HTMLElement>(`[data-platform-key="${key}"]`) ?? null;
async function focusIn(key: number | null, selector: string) {
  await nextTick();
  const target =
    key === null
      ? form.value?.querySelector<HTMLElement>('[data-platform-add]')
      : row(key)?.querySelector<HTMLElement>(selector);
  target?.focus();
}

function add() {
  if (draft.value.length >= TRAIN_PLATFORM_MAX) return;
  const key = nextKey++;
  draft.value = [...draft.value, { key, platform: { kind: 'load', cargo: [] }, search: 0 }];
  announce(`Platform ${draft.value.length} added.`);
  void focusIn(key, '[data-platform-kind]');
}
function setKind(at: number, kind: TrainPlatformKind) {
  const entry = draft.value[at]!;
  entry.platform = platformOfKind(kind, entry.platform);
}
function setBelt(at: number, value: string) {
  const platform = draft.value[at]!.platform;
  if (platform.kind === 'empty') return;
  if (value) platform.belt = Number(value) as BeltMark;
  else delete platform.belt;
}
function setPipe(at: number, value: string) {
  const platform = draft.value[at]!.platform;
  if (platform.kind === 'empty') return;
  if (value) platform.pipe = Number(value) as PipeMark;
  else delete platform.pipe;
}
// Which connections a platform offers: an unloading platform both (whatever arrives), a loading
// one a belt for solid cargo (or none picked yet) and a pipe for fluid cargo.
const lanesOf = (platform: TrainPlatform) => {
  if (platform.kind === 'empty') return { belt: false, pipe: false };
  if (platform.kind === 'unload') return { belt: true, pipe: true };
  const fluid = platform.cargo.filter(item => FLUIDS.has(item)).length;
  return { belt: !platform.cargo.length || fluid < platform.cargo.length, pipe: fluid > 0 };
};
async function move(at: number, by: -1 | 1, which: 'up' | 'down') {
  const to = at + by;
  if (to < 0 || to >= draft.value.length) return;
  const key = draft.value[at]!.key;
  draft.value = moveAt(draft.value, at, by);
  announce(`Platform moved to position ${to + 1} of ${draft.value.length}.`);
  // At an end the button pressed is disabled, so focus takes the other one.
  const ends = to === 0 ? 'up' : to === draft.value.length - 1 ? 'down' : null;
  const button = ends === which ? (which === 'up' ? 'down' : 'up') : which;
  await focusIn(key, `[data-platform-${button}]`);
}
async function remove(at: number) {
  const after = draft.value[at + 1]?.key ?? draft.value[at - 1]?.key ?? null;
  draft.value = removeAt(draft.value, at);
  announce(`Platform ${at + 1} removed. ${draft.value.length} left.`);
  await focusIn(after, '[data-platform-kind]');
}
async function addCargo(at: number, item: string) {
  const entry = draft.value[at]!;
  if (entry.platform.kind !== 'load' || !CARGO_ITEMS.includes(item)) return;
  if (!entry.platform.cargo.includes(item) && entry.platform.cargo.length < TRAIN_CARGO_MAX)
    entry.platform.cargo = [...entry.platform.cargo, item];
  // A fresh, empty search field for the next item, with focus in it while there is room.
  entry.search++;
  announce(`${item} added to platform ${at + 1}.`);
  if (entry.platform.cargo.length < TRAIN_CARGO_MAX)
    return focusIn(entry.key, '[data-cargo-add] input');
  // Full: the field goes, so focus goes to the × of the item just added.
  await nextTick();
  [...(row(entry.key)?.querySelectorAll<HTMLElement>('[data-cargo-remove]') ?? [])].at(-1)?.focus();
}
// Enter in the cargo field: the item search picks a suggestion itself (and cancels the key). With
// no suggestion to pick, Enter adds the item the text names exactly, and never submits the form.
function cargoEnter(at: number, event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const item = knownItem(CARGO_ITEMS, (event.target as HTMLInputElement).value);
  if (item) void addCargo(at, item);
}
async function removeCargo(at: number, item: string) {
  const entry = draft.value[at]!;
  if (entry.platform.kind !== 'load') return;
  entry.platform.cargo = entry.platform.cargo.filter(entry => entry !== item);
  announce(`${item} removed from platform ${at + 1}.`);
  await focusIn(entry.key, '[data-cargo-add] input');
}

// The owner to save, or null when the outpost's node counts are not whole numbers from 0 to 99.
function ownerToSave(): StationOwner | undefined | null {
  if (owner.value === 'storage') return { kind: 'storage' };
  if (owner.value.startsWith('factory:')) return { kind: 'factory', id: owner.value.slice(8) };
  if (owner.value !== 'outpost') return undefined;
  const counts: NodePurityCounts = {};
  for (const [purity] of PURITIES) {
    const count = nodes.value[purity];
    if (count === '' || count === 0) continue;
    if (!Number.isInteger(count) || count < 0 || count > OUTPOST_NODE_MAX) return null;
    counts[purity] = count;
  }
  return {
    kind: 'outpost',
    resource: resource.value,
    nodes: counts,
    ...(wells.value ? { wells: true as const } : {}),
  };
}

async function submit(event: Event) {
  const element = event.currentTarget as HTMLFormElement;
  if (!start || gone.value) return;
  if (!name.value.trim()) {
    missing.value = true;
    element.querySelector<HTMLInputElement>('[data-station-name]')?.focus();
    return;
  }
  const kept = ownerToSave();
  badNodes.value = kept === null;
  if (kept === null) {
    element.querySelector<HTMLInputElement>('[data-outpost-nodes]')?.focus();
    return;
  }
  const station: TrainStation = {
    id: start.id,
    name: name.value.trim(),
    ...(kept ? { owner: kept } : {}),
    platforms: draft.value.map(entry => entry.platform),
    ...(start.place ? { place: start.place } : {}),
  };
  const saved = await whileBusy(element.querySelector<HTMLElement>('[data-station-save]')!, () =>
    saveStation(station),
  );
  if (!saved) return;
  required<HTMLDialogElement>('#detail').close();
  await focusStation(station.id);
}

async function removeStation(event: Event) {
  if (!start) return;
  const done = await whileBusy(event.currentTarget as HTMLElement, () => deleteStation(start.id));
  if (!done) return;
  required<HTMLDialogElement>('#detail').close();
  await nextTick();
  document.querySelector<HTMLElement>('#main [data-station-add], #main [data-world-map]')?.focus();
}

function typed() {
  if (missing.value && name.value.trim()) missing.value = false;
}
</script>

<template>
  <DialogFrame
    :title="isNew ? 'New train station' : 'Edit train station'"
    subtitle="Train stations"
  >
    <p v-if="!start || gone" class="notice warn" data-station-gone>
      This train station is gone. It was deleted in another tab or on another device.
    </p>
    <form
      v-else
      ref="form"
      class="station-form"
      data-station-form
      novalidate
      @submit.prevent="submit"
    >
      <label class="field"
        >Name<input
          v-model="name"
          type="text"
          :maxlength="TRAIN_STATION_NAME_MAX"
          autocomplete="off"
          data-station-name
          :aria-invalid="missing ? 'true' : undefined"
          :aria-describedby="missing ? 'station-name-error' : undefined"
          @input="typed"
      /></label>
      <p
        id="station-name-error"
        class="form-error"
        role="alert"
        v-text="missing ? 'Give the station a name.' : ''"
      ></p>
      <label class="field"
        >Belongs to<select v-model="owner" data-station-owner>
          <option value="">No owner set</option>
          <optgroup v-if="groups.length" label="Factories">
            <option v-for="group in groups" :key="group.id" :value="'factory:' + group.id">
              {{ group.name }}
            </option>
          </optgroup>
          <option value="outpost">Mining outpost</option>
          <option value="storage">Storage</option>
        </select></label
      >
      <fieldset v-if="owner === 'outpost'" class="station-outpost" data-station-outpost>
        <legend>Mining outpost</legend>
        <label class="field"
          >Resource<select v-model="resource" data-outpost-resource>
            <option v-for="item in OUTPOST_RESOURCES" :key="item" :value="item">
              {{ item }}
            </option>
          </select></label
        >
        <div class="station-nodes">
          <label v-for="[purity, label] in PURITIES" :key="purity" class="field"
            >{{ label }} nodes<input
              v-model.number="nodes[purity]"
              type="number"
              inputmode="numeric"
              min="0"
              :max="OUTPOST_NODE_MAX"
              step="1"
              :data-outpost-nodes="purity"
              :aria-invalid="badNodes ? 'true' : undefined"
              :aria-describedby="badNodes ? 'outpost-nodes-error' : undefined"
          /></label>
        </div>
        <p
          id="outpost-nodes-error"
          class="form-error"
          role="alert"
          v-text="
            badNodes ? `Give each node count as a whole number from 0 to ${OUTPOST_NODE_MAX}.` : ''
          "
        ></p>
        <label v-if="wellsAsked === 'either'" class="check-row" data-outpost-wells-field
          ><input v-model="onWells" type="checkbox" data-outpost-wells /> On a resource well (the
          counts are its satellite nodes)</label
        >
        <p v-else-if="wellsAsked === 'always'" class="small muted" data-outpost-wells-note>
          {{ resource }} comes from resource wells: count the well’s satellite nodes.
        </p>
        <p v-if="planNodes" class="small muted" data-outpost-plan>
          The plan’s node survey counts {{ planNodes }} of {{ resource }}.
        </p>
      </fieldset>
      <fieldset class="station-platforms" data-station-platforms>
        <legend>Platforms</legend>
        <p class="small muted">
          In order from the station building outwards. A train’s locomotive stands at the building,
          and each car behind it at the platform in the same place.
        </p>
        <p v-if="!draft.length" class="small" data-platforms-empty>No platforms yet.</p>
        <ol v-else class="platform-list">
          <li
            v-for="(entry, i) in draft"
            :key="entry.key"
            class="platform-row"
            :data-platform="i"
            :data-platform-key="entry.key"
          >
            <div class="platform-head">
              <strong class="platform-number">Platform {{ i + 1 }}</strong>
              <label class="field"
                >Type<select
                  :value="entry.platform.kind"
                  :aria-label="`Type: platform ${i + 1}`"
                  data-platform-kind
                  @change="
                    setKind(i, ($event.target as HTMLSelectElement).value as TrainPlatformKind)
                  "
                >
                  <option v-for="kind in TRAIN_PLATFORM_KINDS" :key="kind" :value="kind">
                    {{ PLATFORM_KINDS[kind] }}
                  </option>
                </select></label
              >
              <label v-if="lanesOf(entry.platform).belt" class="field"
                >Belt<select
                  :value="entry.platform.kind === 'empty' ? '' : (entry.platform.belt ?? '')"
                  :aria-label="`Belt: platform ${i + 1}`"
                  data-platform-belt
                  @change="setBelt(i, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Not picked</option>
                  <option v-for="belt in BELT_CHOICES" :key="belt.mark" :value="belt.mark">
                    {{ belt.label }}
                  </option>
                </select></label
              >
              <label v-if="lanesOf(entry.platform).pipe" class="field"
                >Pipe<select
                  :value="entry.platform.kind === 'empty' ? '' : (entry.platform.pipe ?? '')"
                  :aria-label="`Pipe: platform ${i + 1}`"
                  data-platform-pipe
                  @change="setPipe(i, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Not picked</option>
                  <option v-for="pipe in PIPE_CHOICES" :key="pipe.mark" :value="pipe.mark">
                    {{ pipe.label }}
                  </option>
                </select></label
              >
              <div class="platform-tools">
                <button
                  type="button"
                  class="btn"
                  :disabled="i === 0"
                  :aria-label="`Move up: platform ${i + 1}`"
                  data-platform-up
                  @click="move(i, -1, 'up')"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="btn"
                  :disabled="i === draft.length - 1"
                  :aria-label="`Move down: platform ${i + 1}`"
                  data-platform-down
                  @click="move(i, 1, 'down')"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="btn danger"
                  :aria-label="`Remove: platform ${i + 1}`"
                  data-platform-remove
                  @click="remove(i)"
                >
                  Remove
                </button>
              </div>
            </div>
            <div v-if="entry.platform.kind === 'load'" class="platform-cargo">
              <span class="field">Cargo</span>
              <p v-if="!entry.platform.cargo.length" class="small muted" data-cargo-none>
                No cargo picked yet. Pick one item, or several for mixed cargo; a fluid goes in a
                fluid freight wagon by pipe.
              </p>
              <ul v-else class="cargo-list">
                <li v-for="item in entry.platform.cargo" :key="item" :data-cargo="item">
                  <ItemIcon :name="item" /><span>{{ item }}</span
                  ><button
                    type="button"
                    class="btn quiet"
                    :aria-label="`Remove ${item} from platform ${i + 1}`"
                    data-cargo-remove
                    @click="removeCargo(i, item)"
                  >
                    ×
                  </button>
                </li>
              </ul>
              <div
                v-if="entry.platform.cargo.length < TRAIN_CARGO_MAX"
                :key="entry.search"
                class="cargo-add"
                data-cargo-add
                @keydown.enter="cargoEnter(i, $event)"
              >
                <ItemSearch
                  :items="CARGO_ITEMS"
                  :name="'cargo-' + entry.key"
                  :list-id="'cargo-' + entry.key + '-options'"
                  :aria-label="`Add cargo: platform ${i + 1}`"
                  placeholder="Add cargo…"
                  @pick="item => addCargo(i, item)"
                />
              </div>
            </div>
          </li>
        </ol>
        <button
          type="button"
          class="btn"
          :disabled="draft.length >= TRAIN_PLATFORM_MAX"
          data-platform-add
          @click="add"
        >
          + Add platform
        </button>
      </fieldset>
      <div class="detail-actions">
        <button type="submit" class="btn primary" data-station-save>
          {{ isNew ? 'Add station' : 'Save' }}
        </button>
        <button type="button" class="btn" data-station-cancel @click="closeDetail">Cancel</button>
        <button
          v-if="!isNew"
          type="button"
          class="btn danger"
          data-station-delete
          @click="removeStation"
        >
          Delete station
        </button>
      </div>
    </form>
  </DialogFrame>
</template>
