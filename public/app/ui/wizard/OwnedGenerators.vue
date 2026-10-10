<!--
  "Generators you already have" (#1068, settings.ownedGenerators, data-owned-generators): one
  count per kind of generator (OWNED_GENERATORS in preferences/fuels.ts) that the start phase has
  unlocked, under All settings step 4's budgets (ResourcesStep.vue) and on the guided start's
  "What you already have" (ui/guided/GuidedHave.vue). A kind the start phase has not unlocked yet
  is listed only while the draft has a count for it, so a count is never hidden.

  Each phase counts them among the generators it runs where it plans that building
  (carryGenerators in public/power.ts), so fewer are left to build; their fuel stays in the
  budgets. Biomass Burners shorten the build plan's burner bank. Every field starts empty, and the
  counts are read with the form (readOwnedGenerators in wizard/wizard.ts): an empty or zero field
  leaves its kind out, and none leaves the setting out.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { OWNED_GENERATORS, OWNED_GENERATORS_MAX } from '../../../preferences.ts';
import { num } from '../../format.ts';
import { draft } from '../../session.ts';
import { legacy } from '../bridge.ts';

// The start phase whose unlocked kinds to offer; the draft's when not given.
const props = defineProps<{ phase?: number }>();

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings,
      phase = props.phase ?? Number(settings.phase || 1),
      owned = settings.ownedGenerators || {};
    return OWNED_GENERATORS.filter(
      kind => kind.phase <= phase || (owned[kind.machine] ?? 0) > 0,
    ).map(kind => ({
      machine: kind.machine,
      label: kind.machine + 's',
      each: `${num(kind.mw)} MW each`,
      value: owned[kind.machine] ?? '',
    }));
  }),
);
</script>

<template>
  <section class="owned-generators" data-owned-generators aria-labelledby="owned-generators-title">
    <h3 id="owned-generators-title">Generators you already have</h3>
    <p class="small muted">
      Each phase counts these among the generators it runs where it plans that kind, so you build
      only the rest. They still burn fuel from your resource budgets. Biomass Burners count toward
      the start-up burner bank. Generators you keep fed outside this plan are spare power instead:
      enter what they give as Spare existing power.
    </p>
    <div class="owned-generator-inputs">
      <label v-for="kind in view" :key="kind.machine" class="field"
        >{{ kind.label }} <small>{{ kind.each }}</small
        ><input
          type="number"
          :name="'ownedGenerator:' + kind.machine"
          :data-owned-generator="kind.machine"
          :value="kind.value"
          min="0"
          :max="OWNED_GENERATORS_MAX"
          step="1"
          inputmode="numeric"
          placeholder="0"
      /></label>
    </div>
  </section>
</template>
