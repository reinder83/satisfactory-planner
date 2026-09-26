<!--
  A calculated production row's card. Its Running box writes `calc-<stage>-<row id>`, the same
  key as the row's build-plan step; its name and "Details ↗" open the calculated factory dialog
  (factoryLink() in ui/actions.ts). A power-generation row has no outputs, so its group
  share is measured in MW.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { checked, factoryEditing, stage } from '../../session.ts';
import { currentBuildStatus } from '../../views/calculated.ts';
import { allocationText } from '../../views/factories.ts';
import { power } from '../../wizard/fields.ts';
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
      total = Object.values(r.outputs || {})[0] || 0,
      check = 'calc-' + stage() + '-' + r.id;
    return {
      check,
      done: checked(check),
      icon: Object.keys(r.outputs)[0],
      machines: num(r.machines),
      outputs: Object.entries(r.outputs).map(([n, q]) => `${n}: ${num(q)}/min`),
      power: power(r.generationMW),
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
        const s = currentBuildStatus()?.rows.find(x => x.id === r.id);
        return s?.built && s.share < 1 && s.shortOf
          ? `Running at ${Math.round(s.share * 100)}%: short of ${s.shortOf}`
          : '';
      })(),
    };
  }),
);
</script>

<template>
  <article class="factory-card">
    <div class="card-top">
      <span class="card-icon"><ItemIcon v-if="card.icon" :name="card.icon" /></span>
      <div class="card-main">
        <button class="name" v-bind="factoryLink({ calcFactory: row.id })">{{ row.name }}</button>
        <div class="output">
          {{ card.machines }} <span>{{ row.machine }}</span>
        </div>
      </div>
    </div>
    <p>
      <template v-if="card.outputs.length"
        ><template v-for="(o, i) in card.outputs" :key="i"
          ><br v-if="i" />{{ o }}</template
        ></template
      ><template v-else>{{ card.power }}</template>
    </p>
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
