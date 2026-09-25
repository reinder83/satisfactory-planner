<!--
  The "recipe ↗" dialog of the wizard's alternate recipe picker: the alternate beside the
  standard recipe(s) for its first output, so the two can be compared. Rates are one machine
  at 100%, per minute.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import DialogFrame from './DialogFrame.vue';
import RecipePanel from './RecipePanel.vue';
import type { RecipeView } from '../../flow.ts';
import type { CatalogRecipe } from '../../../types/index.ts';

const props = defineProps<{ id: string }>();

const panel = (rc: CatalogRecipe): RecipeView => ({
  name: rc.name.replace('Alternate: ', ''),
  machine: rc.machine,
  ins: Object.entries(rc.inputs || {}),
  outs: Object.entries(rc.outputs || {}),
});

const view = computed(() =>
  legacy(() => {
    const a = (workspace.catalog.alternates || []).find(x => x.id === props.id);
    if (!a) return null;
    const primary = Object.keys(a.outputs)[0];
    return {
      name: a.name,
      subtitle: a.mam
        ? `MAM research · unlocked in the MAM, not from hard drives · ${a.machine}`
        : `Alternate recipe · available from Phase ${a.phase} · ${a.machine}`,
      primary,
      recipe: panel(a),
      standards: (workspace.catalog.standardRecipes || [])
        .filter(r => r.outputs[primary ?? ''])
        .map(panel),
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
      <RecipePanel v-for="(r, i) in view.standards" :key="i" :recipe="r"
    /></template>
    <p v-else class="small muted">No standard recipe produces {{ view.primary }}.</p>
    <p class="small muted">
      Rates are per machine at 100%, per minute. Alternates are unlocked with hard drives in game;
      ticking a recipe is a planning allowance, not an in-game unlock.
    </p>
  </DialogFrame>
</template>
