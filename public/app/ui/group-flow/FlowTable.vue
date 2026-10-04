<!--
  "The diagram as a table" on a factory group's flow page (#894): the text equivalent of the
  cards and lanes. The lines in build order with their machines and what they make, then every
  link once, from where to where, with its rate and belts or pipes.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate } from '../../flow.ts';
import type { FlowLine, GroupFlow } from '../../group-flow.ts';
import { num } from '../../format.ts';
import {
  flowConnections,
  isSelfLink,
  lineNumber,
  type FlowNames,
} from '../../views/group-flow-page.ts';
import { machineLine } from '../../views/factories.ts';
import { power } from '../../wizard/fields.ts';

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
            <td>{{ line.name }}</td>
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
            <td>{{ connection.from }}</td>
            <td>
              {{ connection.link.item
              }}<template v-if="connection.note"> · {{ connection.note }}</template>
            </td>
            <td class="number">{{ itemRate(connection.link.item, connection.link.rate) }}</td>
            <td>{{ connection.link.belts }}</td>
            <td>{{ connection.to }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>
