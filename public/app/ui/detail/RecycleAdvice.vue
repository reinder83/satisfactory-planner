<!--
  The byproduct advice in a calculated factory's dialog (#1022), under the flow: one paragraph
  per byproduct of the line (where to send it) and per input of the line a byproduct covers
  (where it comes from), from rowAdvice (views/calculated.ts, worded by recycle.ts) for the phase
  shown. Each other line it names is a link to that line's dialog (factoryLink). Group and line
  names are user text, rendered as text. Draws nothing for a line without either.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage } from '../../session.ts';
import { rowAdvice } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';

const props = defineProps<{ id: string }>();

const lines = computed(() =>
  legacy(() => {
    const row = calcStage()?.rows?.find(candidate => candidate.id === props.id);
    return row ? rowAdvice(row) : [];
  }),
);
</script>

<template>
  <template v-if="lines.length"
    ><h3>Byproducts</h3>
    <div class="notice info recycle-advice" data-recycle-advice>
      <p v-for="line in lines" :key="line.kind + '|' + line.item" :data-advice="line.kind">
        <b>{{ line.kind === 'byproduct' ? 'Byproduct' : 'Input' }} · {{ line.lead }}</b
        ><br /><template v-for="(part, i) in line.parts" :key="i"
          ><template v-if="typeof part === 'string'">{{ part }}</template
          ><button
            v-else
            type="button"
            class="recycle-link"
            v-bind="factoryLink({ calcFactory: part.row })"
            v-text="part.text + ' ↗'"
          ></button
        ></template>
      </p></div
  ></template>
</template>
