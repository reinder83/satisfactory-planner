<!--
  A build-plan step's body as a table (#1136, StepTable in step-table.ts; the mining step's is
  miningStep in mining.ts): the short line above it, one row per item headed by its name, a total
  row, and the line after it. PlanStep.vue draws it in place of the step's text, which stays the
  step's `body` for search and copying. On a phone (480px and less, style.css) each row stacks into
  one block, every cell under its column's name (data-label), so the page never scrolls sideways.
  Wider, a table that still does not fit its step scrolls inside its own box (style.css); that box
  then takes keyboard focus, named by the table's caption, so the arrow keys can scroll it (#1020).
  The lines above and after it mark the glossary terms in `terms` (#1076, ui/TermText.vue), each once.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { termParts } from '../../../preferences.ts';
import type { StepTable } from '../../../step-table.ts';
import { useScrollBox } from '../scroll-box.ts';
import TermText from '../TermText.vue';

const props = withDefaults(defineProps<{ table: StepTable; terms?: readonly string[] }>(), {
  terms: () => [],
});
// The terms the line after the table marks: those the line above it has not.
const afterTerms = computed(() => {
  const above = termParts(props.table.intro, props.terms).map(part => part.term);
  return props.terms.filter(term => !above.includes(term));
});
// Whether the table is wider than its box (ui/scroll-box.ts).
const { scrollAttrs } = useScrollBox('box');
// An empty cell hides on a phone; a short one (a rate, a count, an amount) never wraps.
const cellClass = (cell: string) => ({ empty: !cell, short: cell.length <= 16 });
</script>

<template>
  <div ref="box" class="step-table" data-step-table v-bind="scrollAttrs(table.caption)">
    <p><TermText :text="table.intro" :terms="terms" /></p>
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
    <p v-if="table.after" data-step-table-after>
      <TermText :text="table.after" :terms="afterTerms" />
    </p>
  </div>
</template>
