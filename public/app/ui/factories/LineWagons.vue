<!--
  "What each wagon carries" (#1284, slice 2): one row per freight wagon of a line's train, front to
  back, with the cargo its loading platforms put in, where it loads and unloads, the belt (or pipe)
  that fills it and what one round trip brings against what it holds (wagonRows in views/trains.ts).
-->
<script setup lang="ts">
import type { WagonRow } from '../../views/trains.ts';

defineProps<{ rows: WagonRow[]; lineName: string }>();
</script>

<template>
  <div class="table-wrap line-wagons" data-line-wagons>
    <table>
      <caption class="small muted">
        What each wagon of
        {{
          lineName
        }}
        carries
      </caption>
      <thead>
        <tr>
          <th scope="col">Wagon</th>
          <th scope="col">Cargo</th>
          <th scope="col">Loads at</th>
          <th scope="col">Unloads at</th>
          <th scope="col">Belt or pipe</th>
          <th scope="col">Per round trip</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!rows.length">
          <td colspan="6">No wagons yet.</td>
        </tr>
        <tr v-for="row in rows" :key="row.number" :data-wagon="row.number">
          <th scope="row">{{ row.number }}</th>
          <td>{{ row.cargo }}<span v-if="row.mixed" class="muted"> (mixed)</span></td>
          <td>{{ row.loadAt }}</td>
          <td>{{ row.unloadAt }}</td>
          <td>{{ row.lane }}</td>
          <td :class="row.fits === false ? 'line-wagon-full' : undefined" data-wagon-fill>
            {{ row.fill }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
