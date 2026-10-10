<!--
  All settings step 4, resource budgets: one "limit:<resource>" box per raw resource, the
  button that opens the node survey (ui/pages/SurveyPage.vue) to work them out, the
  phaseMining box (#1065: each phase's budgets follow its miners and belts) with what each
  phase would get, and the limitsConfirmed box, which maximum output needs (the budget boxes and
  the confirmation are BudgetInputs.vue and BudgetConfirm.vue, which the guided start's budget
  screen for maximum output shares, #1072). The phaseMining box is read with the form like every other field; its table follows the box as it is ticked. With
  it ticked, "Miners you already have" (#1068, ownedMiner, data-owned-miner) raises every phase's
  miner to the mark chosen, and "Belts you already have" (#1068, ownedBelt, data-owned-belt) every
  phase's belt (both in OwnedEquipment.vue, which the guided start shares); the table follows both
  choices too. Under them all, "Generators you already have" (#1068, OwnedGenerators.vue,
  settings.ownedGenerators), whatever the box says: their fuel comes from these budgets.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { resourceDefaults } from '../../../preferences.ts';
import { budgetShareWords, phaseBudgetRows } from '../../../mining.ts';
import { draft } from '../../session.ts';
import { openExtraction } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import StepHeading from '../form/StepHeading.vue';
import BudgetConfirm from './BudgetConfirm.vue';
import BudgetInputs from './BudgetInputs.vue';
import OwnedEquipment from './OwnedEquipment.vue';
import OwnedGenerators from './OwnedGenerators.vue';

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return {
      description: resourceDefaults(settings.purity, settings.distribution).description,
      seed: settings.worldSeed ? 'Recorded seed: ' + settings.worldSeed + '. ' : '',
      // Each phase from the profile's start phase: its miner, belts and pipes, and its share of
      // these budgets (the share does not depend on the amounts, only on the nodes behind them).
      phases: phaseBudgetRows(
        {
          ...settings,
          ownedMiner: ownedMiner.value,
          ownedBelt: ownedBelt.value,
          overclock: overclock.value,
        },
        Number(settings.phase || 1),
      ).map(row => ({
        phase: row.phase,
        equipment: row.equipment,
        share: budgetShareWords(row),
      })),
    };
  }),
);
// Whether the phaseMining box is ticked on screen, for the table under it.
const perPhase = ref(!!draft().settings.phaseMining);
// The miner and belt chosen on screen under it (#1068), for the same table: a miner 2 or 3, a belt
// 3 to 6, or undefined.
const ownedMiner = ref<number | undefined>(draft().settings.ownedMiner);
const ownedBelt = ref<number | undefined>(draft().settings.ownedBelt);
// "I can overclock" (#1137, settings.overclock), for the same table.
const overclock = ref(!!draft().settings.overclock);
</script>

<template>
  <StepHeading :step="4" :total="5">Available resource budgets</StepHeading>
  <p>
    <button type="button" class="btn primary" data-open-extraction @click="openExtraction()">
      Work these out from my nodes →
    </button>
    <span class="small muted"
      >Count what your world holds and the planner turns it into these rates.</span
    >
  </p>
  <p>
    Enter the extraction you can allocate to this new plan, per minute, after existing factories and
    power fuel. Starter values are full-map estimates at endgame extraction, not resources already
    connected.
  </p>
  <div class="notice info">
    {{ view.description }}
    {{ view.seed
    }}<a href="https://satisfactoryworldseed.com/" target="_blank" rel="noreferrer"
      >Look up your seed totals</a
    >
    ·
    <a href="https://satisfactory.wiki.gg/wiki/Resource_Node" target="_blank" rel="noreferrer"
      >Node reference</a
    >. Resource-rich counts cannot be filled accurately without your seed: enter the lookup totals
    below. Oil-well extraction may be added after its unlock.
  </div>
  <BudgetInputs />
  <label class="check-row"
    ><input
      name="phaseMining"
      type="checkbox"
      :checked="perPhase"
      @change="perPhase = ($event.target as HTMLInputElement).checked"
    />Each phase's budgets follow the miners and belts it can build</label
  >
  <OwnedEquipment
    v-if="perPhase"
    v-model:miner="ownedMiner"
    v-model:belt="ownedBelt"
    v-model:overclock="overclock"
  />
  <label v-if="perPhase" class="check-row water-overclock"
    ><input
      type="checkbox"
      name="waterOverclock"
      data-water-overclock
      :checked="!!draft().settings.waterOverclock"
    /><span
      >Overclock Water Extractors too<br /><small class="muted"
        >Off: they plan at 100%, since you can always build more of them. On: up to the miners'
        clock, with Power Shards.</small
      ></span
    ></label
  >
  <div v-if="perPhase" class="table-wrap phase-budgets" data-phase-budgets>
    <table>
      <caption class="small muted">
        These budgets are the most any phase draws. Each phase gets what its miner, clock and belts
        take from the same nodes: crude oil from Phase 3 and resource wells from Phase 4. Miners and
        extractors run up to 250% once you can overclock (Power Shards researched in the MAM), and
        from Phase 4 in any case, never more than their belt or pipe carries. A miner or belt you
        already have raises every phase's to its mark; a node survey's miner and clock cap every
        phase's.
      </caption>
      <thead>
        <tr>
          <th scope="col">Phase</th>
          <th scope="col">Miner, belts and pipes</th>
          <th scope="col">Of these budgets</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in view.phases" :key="row.phase">
          <th scope="row">{{ row.phase }}</th>
          <td>{{ row.equipment }}</td>
          <td class="number">{{ row.share }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else class="small muted">
    Off: every phase plans with these budgets as entered, whatever miners and belts it can build.
  </p>
  <OwnedGenerators />
  <BudgetConfirm />
</template>
