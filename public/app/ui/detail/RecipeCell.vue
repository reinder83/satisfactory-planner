<!-- One item cell of a recipe panel: [item, rate, link]. A link makes the cell a button that
     opens the factory making the item. The pseudo item 'MW' is a generator's output. -->
<script setup>
import { num3 } from '../../format.js';
import { FLUIDS } from '../../flow.js';
import ItemIcon from '../ItemIcon.vue';
import { factoryLink } from '../actions.js';

defineProps({
  cell: { type: Array, required: true },
  out: { type: Boolean, default: false },
});
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
