<!--
  All settings step 4, resource budgets: one "limit:<resource>" box per raw resource, the
  button that opens the node survey (ui/pages/SurveyPage.vue) to work them out, the
  phaseMining box (#1065: each phase's budgets follow its miners and belts) with what each
  phase would get, and the limitsConfirmed box, which maximum output needs. The phaseMining box
  is read with the form like every other field; its table follows the box as it is ticked. With
  it ticked, "Miners you already have" (#1068, ownedMiner, data-owned-miner) raises every phase's
  miner to the mark chosen, and "Belts you already have" (#1068, ownedBelt, data-owned-belt) every
  phase's belt; the table follows both choices too.
<script setup lang="ts">
import { computed, ref } from 'vue';
import { BELT_MARKS, resourceDefaults } from '../../../preferences.ts';
import { num } from '../../format.ts';
import { budgetShareWords, phaseBudgetRows } from '../../../mining.ts';
import { draft, workspace } from '../../session.ts';
import { openExtraction } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';
import StepHeading from '../form/StepHeading.vue';

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return {
      description: resourceDefaults(settings.purity, settings.distribution).description,
      seed: settings.worldSeed ? 'Recorded seed: ' + settings.worldSeed + '. ' : '',
      limits: workspace.catalog.raw.map(name => ({ name, value: settings.limits[name] })),
      confirmed: !!settings.limitsConfirmed,
      // Each phase from the profile's start phase: its miner, belts and pipes, and its share of
      // these budgets (the share does not depend on the amounts, only on the nodes behind them).
      phases: phaseBudgetRows(
        { ...settings, ownedMiner: ownedMiner.value, ownedBelt: ownedBelt.value },
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
// The miner chosen on screen under it (#1068), for the same table: 2, 3 or undefined.
const ownedMiner = ref<number | undefined>(draft().settings.ownedMiner);
function chooseMiner(event: Event) {
  ownedMiner.value = Number((event.target as HTMLSelectElement).value) || undefined;
}
// "Follow the phases", then each mark the phases would otherwise reach only later.
const MINER_CHOICES = [
  ['', 'None beyond what each phase unlocks'],
  ['2', 'Miner Mk.2'],
  ['3', 'Miner Mk.3'],
] as const;
// The belt chosen on screen beside it (#1068), for the same table: 3 to 6, or undefined.
const ownedBelt = ref<number | undefined>(draft().settings.ownedBelt);
function chooseBelt(event: Event) {
  ownedBelt.value = Number((event.target as HTMLSelectElement).value) || undefined;
}
// "Follow the phases", then each belt Phase 1 does not already have, with what one carries.
const BELT_CHOICES = [
  ['', 'None beyond what each phase unlocks'],
  ...BELT_MARKS.filter(belt => belt.tier > 2).map(
    belt => [belt.mark.slice(3), `${belt.mark} belts (${num(belt.cap)}/min)`] as const,
  ),
] as const;
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
  <div class="resource-inputs">
    <InputField
      v-for="limit in view.limits"
      :key="limit.name"
      :label="limit.name"
      :name="'limit:' + limit.name"
      :value="limit.value"
      min="0"
      max="10000000"
      step="any"
      required
    />
  </div>
  <label class="check-row"
    ><input
      name="phaseMining"
      type="checkbox"
      :checked="perPhase"
      @change="perPhase = ($event.target as HTMLInputElement).checked"
    />Each phase's budgets follow the miners and belts it can build</label
  >
  <label v-if="perPhase" class="field owned-miner"
    >Miners you already have
    <select
      name="ownedMiner"
      data-owned-miner
      :value="ownedMiner ? String(ownedMiner) : ''"
      @change="chooseMiner"
    >
      <option v-for="[value, label] in MINER_CHOICES" :key="value" :value="value">
        {{ label }}
      </option>
    </select></label
  >
  <label v-if="perPhase" class="field owned-belt"
    >Belts you already have
    <select
      name="ownedBelt"
      data-owned-belt
      :value="ownedBelt ? String(ownedBelt) : ''"
      @change="chooseBelt"
    >
      <option v-for="[value, label] in BELT_CHOICES" :key="value" :value="value">
        {{ label }}
      </option>
    </select></label
  >
  <div v-if="perPhase" class="table-wrap phase-budgets" data-phase-budgets>
    <table>
      <caption class="small muted">
        These budgets are the most any phase draws. Each phase gets what its miner, clock and belts
        take from the same nodes: crude oil from Phase 3, resource wells from Phase 4, and
        overclocking from Phase 4, with Power Shards from Power Slugs. A miner or belt you already
        have raises every phase's to its mark; a node survey's miner and clock cap every phase's.
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
  <label class="check-row"
    ><input name="limitsConfirmed" type="checkbox" :checked="view.confirmed" />I have checked these
    budgets for my save (required for maximum output)</label
  >
</template>
