<!--
  One line of a factory group's flow page (#894): its number, name (a link to the factory's
  dialog; "Wire for Alpha" for a group's own line made on site, as in the build plan, #896),
  whether it runs, its machines, then one column of rows, the inputs (←) before the
  outputs (→), each with its item, where it comes from or goes, its rate and, under the rate,
  the belts or pipes it takes. Every row reaches the card's left border, where the page draws
  the lanes: a row's name (.gf-name) is what its dot or arrowhead points at, and each row
  carries its id in the flow as data-row. An input row fed from outside the group and by no
  other line of it has a blue side bar instead of an arrow; one fed only by itself has neither.
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
import { power } from '../../wizard/fields.ts';
import { factoryLink } from '../actions.ts';
import { calcStage } from '../../session.ts';
import { byproductAdvice, inputAdvice, type AdviceLine } from '../../recycle.ts';
import { recycleContext } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';

const props = defineProps<{ line: FlowLine; names: FlowNames; running: boolean; hot: boolean }>();

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
// MOCK-UP (#1022, #1024): the dialog's byproduct and Water advice for this line, per item.
const advice = computed(() =>
  legacy(() => {
    const row = calcStage()?.rows?.find(r => r.id === props.line.id);
    const context = recycleContext();
    const byItem = { in: new Map<string, string>(), out: new Map<string, string>() };
    if (!row || !context) return byItem;
    const text = (line: AdviceLine) =>
      line.parts.map(part => (typeof part === 'string' ? part : part.text)).join('') +
      (line.extract ? ' ' + line.extract : '');
    for (const line of byproductAdvice(row, context)) byItem.out.set(line.item, text(line));
    for (const line of inputAdvice(row, context)) byItem.in.set(line.item, text(line));
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
          <small class="muted">{{ sourcesText(row.links, names) }}</small>
          <small v-if="advice.in.get(row.item)" class="gf-advice">{{
            advice.in.get(row.item)
          }}</small></span
        ><span class="gf-num"
          ><b>{{ itemRate(row.item, row.rate) }}</b
          ><small>{{ row.belts }}</small></span
        >
      </div>
      <div v-for="row in line.outputs" :key="row.id" class="gf-row gf-out" :data-row="row.id">
        <span class="gf-item"
          ><span class="gf-name">→ {{ row.item }}</span>
          <small class="muted">{{ destinationsText(row.links, names) }}</small>
          <small v-if="advice.out.get(row.item)" class="gf-advice">{{
            advice.out.get(row.item)
          }}</small></span
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
