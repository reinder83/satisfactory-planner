<!--
  One line of a factory group's flow page (#894): its number, name (a link to the factory's
  dialog; "Wire for Alpha" for a group's own line made on site, as in the build plan, #896),
  whether it runs, its machines, then one column of rows, the inputs (←) before the
  outputs (→), each with its item, where it comes from or goes, its rate and, under the rate,
  the belts or pipes it takes. Every row reaches the card's left border, where the page draws
  the lanes: a row's name (.gf-name) is what its dot or arrowhead points at, and each row
  carries its id in the flow as data-row. An input row fed from outside the group and by no
  other line of it has a blue side bar instead of an arrow; one fed only by itself has neither.
  Under a byproduct's output row, and under an input row a byproduct covers, a ♻ line repeats
  the factory dialog's advice (rowAdvice, #1022) as text, for the group's part of the line: a row
  split over several groups gets only what its part here sends and takes (flowAdvice), not the
  whole line's advice, and the table (FlowTable.vue) lists the same lines. Under an input row of
  extracted Water, the line's Water Extractors end that line (#1024), which has no ♻ when no
  byproduct covers any of it ("No byproduct covers it: extract all of it. Water Extractors …").
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate } from '../../flow.ts';
import type { FlowLine, FlowRow } from '../../group-flow.ts';
import { num } from '../../format.ts';
import {
  destinationsText,
  isLaneLink,
  lineNumber,
  sourcesText,
  type FlowNames,
} from '../../views/group-flow-page.ts';
import { machineLine } from '../../views/factories.ts';
import { flowAdvice, type FlowAdvice } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';
import { power } from '../../wizard/fields.ts';
import { factoryLink } from '../actions.ts';

const props = defineProps<{
  line: FlowLine;
  group: string;
  names: FlowNames;
  running: boolean;
  hot: boolean;
}>();

const machines = computed(() => {
  const line = props.line;
  const all = machineLine(line.machines, line.machine, line.lastClock);
  // A split row: the group's share of the machines.
  return line.share < 1 - 1e-6 ? `≈ ${num(line.machinesHere)} of ${all}` : all;
});
// An input row fed from outside the group and by no other line of it (#908). A self link is
// neither, so a row fed only by its own line gets no bar.
const fromOutside = (row: FlowRow) =>
  row.links.some(link => link.from.kind === 'place') && !row.links.some(isLaneLink);
const loops = (row: FlowRow) => row.links.some(link => link.loop);
// The byproduct advice for the group's part of this line, by item: for its byproducts (`out`)
// and for its inputs a byproduct covers or that are extracted Water (`in`).
const advice = computed(() =>
  legacy(() => {
    const byItem = { in: new Map<string, FlowAdvice>(), out: new Map<string, FlowAdvice>() };
    for (const line of flowAdvice(props.line.id, props.group))
      byItem[line.side].set(line.item, line);
    return byItem;
  }),
);
</script>

<template>
  <article :class="['gf-card', hot ? 'hot' : '']" :data-line="line.id">
    <div class="gf-head">
      <span class="chain-no">{{ lineNumber(line.no) }}</span
      ><button type="button" class="rail-link" v-bind="factoryLink({ calcFactory: line.id })">
        {{ line.name }} ↗</button
      ><span :class="['gf-run', running ? 'on' : '']">{{
        running ? '● Running' : '○ Not built'
      }}</span>
    </div>
    <div class="small muted">{{ machines }}</div>
    <div class="gf-io">
      <div
        v-for="row in line.inputs"
        :key="row.id"
        :class="['gf-row', 'gf-in', fromOutside(row) ? 'outside' : '']"
        :data-row="row.id"
      >
        <span class="gf-item"
          ><span class="gf-name">← {{ row.item }}</span>
          <small v-if="loops(row)" class="chain-loop">loop · seed a starter batch</small>
          <small class="muted">{{ sourcesText(row.links, names) }}</small
          ><small v-if="advice.in.has(row.item)" class="gf-advice" data-advice="input"
            >{{ advice.in.get(row.item)!.recycled ? '♻ ' : ''
            }}{{ advice.in.get(row.item)!.text }}</small
          ></span
        ><span class="gf-num"
          ><b>{{ itemRate(row.item, row.rate) }}</b
          ><small>{{ row.belts }}</small></span
        >
      </div>
      <div v-for="row in line.outputs" :key="row.id" class="gf-row gf-out" :data-row="row.id">
        <span class="gf-item"
          ><span class="gf-name">→ {{ row.item }}</span>
          <small class="muted">{{ destinationsText(row.links, names) }}</small
          ><small v-if="advice.out.has(row.item)" class="gf-advice" data-advice="byproduct"
            >♻ {{ advice.out.get(row.item)!.text }}</small
          ></span
        ><span class="gf-num"
          ><b>{{ itemRate(row.item, row.rate) }}</b
          ><small>{{ row.belts }}</small></span
        >
      </div>
      <div v-if="line.mw" class="gf-row gf-out">
        <span class="gf-item"><span class="gf-name">→ Power grid</span></span
        ><span class="gf-num"
          ><b>{{ power(line.mw) }}</b></span
        >
      </div>
    </div>
  </article>
</template>
