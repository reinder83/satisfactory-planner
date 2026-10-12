<!--
  A build-plan step's body as a table (#1136, StepTable in step-table.ts; the mining step's is
  miningStep in mining.ts): the short line above it, one row per item headed by its name, a total
  row, and the line after it. PlanStep.vue draws it in place of the step's text, which stays the
  step's `body` for search and copying. On a phone (480px and less, style.css) each row stacks into
  one block, every cell under its column's name (data-label), so the page never scrolls sideways.
  Wider, a table that still does not fit its step scrolls inside its own box (style.css); that box
  then takes keyboard focus, named by the table's caption, so the arrow keys can scroll it (#1020).
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { StepTable } from '../../../step-table.ts';

defineProps<{ table: StepTable }>();
// Whether the table is wider than its box, worked out when it is drawn and whenever the box
// changes size (a closed step's box has no width, so it scrolls nothing).
const box = ref<HTMLElement | null>(null);
const scrolls = ref(false);
const measure = () => {
  const el = box.value;
  scrolls.value = !!el && el.scrollWidth > el.clientWidth + 1;
};
let observer: ResizeObserver | undefined;
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && box.value) {
    observer = new ResizeObserver(measure);
    observer.observe(box.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
// An empty cell hides on a phone; a short one (a rate, a count, an amount) never wraps.
const cellClass = (cell: string) => ({ empty: !cell, short: cell.length <= 16 });
</script>

<template>
  <div
    ref="box"
    class="step-table"
    data-step-table
    :tabindex="scrolls ? 0 : undefined"
    :role="scrolls ? 'region' : undefined"
    :aria-label="scrolls ? table.caption + ' (scrolls sideways)' : undefined"
  >
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
        <tr v-for="(row, rowIndex) in table.rows" :key="rowIndex" data-step-table-row>
          <template v-for="(cell, index) in row" :key="index">
            <th v-if="index === 0" scope="row">{{ cell }}</th>
            <td v-else :data-label="table.columns[index]" :class="cellClass(cell)">{{ cell }}</td>
          </template>
        </tr>
      </tbody>
      <tfoot v-if="table.total">
        <tr data-step-table-total>
          <template v-for="(cell, index) in table.total" :key="index">
            <th v-if="index === 0" scope="row">{{ cell }}</th>
            <td v-else :data-label="table.columns[index]" :class="cellClass(cell)">{{ cell }}</td>
          </template>
        </tr>
      </tfoot>
    </table>
    <p v-if="table.after" data-step-table-after>{{ table.after }}</p>
  </div>
</template>
