<!-- The "Recipe · …" panel: what one machine makes at 100%, per minute. `recipe` is { name,
     machine, ins, outs } with ins and outs as RecipeCell tuples; `machines` is how many such
     machines the line runs. -->
<script setup>
import { machinesLabel } from '../../flow.ts';
import RecipeCell from './RecipeCell.vue';

defineProps({
  recipe: { type: Object, required: true },
  machines: { type: Number, default: 1 },
});
</script>

<template>
  <div class="rail-recipe">
    <div class="rail-recipe-head">
      <span>Recipe · {{ recipe.name }}</span
      ><span>what {{ machinesLabel(machines, recipe.machine) }} makes @ 100% · per minute</span>
    </div>
    <div class="rail-recipe-body">
      <div class="rail-recipe-ins">
        <template v-if="recipe.ins.length"
          ><RecipeCell v-for="c in recipe.ins" :key="c[0]" :cell="c"
        /></template>
        <div v-else class="rail-cell">
          <span class="rail-main"><small>No belt or pipe inputs</small></span>
        </div>
      </div>
      <span class="rail-recipe-arrow">→</span>
      <div class="rail-recipe-outs">
        <RecipeCell v-for="c in recipe.outs" :key="c[0]" :cell="c" out />
      </div>
    </div>
  </div>
</template>
