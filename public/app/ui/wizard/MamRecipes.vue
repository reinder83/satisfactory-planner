<!--
  The MAM recipes box (#1058, settings.mamRecipes) on All settings step 2, under every Recipe
  access choice, and on the guided recipes question beside the picker of "I will choose them
  myself". Turbofuel, Compacted Coal and Polyester Fabric are researched in the MAM, not bought
  with hard drives, so they are their own setting and the alternate picker does not list them.
  Read with the step by readMamRecipes (wizard/wizard.ts): ticked is true, unticked false.

  Ticked unless the draft says otherwise. A draft from a plan made before the box (no field)
  shows what that plan did (mamRecipesShown in wizard/recipes.ts): on for Standard and All, and
  for a custom plan on when it picked one of them.
  A turbofuel power route keeps Turbofuel and Compacted Coal whatever the box says, which the
  note under it says when the box is off.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { draft } from '../../session.ts';
import { mamRecipesShown } from '../../wizard/recipes.ts';
import { legacy } from '../bridge.ts';

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return {
      on: mamRecipesShown(settings),
      turbofuel: !['auto', 'coal', 'fuel'].includes(settings.mainPower || 'auto'),
    };
  }),
);
// The box as it is ticked on screen, for the note under it; from the draft whenever it changes.
const on = ref(view.value.on);
watch(
  () => view.value.on,
  value => (on.value = value),
);
</script>

<template>
  <div class="mam-recipes" data-mam-recipes>
    <label class="check-row"
      ><input
        name="mamRecipes"
        type="checkbox"
        :checked="on"
        data-mam-recipes-box
        @change="on = ($event.target as HTMLInputElement).checked"
      /><span
        ><b>Use the MAM recipes once researched</b><br /><small class="muted"
          >Turbofuel, Compacted Coal and Polyester Fabric come from MAM research, not hard drives,
          so the plan may use them whatever Recipe access says.</small
        ></span
      ></label
    >
    <p v-if="!on && view.turbofuel" class="small muted" data-mam-recipes-kept>
      Your preferred main power burns turbofuel, so the plan keeps Turbofuel and Compacted Coal.
    </p>
  </div>
</template>
