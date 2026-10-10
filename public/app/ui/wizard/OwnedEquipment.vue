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

  "I can overclock" (#1137, settings.overclock, data-owned-overclock): Power Shards researched in
  the MAM, so every phase plans its miners and extractors up to 250%, a node's belt or pipe capping
  them. Drawn with a hidden `overclockAsked` field, since an unticked box is absent from the form;
  with `phase`, only where it changes that phase (Phases 1 to 3).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { BELT_MARKS, phaseBelt, phaseClock, phaseMiner } from '../../../preferences.ts';
import { num } from '../../format.ts';

const props = defineProps<{ miner?: number; belt?: number; overclock?: boolean; phase?: number }>();
const emit = defineEmits<{
  'update:miner': [value: number | undefined];
  'update:belt': [value: number | undefined];
  'update:overclock': [value: boolean];
}>();
// Whether "I can overclock" changes the plan: always on step 4, from a start phase only before
// Phase 4, which plans 250% anyway.
const overclockShown = computed(
  () => !props.phase || phaseClock(props.phase, true) > phaseClock(props.phase),
);

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
  <label v-if="overclockShown" class="check-row owned-overclock"
    ><input type="hidden" name="overclockAsked" value="1" /><input
      type="checkbox"
      name="overclock"
      data-owned-overclock
      :checked="!!overclock"
      @change="emit('update:overclock', ($event.target as HTMLInputElement).checked)"
    /><span
      >I can overclock<br /><small class="muted"
        >Power Shards researched in the MAM (Overclock Production): miners and oil extractors plan
        up to 250%, never more than their belt or pipe carries, so fewer nodes give the same
        ore.</small
      ></span
    ></label
  >
</template>
