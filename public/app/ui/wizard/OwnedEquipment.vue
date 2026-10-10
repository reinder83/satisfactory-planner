<!--
  "Miners you already have" (ownedMiner, data-owned-miner) and "Belts you already have" (ownedBelt,
  data-owned-belt), #1068: the two selects All settings step 4 draws under the phaseMining box
  (ResourcesStep.vue) and the guided start's "What you already have" (ui/guided/GuidedHave.vue).
  Each starts with "None beyond what each phase unlocks", then the marks a phase would otherwise
  reach only later. The fields are read with the form (readOwnedEquipment in wizard/wizard.ts); the
  chosen values also come back through v-model, for step 4's table.

  With `phase` (the guided start), only the marks better than that start phase's own are offered,
  as only those change the plan, and the one chosen stays listed; a select left with nothing to
  offer is not drawn. Without it, every mark, as step 4 always offered.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { BELT_MARKS, phaseBelt, phaseMiner } from '../../../preferences.ts';
import { num } from '../../format.ts';

const props = defineProps<{ miner?: number; belt?: number; phase?: number }>();
const emit = defineEmits<{
  'update:miner': [value: number | undefined];
  'update:belt': [value: number | undefined];
}>();

const NONE = ['', 'None beyond what each phase unlocks'] as const;
// The marks a player may already have beyond Phase 1's: Miner Mk.2 and Mk.3, belts Mk.3 to Mk.6.
const MINERS = [2, 3].map(mark => [mark, `Miner Mk.${mark}`] as const);
const BELTS = BELT_MARKS.filter(belt => belt.tier > 2).map(
  belt => [Number(belt.mark.slice(3)), `${belt.mark} belts (${num(belt.cap)}/min)`] as const,
);

// The choices to list: all of them, or from a start phase on those better than its own.
const listed = (
  choices: readonly (readonly [number, string])[],
  own: number | undefined,
  chosen: number | undefined,
) =>
  [NONE, ...choices.filter(([mark]) => own === undefined || mark > own || mark === chosen)].map(
    ([value, label]) => [String(value), label] as const,
  );
const miners = computed(() =>
  listed(MINERS, props.phase ? phaseMiner(props.phase).mark : undefined, props.miner),
);
const belts = computed(() =>
  listed(BELTS, props.phase ? Number(phaseBelt(props.phase).mark.slice(3)) : undefined, props.belt),
);

const chosen = (event: Event) => Number((event.target as HTMLSelectElement).value) || undefined;
</script>

<template>
  <label v-if="miners.length > 1" class="field owned-miner"
    >Miners you already have
    <select
      name="ownedMiner"
      data-owned-miner
      :value="miner ? String(miner) : ''"
      @change="emit('update:miner', chosen($event))"
    >
      <option v-for="[value, label] in miners" :key="value" :value="value">
        {{ label }}
      </option>
    </select></label
  >
  <label v-if="belts.length > 1" class="field owned-belt"
    >Belts you already have
    <select
      name="ownedBelt"
      data-owned-belt
      :value="belt ? String(belt) : ''"
      @change="emit('update:belt', chosen($event))"
    >
      <option v-for="[value, label] in belts" :key="value" :value="value">
        {{ label }}
      </option>
    </select></label
  >
</template>
