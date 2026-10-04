<!--
  MOCK-UP (#1022, #1024): in a calculated factory's dialog, under the flow, where the line's
  byproducts go and where its recycled inputs come from, with the Water Extractors for the Water
  no byproduct covers (recycle.ts). Draws nothing when the line has neither.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage } from '../../session.ts';
import { byproductAdvice, inputAdvice } from '../../recycle.ts';
import { recycleContext } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';

const props = defineProps<{ id: string }>();

const lines = computed(() =>
  legacy(() => {
    const row = calcStage()?.rows?.find(r => r.id === props.id);
    const context = recycleContext();
    if (!row || !context) return [];
    return [...byproductAdvice(row, context), ...inputAdvice(row, context)];
  }),
);
</script>

<template>
  <template v-if="lines.length"
    ><h3>Byproducts and water</h3>
    <div class="notice info recycle-advice" data-recycle-advice>
      <p v-for="line in lines" :key="line.kind + line.item">
        <b>{{ line.kind === 'byproduct' ? 'Byproduct · ' : 'Input · ' }}{{ line.lead }}</b
        ><br /><template v-for="(part, i) in line.parts" :key="i"
          ><template v-if="typeof part === 'string'">{{ part }}</template
          ><button
            v-else
            type="button"
            class="rail-link"
            v-bind="factoryLink({ calcFactory: part.row })"
            v-text="part.text + ' ↗'"
          ></button></template
        ><template v-if="line.extract"><br />{{ line.extract }}</template>
      </p>
    </div></template
  >
</template>
