<!--
  The Logistics page's train stations (#1284, slice 1 of 4): each station of the open profile as
  a card with its name, who it belongs to (a factory, a mining outpost or storage) and its
  platforms in order, and "Edit station ↗", which opens its editor (ui/detail/StationDialog.vue);
  "+ Add train station" opens the editor for a new one. Stations are not tied to a phase, so the
  section shows in every phase. A mining outpost's card also says when its loading platforms or
  the trains that load there take less than its extractors give (outpostChecks in
  app/train-lines.ts, #1284 slice 3).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { TRAIN_STATION_MAX } from '../../../state.ts';
import { state } from '../../session.ts';
import { ownerText, platformCounts, platformText } from '../../train-stations.ts';
import { trainsView } from '../../views/trains.ts';
import { showDetail } from '../detail.ts';
import { legacy } from '../bridge.ts';

const view = computed(() =>
  legacy(() => {
    const groups = state.factoryGroups?.groups ?? [];
    const stations = state.trainStations ?? [];
    const { outposts } = trainsView();
    return {
      full: stations.length >= TRAIN_STATION_MAX,
      cards: stations.map(station => ({
        id: station.id,
        name: station.name,
        owner: ownerText(station.owner, groups),
        count: platformCounts(station.platforms),
        platforms: station.platforms.map(platformText),
        checks: outposts[station.id] ?? [],
      })),
    };
  }),
);
const open = (id: string) => showDetail({ kind: 'station', id });
</script>

<template>
  <section class="panel train-stations" data-train-stations aria-labelledby="train-stations-title">
    <h2 id="train-stations-title">Train stations</h2>
    <p class="small muted">
      Your train stations, each with its platforms in order from the station building outwards. A
      platform loads cargo, unloads what arrives, or stays empty for a locomotive or spacing.
    </p>
    <p v-if="!view.cards.length" class="small" data-stations-empty>
      No train stations yet. Add one for each station you build or plan.
    </p>
    <div v-else class="group-cards station-cards">
      <article
        v-for="card in view.cards"
        :key="card.id"
        class="group-card station-card"
        data-station-card
        :data-station="card.id"
      >
        <h3>{{ card.name }}</h3>
        <p class="small muted" data-station-belongs>{{ card.owner }}</p>
        <p class="small" data-station-count>{{ card.count }}</p>
        <ol v-if="card.platforms.length" class="station-platform-list" data-station-platforms>
          <li v-for="(platform, i) in card.platforms" :key="i">{{ platform }}</li>
        </ol>
        <ul
          v-if="card.checks.length"
          class="notice warn line-check-list"
          :aria-label="`Checks: ${card.name}`"
          data-station-checks
        >
          <li v-for="check in card.checks" :key="check.key" :data-station-check="check.key">
            {{ check.text }}
          </li>
        </ul>
        <button
          type="button"
          class="btn"
          :data-station-edit="card.id"
          :aria-label="`Edit station ↗: ${card.name}`"
          @click="open(card.id)"
        >
          Edit station ↗
        </button>
      </article>
    </div>
    <p class="station-add">
      <button
        type="button"
        class="btn primary"
        data-station-add
        :disabled="view.full"
        @click="open('new')"
      >
        + Add train station
      </button>
      <span v-if="view.full" class="small muted" data-stations-full>
        A profile holds at most {{ TRAIN_STATION_MAX }} train stations.
      </span>
    </p>
  </section>
</template>
