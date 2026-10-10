<!--
  "The diagram as a table" on a factory group's flow page (#894): the text equivalent of the
  cards and lanes. The lines in build order with their machines and what they make, then every
  link once, from where to where, with its rate and belts or pipes. A cell naming a line or a place
  can hold a group's long name: only a cell with such a word (hasLongWord) gets gf-cell-name, which
  breaks it inside the cell (#988), so a table of ordinary names is laid out as before. Last, the
  cards' ♻ lines (flowAdvice): each line's byproducts and the inputs a byproduct covers or that
  are extracted Water, for the group's part of the line, with the same text; no table when no line
  has any.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate } from '../../flow.ts';
import type { FlowLine, GroupFlow } from '../../group-flow.ts';
import { num } from '../../format.ts';
import {
  flowConnections,
  hasLongWord,
  isSelfLink,
  lineNumber,
  type FlowNames,
} from '../../views/group-flow-page.ts';
import { machineLine } from '../../views/factories.ts';
import { flowAdvice } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';

const props = defineProps<{ flow: GroupFlow; names: FlowNames }>();

const machines = (line: FlowLine) =>
  (line.share < 1 - 1e-6 ? `≈ ${num(line.machinesHere)} of ` : '') +
  machineLine(line.machines, line.machine, line.lastClock);
const connections = computed(() =>
  flowConnections(props.flow, props.names).map(connection => ({
    ...connection,
    note: connection.link.loop
      ? 'loop: seed a starter batch'
      : isSelfLink(connection.link)
        ? 'back into the same line'
        : '',
  })),
);
// The cards' ♻ lines, line by line in build order: a byproduct (→) before the inputs (←).
const advice = computed(() =>
  legacy(() =>
    props.flow.lines.flatMap(line =>
      flowAdvice(line.id, props.flow.group).map(entry => ({ line, ...entry })),
    ),
  ),
);
</script>

<template>
  <details class="gf-text" data-gf-table>
    <summary>The diagram as a table</summary>
    <div class="table-wrap">
      <table>
        <caption class="small muted">
          Lines in build order
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Line</th>
            <th scope="col">Machines</th>
            <th scope="col">Makes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in flow.lines" :key="line.id">
            <td>{{ lineNumber(line.no) }}</td>
            <td :class="{ 'gf-cell-name': hasLongWord(line.name) }">{{ line.name }}</td>
            <td>{{ machines(line) }}</td>
            <td>
              <template v-for="(output, n) in line.outputs" :key="output.id"
                ><br v-if="n" />{{ output.item }} {{ itemRate(output.item, output.rate) }}</template
              ><template v-if="line.mw"
                ><br v-if="line.outputs.length" />Power {{ power(line.mw) }}</template
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="table-wrap">
      <table>
        <caption class="small muted">
          Connections
        </caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">Item</th>
            <th scope="col">Rate</th>
            <th scope="col">Belts or pipes</th>
            <th scope="col">To</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(connection, n) in connections" :key="n" data-gf-connection>
            <td :class="{ 'gf-cell-name': hasLongWord(connection.from) }">{{ connection.from }}</td>
            <td>
              {{ connection.link.item
              }}<template v-if="connection.note"> · {{ connection.note }}</template>
            </td>
            <td class="number">{{ itemRate(connection.link.item, connection.link.rate) }}</td>
            <td>{{ connection.link.belts }}</td>
            <td :class="{ 'gf-cell-name': hasLongWord(connection.to) }">{{ connection.to }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="advice.length" class="table-wrap">
      <table data-gf-advice-table>
        <caption class="small muted">
          Byproducts and water
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Line</th>
            <th scope="col">Item</th>
            <th scope="col">Advice</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in advice"
            :key="entry.line.id + '|' + entry.side + '|' + entry.item"
            :data-advice="entry.side === 'out' ? 'byproduct' : 'input'"
          >
            <td>{{ lineNumber(entry.line.no) }}</td>
            <td :class="{ 'gf-cell-name': hasLongWord(entry.line.name) }">
              {{ entry.line.name }}
            </td>
            <td>{{ entry.side === 'out' ? '→' : '←' }} {{ entry.lead }}</td>
            <td class="gf-cell-advice">{{ entry.recycled ? '♻ ' : '' }}{{ entry.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>
