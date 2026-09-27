<!--
  A calculated production row's card. Its Running box writes `calc-<stage>-<row id>`, the same
  key as the row's build-plan step; its name and "Details ↗" open the calculated factory dialog
  (factoryLink() in ui/actions.ts). A power-generation row has no outputs, so its headline and
  its group share are measured in MW (GW above 1000 MW). The same structure as FactoryCard.vue
  (SP-14): the main output with its unit as the headline, machines and the adjustable machine's
  clock on the line below it, then any other outputs.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { checked, factoryEditing, stage } from '../../session.ts';
import { heldBack, machineSetup } from '../../views/calculated.ts';
import { allocationText, machineLine } from '../../views/factories.ts';
import { powerParts } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import AssignEditor from './AssignEditor.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import type { CalcRow } from '../../../types/index.ts';

// group is the factory group this card sits in, or null outside the groups.
const props = withDefaults(defineProps<{ row: CalcRow; group?: string | null }>(), {
  group: null,
});

const card = computed(() =>
  legacy(() => {
    const r = props.row,
      outputs = Object.entries(r.outputs || {}),
      total = outputs[0]?.[1] || 0,
      check = 'calc-' + stage() + '-' + r.id,
      setup = machineSetup(r),
      mw = powerParts(r.generationMW);
    return {
      check,
      done: checked(check),
      icon: outputs[0]?.[0],
      // The main output, or a generator's power when the row makes no items.
      headline: outputs.length ? { value: num(total), unit: '/min' } : mw,
      machines: machineLine(r.machines, r.machine, setup.partial ? setup.clock : 100),
      // The outputs by name, unless the headline already says all of it: one output that
      // gives the row its name.
      outputs:
        outputs.length > 1 || (outputs[0] && outputs[0][0] !== r.name)
          ? outputs.map(([n, q]) => `${n}: ${num(q)}/min`)
          : [],
      allocation: props.group
        ? allocationText(
            r.id,
            props.group,
            total || r.generationMW,
            r.machines,
            total ? '/min' : ' MW',
          )
        : '',
      editing: factoryEditing,
      // A row marked running that a missing supplier holds back (build-status.ts, #66).
      held: (() => {
        const h = heldBack(r.id);
        return h ? `Running at ${Math.round(h.share * 100)}%: short of ${h.shortOf}` : '';
      })(),
    };
  }),
);
</script>

<template>
  <article :class="['factory-card', card.done ? 'done' : '']">
    <div class="card-top">
      <span class="card-icon"><ItemIcon v-if="card.icon" :name="card.icon" /></span>
      <div class="card-main">
        <button class="name" v-bind="factoryLink({ calcFactory: row.id })">{{ row.name }}</button>
        <div class="output">
          {{ card.headline.value }} <span>{{ card.headline.unit }}</span>
        </div>
        <div class="small machines">{{ card.machines }}</div>
      </div>
    </div>
    <div v-if="card.outputs.length" class="recipe">
      <template v-for="(o, i) in card.outputs" :key="i"><br v-if="i" />{{ o }}</template>
    </div>
    <div v-if="card.allocation" class="small allocation">{{ card.allocation }}</div>
    <div v-if="card.held" class="small build-held" data-build-held>{{ card.held }}</div>
    <footer>
      <label class="check-row"
        ><input
          type="checkbox"
          :data-check="card.check"
          @change="toggleCheck"
          :checked="card.done"
        />Running</label
      ><button class="btn quiet" v-bind="factoryLink({ calcFactory: row.id })">Details ↗</button>
    </footer>
    <AssignEditor v-if="card.editing" :factory-key="row.id" />
  </article>
</template>
