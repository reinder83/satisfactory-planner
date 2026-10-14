<!--
  The "recipe ↗" dialog of the wizard's alternate recipe picker: the alternate beside the
  standard recipe(s) for its first output, so the two can be compared. Rates are one machine
  at 100%, per minute, with the inputs at the draft's recipe part cost (#1161), as the plan takes
  them.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { recipeCostOf } from '../../../preferences.ts';
import { wizard, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import DialogFrame from './DialogFrame.vue';
import RecipePanel from './RecipePanel.vue';
import type { RecipeView } from '../../flow.ts';
import type { CatalogRecipe } from '../../../types/index.ts';

const props = defineProps<{ id: string }>();

const panel = (recipe: CatalogRecipe, cost: number): RecipeView => ({
  name: recipe.name.replace('Alternate: ', ''),
  machine: recipe.machine,
  ins: Object.entries(recipe.inputs || {}).map(([item, rate]) => [item, rate * cost]),
  outs: Object.entries(recipe.outputs || {}),
});

const view = computed(() =>
  legacy(() => {
    const alternate = (workspace.catalog.alternates || []).find(a => a.id === props.id);
    if (!alternate) return null;
    const primary = Object.keys(alternate.outputs)[0];
    const cost = recipeCostOf(wizard?.settings ?? {});
    return {
      name: alternate.name,
      subtitle: alternate.mam
        ? `MAM research · unlocked in the MAM, not from hard drives · ${alternate.machine}`
        : alternate.milestone
          ? `Tier ${alternate.milestone} milestone · unlocked at the HUB, not from hard drives · ${alternate.machine}`
          : `Alternate recipe · available from Phase ${alternate.phase} · ${alternate.machine}`,
      primary,
      recipe: panel(alternate, cost),
      standards: (workspace.catalog.standardRecipes || [])
        .filter(r => r.outputs[primary ?? ''])
        .map(recipe => panel(recipe, cost)),
    };
  }),
);
</script>

<template>
  <DialogFrame v-if="view" :title="view.name" :subtitle="view.subtitle" :icon="view.primary">
    <RecipePanel :recipe="view.recipe" />
    <template v-if="view.standards.length"
      ><h3>
        Standard {{ view.standards.length > 1 ? 'recipes' : 'recipe' }} for {{ view.primary }}
      </h3>
      <RecipePanel v-for="(standard, i) in view.standards" :key="i" :recipe="standard"
    /></template>
    <p v-else class="small muted">No standard recipe produces {{ view.primary }}.</p>
    <p class="small muted">
      Rates are per machine at 100%, per minute. Alternates are unlocked with hard drives in game;
      ticking a recipe is a planning allowance, not an in-game unlock.
    </p>
  </DialogFrame>
</template>
