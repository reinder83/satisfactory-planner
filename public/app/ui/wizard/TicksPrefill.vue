<!--
  Edit settings (#1071) of a profile whose ticks show more than its plan counts (#1068, "ticks
  keep it current"): startEdit (wizard/wizard.ts) starts "What you already have" from the ticks
  (ownedFromTicks and withOwnedFound in owned-ticks.ts), and this note says which fields it raised
  and on which step each is, so the user can see or undo them before Review. Nothing is
  recalculated until "Recalculate in place". Draws nothing for any other draft.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { alternatesPhrase } from '../../owned-ticks.ts';
import { wizard } from '../../session.ts';
import { listNames } from '../../../wording.ts';
import { legacy } from '../bridge.ts';

const parts = computed(() =>
  legacy(() => {
    const words = wizard?.edit?.fromTicks;
    if (!words) return null;
    const list = [
      ...(words.unlocked.length ? [`${listNames(words.unlocked)} (step 4, Resources)`] : []),
      ...(words.alternates.length
        ? [`${alternatesPhrase(words.alternates)} (step 2, Preferences)`]
        : []),
      ...(words.generators.length ? [`${listNames(words.generators)} (step 4, Resources)`] : []),
    ];
    return list.length ? listNames(list) : null;
  }),
);
</script>

<template>
  <p v-if="parts" class="notice info" data-ticks-prefill>
    <strong>What you already have starts from your ticks:</strong> {{ parts }}. Review shows what
    changes; nothing is recalculated until you press Recalculate in place.
  </p>
</template>
