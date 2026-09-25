<!-- One item cell of a recipe panel: [item, rate, link]. A link makes the cell a button that
     opens the factory making the item. The pseudo item 'MW' is a generator's output. -->
<script setup lang="ts">
import { num3 } from '../../format.ts';
import { FLUIDS } from '../../flow.ts';
import ItemIcon from '../ItemIcon.vue';
import { factoryLink } from '../actions.ts';
import type { RecipeCellData } from '../../flow.ts';

withDefaults(defineProps<{ cell: RecipeCellData; out?: boolean }>(), { out: false });
</script>

<template>
  <component
    :is="cell[2] ? 'button' : 'div'"
    :class="['rail-cell', out ? 'out' : '']"
    v-bind="factoryLink(cell[2])"
    ><ItemIcon v-if="cell[0] !== 'MW'" :name="cell[0]" /><span class="rail-main"
      ><b>{{ num3(cell[1]) }}{{ FLUIDS.has(cell[0]) ? ' m³' : cell[0] === 'MW' ? ' MW' : '' }}</b
      ><small>{{ cell[0] === 'MW' ? 'Power generation' : cell[0] }}</small></span
    ></component
  >
</template>
