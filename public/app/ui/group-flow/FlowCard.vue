<!--
  One step of a factory group's build order page (#894, #1346): its number, name (a link to the
  factory's dialog; "Wire for Alpha" for a group's own line made on site, as in the build plan,
  #896), its machines, then one column of rows, the inputs (←) before the outputs (→), each with
  its item, where it comes from or goes as chips (FlowChips.vue: "from 01" moves to that step,
  BO-2) and, on one line, its rate and the belts or pipes it takes ("525/min · 2 × Mk.4"). Each
  row carries its id in the flow as data-row. An input row fed from outside the group and by no
  other line of it has a blue side bar. Under a byproduct's output row, and under an input row a
  byproduct covers, a ♻ line repeats the factory dialog's advice (rowAdvice, #1022) as text, for
  the group's part of the line: a row split over several groups gets only what its part here
  sends and takes (flowAdvice), not the whole line's advice, and the table (FlowTable.vue) lists
  the same lines. Under an input row of extracted Water, the line's Water Extractors end that line
  (#1024), which has no ♻ when no byproduct covers any of it ("No byproduct covers it: extract all
  of it. Water Extractors …").

  On the phase on screen the card has the line's Built counter and a "Mark running" box (BO-4:
  BuiltCounter.vue and the factories card's own Running check, which write the same saved
  values), so a step is counted and ticked where it is read. Read-only (#1317): a card of a phase
  tab other than the phase on screen (`readonly`, with that phase's stage as `snapshot`) names
  its line as plain text, with no link to a dialog that would open the phase on screen's line,
  no counter and no box: they are the phase on screen's to tick.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate } from '../../flow.ts';
import type { CalcRow, StoredStage } from '../../../types/index.ts';
import type { FlowLine, FlowRow } from '../../group-flow.ts';
import { num } from '../../format.ts';
import { isLaneLink, linkChips, lineNumber, type FlowNames } from '../../views/group-flow-page.ts';
import { machineLine } from '../../views/factories.ts';
import { flowAdvice, type FlowAdvice } from '../../views/calculated.ts';
import { stage } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { power } from '../../wizard/fields.ts';
import { factoryLink, toggleCheck } from '../actions.ts';
import BuiltCounter from '../BuiltCounter.vue';
import FlowChips from './FlowChips.vue';

const props = defineProps<{
  line: FlowLine;
  group: string;
  names: FlowNames;
  // The plan row, set for the phase on screen only: the counter and box are drawn for it. `view`
  // is the phase tab open (null for the phase on screen), kept by the links to another factory.
  plan?: CalcRow | undefined;
  running: boolean;
  next: boolean;
  view: string | null;
  readonly?: boolean;
  snapshot?: StoredStage | undefined;
}>();
defineEmits<{ go: [line: string] }>();

const machines = computed(() => {
  const line = props.line;
  const all = machineLine(line.machines, line.machine, line.lastClock, line.clock);
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
    for (const line of flowAdvice(props.line.id, props.group, props.snapshot))
      byItem[line.side].set(line.item, line);
    return byItem;
  }),
);
// The Running check of this line in the phase on screen, as the factories card writes it.
const check = computed(() => legacy(() => `calc-${stage()}-${props.line.id}`));
</script>

<template>
  <article
    class="gf-card"
    :data-line="line.id"
    tabindex="-1"
    :aria-label="`Step ${lineNumber(line.no)}: ${line.name}`"
  >
    <div class="gf-head">
      <span class="chain-no">{{ lineNumber(line.no) }}</span
      ><span v-if="readonly" class="gf-line-name" data-gf-name>{{ line.name }}</span
      ><button
        v-else
        type="button"
        class="rail-link"
        v-bind="factoryLink({ calcFactory: line.id })"
      >
        {{ line.name }} ↗</button
      ><span v-if="next" class="gf-next" data-gf-next>Build next</span>
    </div>
    <div class="gf-sub">
      <span class="small muted">{{ machines }}</span>
      <BuiltCounter v-if="plan" :row="plan" :name="line.name" place="flow" />
    </div>
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
          <FlowChips
            :chips="linkChips(row.links, names, 'from')"
            :view="view"
            @go="$emit('go', $event)"
          /><small v-if="advice.in.has(row.item)" class="gf-advice" data-advice="input"
            >{{ advice.in.get(row.item)!.recycled ? '♻ ' : ''
            }}{{ advice.in.get(row.item)!.text }}</small
          ></span
        ><span class="gf-num"
          ><b>{{ itemRate(row.item, row.rate) }}</b
          ><small v-if="row.belts">· {{ row.belts }}</small></span
        >
      </div>
      <div v-for="row in line.outputs" :key="row.id" class="gf-row gf-out" :data-row="row.id">
        <span class="gf-item"
          ><span class="gf-name">→ {{ row.item }}</span>
          <FlowChips
            :chips="linkChips(row.links, names, 'to')"
            :view="view"
            @go="$emit('go', $event)"
          /><small v-if="advice.out.has(row.item)" class="gf-advice" data-advice="byproduct"
            >♻ {{ advice.out.get(row.item)!.text }}</small
          ></span
        ><span class="gf-num"
          ><b>{{ itemRate(row.item, row.rate) }}</b
          ><small v-if="row.belts">· {{ row.belts }}</small></span
        >
      </div>
      <div v-if="line.mw" class="gf-row gf-out">
        <span class="gf-item"><span class="gf-name">→ Power grid</span></span
        ><span class="gf-num"
          ><b>{{ power(line.mw) }}</b></span
        >
      </div>
    </div>
    <footer v-if="plan" class="gf-foot">
      <label class="check-row"
        ><input
          type="checkbox"
          :data-check="check"
          :aria-label="'Mark running: ' + line.name"
          :checked="running"
          @change="toggleCheck"
        />Mark running</label
      >
    </footer>
  </article>
</template>
