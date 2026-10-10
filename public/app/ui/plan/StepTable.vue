<!--
  A build-plan step's body as a table (#1136, StepTable in step-table.ts; the mining step's is
  miningStep in mining.ts): the short line above it, one row per item headed by its name, a total
  row, and the line after it. PlanStep.vue draws it in place of the step's text, which stays the
  step's `body` for search and copying. On a phone (480px and less, style.css) each row stacks into
  one block, every cell under its column's name (data-label), so the page never scrolls sideways.
-->
<script setup lang="ts">
import type { StepTable } from '../../../step-table.ts';

defineProps<{ table: StepTable }>();
</script>

<template>
  <div class="step-table" data-step-table>
    <p>{{ table.intro }}</p>
    <table>
      <caption class="visually-hidden">
        {{
          table.caption
        }}
      </caption>
      <thead>
        <tr>
          <th v-for="column in table.columns" :key="column" scope="col">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in table.rows" :key="row[0]" data-step-table-row>
          <template v-for="(cell, index) in row" :key="index">
            <th v-if="index === 0" scope="row">{{ cell }}</th>
            <td v-else :data-label="table.columns[index]" :class="{ empty: !cell }">{{ cell }}</td>
          </template>
        </tr>
      </tbody>
      <tfoot v-if="table.total">
        <tr data-step-table-total>
          <template v-for="(cell, index) in table.total" :key="index">
            <th v-if="index === 0" scope="row">{{ cell }}</th>
            <td v-else :data-label="table.columns[index]" :class="{ empty: !cell }">{{ cell }}</td>
          </template>
        </tr>
      </tfoot>
    </table>
    <p v-if="table.after" data-step-table-after>{{ table.after }}</p>
  </div>
</template>
