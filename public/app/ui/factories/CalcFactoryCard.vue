<!--
  A calculated production row's card. Its Running box writes `calc-<stage>-<row id>`, the same
  key as the row's build-plan step; its name opens the calculated factory dialog (factoryLink()
  in ui/actions.ts), and so does a click anywhere else on the card (SP-19: the name's hit area
  covers it, under the Running box and the group editor). A power-generation row leads with the power it makes (GW
  above 1000 MW), says in words that it feeds the grid, with an accent edge (#374), and
  measures its group share in MW; a nuclear plant's waste is listed below like any other
  output (#371), and its group share is that waste with the power it stands for (#374). The
  same structure as FactoryCard.vue (SP-14): the main output with its unit as the headline,
  machines and the adjustable machine's clock on the line below it, then any other outputs.
  A line at exact clocks in a whole-machine plan says so, and so does one whose clocks a
  recalculation would change (lineClockNote in app/exact-clocks.ts, #1066).
  The chip at the top says whether it runs, runs from the phase before with how many machines
  (#1069), or is held back by a missing supplier with the
  reason above the footer (RunningChip.vue, SP-15); it follows the Running box.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate, rateOfItem, rateUnit, unitGap } from '../../flow.ts';
import { num } from '../../format.ts';
import { lineClockNote } from '../../exact-clocks.ts';
import { calculated, checked, factoryEditing, stage, state } from '../../session.ts';
import { carriedCard, heldBack, machineSetup, rowIcon } from '../../views/calculated.ts';
import {
  allocationText,
  factoryGroupsState,
  machineLine,
  siteGroupName,
} from '../../views/factories.ts';
import { power, powerParts } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import AssignEditor from './AssignEditor.vue';
import RunningChip from './RunningChip.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import type { CalcRow } from '../../../types/index.ts';

// group is the factory group this card sits in, or null outside the groups.
const props = withDefaults(defineProps<{ row: CalcRow; group?: string | null }>(), {
  group: null,
});

const card = computed(() =>
  legacy(() => {
    const row = props.row,
      outputs = Object.entries(row.outputs || {}),
      [main, total = 0] = outputs[0] || [],
      check = 'calc-' + stage() + '-' + row.id,
      setup = machineSetup(row),
      generator = row.generationMW > 0,
      // A group's share of the row, as a rate: its main output, or a generator's power, in GW
      // above 1,000 MW like the headline (#380). The share
      // is worked out on the first output, as group-links.ts does, so a fixed rate saved for a
      // nuclear plant keeps its meaning: its waste, with the power that stands for (#374).
      share =
        !main || !total
          ? (rate: number) => power(rate)
          : generator
            ? (rate: number) =>
                `${rateOfItem(main, rate)} (${power((rate / total) * row.generationMW)})`
            : (rate: number) => itemRate(main, rate);
    return {
      check,
      done: checked(check),
      // Built at the site that uses it, as a plan guide says (#468).
      local: !!calculated?.guide?.factories?.[row.id]?.local,
      // A generator shows its building, not its waste (#350).
      icon: rowIcon(row),
      // A generator's power, even when it also makes waste (#371), else the main output; a fluid
      // in m³/min, as the dialog's summary line says it (#351).
      headline:
        generator || !main
          ? powerParts(row.generationMW)
          : { value: num(total), unit: rateUnit(main) },
      machines: machineLine(row.machines, row.machine, setup.partial ? setup.clock : 100),
      // The outputs by name, unless the headline already says all of it: one output that
      // gives the row its name. A generator's headline is its power, so its waste is listed.
      outputs:
        generator || outputs.length > 1 || (outputs[0] && outputs[0][0] !== row.name)
          ? outputs.map(([item, rate]) => `${item}: ${itemRate(item, rate)}`)
          : [],
      allocation: props.group
        ? allocationText(row.id, props.group, total || row.generationMW, row.machines, share)
        : '',
      // A factory group's own line made on site (#876) names its group. It belongs wholly to that
      // group while the group exists, so the group editor is not offered for it then.
      site: row.onSite ? 'Made on site for ' + siteGroupName(row) : '',
      // A line at exact clocks in a whole-machine plan, or one a recalculation would change (#1066).
      clocks: calculated ? lineClockNote(calculated, state, stage(), row.id) : '',
      editing:
        factoryEditing &&
        !factoryGroupsState().groups.some(group => group.id === row.onSite?.group),
      generator,
      // The group editor's unit (AssignEditor.vue, #374): a fixed rate is in the first output, as
      // the share is, so a nuclear plant's is its waste, with the MW each one stands for; an
      // output-less generator's is in MW. A production line keeps the editor's own wording.
      rateUnit: !generator
        ? undefined
        : main && total
          ? { name: main, mw: row.generationMW / total }
          : { name: 'MW' },
      // A line not ticked here that runs from the phase before: "Running since Phase 1: 2 of 5
      // machines" (#1069), and that phase for the chip.
      carried: carriedCard(row),
      // A row marked running that a missing supplier holds back (build-status.ts, #66).
      held: (() => {
        const hold = heldBack(row.id);
        return hold ? `Running at ${Math.round(hold.share * 100)}%: short of ${hold.shortOf}` : '';
      })(),
    };
  }),
);
</script>

<template>
  <article :class="['factory-card', card.done ? 'done' : '', card.generator ? 'generator' : '']">
    <RunningChip
      :status="card.held ? 'held' : card.done ? 'running' : card.carried ? 'carried' : 'idle'"
      :from="card.carried?.from"
    />
    <div class="card-top">
      <span class="card-icon"><ItemIcon v-if="card.icon" :name="card.icon" /></span>
      <div class="card-main">
        <button class="name" v-bind="factoryLink({ calcFactory: row.id })">{{ row.name }}</button>
        <div class="output">
          {{ card.headline.value }}{{ unitGap(card.headline.unit)
          }}<span>{{ card.headline.unit }}</span>
        </div>
        <div class="small machines">{{ card.machines }}</div>
        <div v-if="card.generator" class="small generates" data-generates>
          <span aria-hidden="true">⚡︎</span> Generates power for the grid
        </div>
      </div>
      <span v-if="card.local" class="badge" data-local>Local</span>
    </div>
    <div v-if="card.outputs.length" class="recipe">
      <template v-for="(output, i) in card.outputs" :key="i"><br v-if="i" />{{ output }}</template>
    </div>
    <div v-if="card.site" class="small allocation" data-on-site>{{ card.site }}</div>
    <div v-if="card.clocks" class="small allocation" data-exact-clocks>{{ card.clocks }}</div>
    <div v-if="card.allocation" class="small allocation">{{ card.allocation }}</div>
    <div v-if="card.held" class="small build-held" data-build-held>{{ card.held }}</div>
    <div v-if="card.carried" class="small build-carried" data-carried>
      {{ card.carried.text }}
    </div>
    <footer>
      <label class="check-row"
        ><input
          type="checkbox"
          :data-check="card.check"
          @change="toggleCheck"
          :checked="card.done"
        />Running</label
      >
    </footer>
    <AssignEditor v-if="card.editing" :factory-key="row.id" :unit="card.rateUnit" />
  </article>
</template>
