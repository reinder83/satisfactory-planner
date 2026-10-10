<!--
  The guided start's "What you already have" (#1068), right after the phase of a new save that
  starts after Phase 1 (guidedHaveQuestion, guidedFlow in wizard/guided.ts). One compact screen of
  choices the other screens already offer, all optional and off, so Continue leaves the profile
  as the guided start made it before:

  - "Everything before Phase N is done" (name="earlierDone"): Review's switch (AlreadyHave.vue),
    the draft's earlierDone, which Review then shows ticked and createProfile sends as the steps
    it ticks (alreadyHaveKeys).
  - The miner and belt you already have (OwnedEquipment.vue, All settings step 4's selects),
    only the marks better than the start phase's own. They count only with per-phase mining
    (settings.phaseMining, on for every new plan), as on step 4; without it the screen says where
    to turn it on rather than turning it on.
  - The generators you already have (OwnedGenerators.vue, All settings step 4's counts), the
    kinds the start phase has unlocked.
  - The alternates you already own (OwnedAlternates.vue, All settings step 2's picker).

  readHave in wizard/guided.ts reads it with the rest of the form, as those screens read theirs.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { draft } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { earlierPhasesWords } from '../../../progression.ts';
import OwnedAlternates from '../wizard/OwnedAlternates.vue';
import OwnedEquipment from '../wizard/OwnedEquipment.vue';
import OwnedGenerators from '../wizard/OwnedGenerators.vue';

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      phase = Number(wizardDraft.settings.phase || 1);
    return {
      phase,
      before: earlierPhasesWords(
        Array.from({ length: Math.max(phase - 1, 1) }, (_, i) => String(i + 1)),
      ),
      earlierDone: !!wizardDraft.earlierDone,
      mining: !!wizardDraft.settings.phaseMining,
    };
  }),
);
// The choices on screen, from the draft when the screen opens (the form is keyed by step).
const miner = ref<number | undefined>(draft().settings.ownedMiner);
const belt = ref<number | undefined>(draft().settings.ownedBelt);
</script>

<template>
  <div class="guided-have" data-guided-have>
    <label class="check-row"
      ><input
        type="checkbox"
        name="earlierDone"
        data-earlier-done
        :checked="view.earlierDone"
      /><span
        ><b>Everything before Phase {{ view.phase }} is done</b><br /><small class="muted"
          >Ticks the HUB milestones and MAM research listed under {{ view.before }}, so the plan
          opens on Phase {{ view.phase }}. You can untick any of them later.</small
        ></span
      ></label
    >
    <div v-if="view.mining" class="guided-have-gear">
      <OwnedEquipment v-model:miner="miner" v-model:belt="belt" :phase="view.phase" />
      <p v-if="view.phase >= 5" class="small muted">
        Phase 5 already plans with Miner Mk.3 and Mk.6 belts, the best there are.
      </p>
    </div>
    <p v-else class="small muted" data-guided-have-mining>
      Miners and belts you already have count only when each phase's budgets follow its miners and
      belts: All settings, step 4.
    </p>
    <OwnedGenerators :phase="view.phase" />
    <OwnedAlternates />
  </div>
</template>
