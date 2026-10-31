<!--
  The Logistics page's train lines (#1284, slice 2 of 4), on the Trains tab under the stations:
  each line of the open profile as a card with its colour (as in the network diagram and on the
  map), its name, direction (⇄ back and forth, → one-way loop), its train front to back, its stops
  in order and its round trip; its checks (LineChecks.vue: shown, never blocking, with "Add rear
  locomotive" and the station's editor where they help); and what each wagon carries
  (LineWagons.vue), which the stations' platforms decide. "Edit line ↗" opens the line editor
  (ui/detail/LineDialog.vue) and "+ Add train line" opens it for a new one.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { TRAIN_LINE_MAX } from '../../../state.ts';
import { state } from '../../session.ts';
import { withRearLoco } from '../../train-lines.ts';
import { trainsView } from '../../views/trains.ts';
import { legacy } from '../bridge.ts';
import { showDetail } from '../detail.ts';
import { focusLine, saveLine } from '../train-line-actions.ts';
import LineChecks from './LineChecks.vue';
import LineWagons from './LineWagons.vue';

const view = computed(() =>
  legacy(() => {
    const trains = trainsView();
    return {
      cards: trains.lines,
      full: trains.lines.length >= TRAIN_LINE_MAX,
      stationNames: Object.fromEntries(trains.stations.map(station => [station.id, station.name])),
      stations: trains.stations.length,
    };
  }),
);
const open = (id: string) => showDetail({ kind: 'line', id });
const openStation = (id: string) => showDetail({ kind: 'station', id });
// "Add rear locomotive" on the card: saved at once, focus back on the line's Edit button.
async function addRearLoco(id: string) {
  const line = legacy(() => state.trainLines?.find(entry => entry.id === id));
  if (line && (await saveLine({ ...line, cars: withRearLoco(line.cars) }))) await focusLine(id);
}
</script>

<template>
  <section class="panel train-lines" data-train-lines aria-labelledby="train-lines-title">
    <h2 id="train-lines-title">Train lines</h2>
    <p class="small muted">
      A line is a train and the stations it calls at, in order. The front locomotive stands at the
      station building and each car behind it at the platform in the same place, so the platforms
      decide what each wagon carries.
    </p>
    <p v-if="!view.cards.length" class="small" data-lines-empty>
      No train lines yet.
      <template v-if="!view.stations">Add the stations first, then a line between them.</template>
    </p>
    <div v-else class="line-cards">
      <article
        v-for="card in view.cards"
        :key="card.id"
        :class="['group-card', 'line-card', 'line-color-' + card.color]"
        data-line-card
        :data-line="card.id"
      >
        <h3>
          <span class="line-swatch" aria-hidden="true"></span>{{ card.name }}
          <span class="muted" data-line-direction
            ><span aria-hidden="true">{{ card.mark }}</span> {{ card.direction }}</span
          >
        </h3>
        <p class="small" data-line-train>Train: {{ card.train }}</p>
        <p class="small" data-line-stops>
          Stops:
          <template v-if="card.stops.length">
            <template v-for="(stop, i) in card.stops" :key="i"
              ><span v-if="i" aria-hidden="true"> → </span
              ><span class="visually-hidden" v-if="i">, then </span>{{ stop }}</template
            >
          </template>
          <template v-else>none yet</template>
          · {{ card.roundTrip }}
        </p>
        <LineChecks
          :checks="card.checks"
          :station-names="view.stationNames"
          :line-name="card.name"
          @fix="addRearLoco(card.id)"
          @station="openStation"
        />
        <LineWagons :rows="card.wagons" :line-name="card.name" />
        <button
          type="button"
          class="btn"
          :data-line-edit="card.id"
          :aria-label="`Edit line ↗: ${card.name}`"
          @click="open(card.id)"
        >
          Edit line ↗
        </button>
      </article>
    </div>
    <p class="station-add">
      <button
        type="button"
        class="btn primary"
        data-line-add
        :disabled="view.full"
        @click="open('new')"
      >
        + Add train line
      </button>
      <span v-if="view.full" class="small muted" data-lines-full>
        A profile holds at most {{ TRAIN_LINE_MAX }} train lines.
      </span>
    </p>
  </section>
</template>
