<!--
  All settings step 5, Review, drawn from the calculated preview (never missing here: moving
  to step 5 always calculates), with each phase's power as every page gives it (powerView in
  public/power.ts, #1064) and, with mining per phase (#1065), the miner and belts its budgets
  follow. Phases before the profile's start phase are left out. Then
  what was credited from production you already run, whether fueled augmenters pay off, what
  whole machines cost against exact clocks (RoundingCost.vue, #1066), the
  options for each phase that does not fit, the calculation's assumptions, "What you already have"
  (AlreadyHave.vue, #1068) and, when adding a profile to a save, the carry-over panel.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { durationOfHours, num } from '../../format.ts';
import { draft } from '../../session.ts';
import { budgetMeasured, draftFixes, draftHeading } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { powerView } from '../../../power.ts';
import { minerWords } from '../../../mining.ts';
import { legacy } from '../bridge.ts';
import CarryPanel from './CarryPanel.vue';
import AlreadyHave from './AlreadyHave.vue';
import type { StoredSettings, StoredStage } from '../../../types/index.ts';
import FuelVerdict from './FuelVerdict.vue';
import RoundingCost from '../plan/RoundingCost.vue';
import SupplyNotice from './SupplyNotice.vue';
import StepHeading from '../form/StepHeading.vue';

// A number keeps its unit on its line in the narrow Delivery time column (#741): "about 7 h
// 52 min" may wrap after "about" or between "h" and "52", never between "7" and "h".
const unbroken = (text: string): string => text.replace(/(\d) /g, '$1\u00a0');

// The New generation and Power needed columns (#1064): the generators the phase builds, and what
// it needs of what it has, or what it is short, as the Resources page's bar, the headroom notice
// and the power step give them. Phase 1 runs on biomass, which the plan leaves to the player. A
// plan made before #1064 shows its generators' output as it always did.
function powerCells(phase: string, stageResult: StoredStage, settings: StoredSettings) {
  const generation = stageResult.generationMW !== undefined ? power(stageResult.generationMW) : '—';
  if (!stageResult.rows) return { generation, power: { text: '—', short: false } };
  const view = powerView(stageResult, settings);
  return {
    generation: view.modelled ? power(view.generationMW) : generation,
    power:
      view.shortMW > 0 && phase === '1'
        ? { text: `${power(view.needMW)} from biomass`, short: false }
        : view.shortMW > 0
          ? { text: `Short by ${power(view.shortMW)} of ${power(view.needMW)}`, short: true }
          : { text: `${power(view.needMW)} of ${power(view.availableMW)}`, short: false },
  };
}

// The buildings of a stage's storage-only lines (#1061), or '' for none.
function stockBuildings(stageResult: StoredStage): string {
  const count = (stageResult.rows || [])
    .filter(row => row.stock)
    .reduce((sum, row) => sum + row.machines, 0);
  return count ? num(count) : '';
}

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      preview = wizardDraft.preview;
    if (!preview) return null;
    const from = Number(preview.settings.phase || 1);
    const stages = Object.entries(preview.stages).filter(([phase]) => Number(phase) >= from);
    return {
      name: wizardDraft.name,
      plan: preview,
      rows: stages.map(([phase, stageResult]) => ({
        phase,
        hours: stageResult.hours ? unbroken(durationOfHours(stageResult.hours)) : '—',
        was:
          stageResult.aheadOf !== undefined ? unbroken(durationOfHours(stageResult.aheadOf)) : '',
        buildings: stageResult.rows
          ? num(stageResult.rows.reduce((sum, row) => sum + row.machines, 0))
          : '—',
        // Of those, the storage-only lines' (#1061): optional, the stocked choice's own cost.
        stock: stockBuildings(stageResult),
        ...powerCells(phase, stageResult, preview.settings),
        // A stopped search or an older saved plan measured no budget: a neutral draft (#632).
        // With mining per phase (#1065) the budgets are the phase's, from its miner and belts.
        budget: stageResult.feasible
          ? stageResult.mining
            ? `Within ${minerWords(stageResult.mining.miner)} on ${stageResult.mining.belt.mark} belts`
            : 'Within entered limits'
          : budgetMeasured(stageResult)
            ? 'Needs adjustment'
            : 'Planning draft',
      })),
      drafts: stages
        .filter(([, stageResult]) => !stageResult.feasible)
        .map(([phase, stageResult]) => ({
          phase,
          heading: draftHeading(stageResult, phase),
          reason: stageResult.reason,
          fixes: draftFixes(stageResult, preview.settings),
        })),
      warnings: preview.warnings,
      // What whole machines cost in each phase listed (#1066).
      rounding: stages.map(([phase, stageResult]) => ({ phase, stage: stageResult })),
    };
  }),
);
</script>

<template>
  <template v-if="view">
    <StepHeading :step="5" :total="5">Review {{ view.name }}</StepHeading>
    <p>Nothing has been created yet. Your other profiles and their progress stay intact.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Budget</th>
            <th>Delivery time</th>
            <th>Buildings</th>
            <th>New generation</th>
            <th>Power needed</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.rows" :key="row.phase">
            <td>{{ row.phase }}</td>
            <td>{{ row.budget }}</td>
            <td>
              {{ row.hours
              }}<template v-if="row.was"
                >{{ ' ' }}<span class="badge">was {{ row.was }}</span></template
              >
            </td>
            <td>
              {{ row.buildings
              }}<template v-if="row.stock"
                >{{ ' '
                }}<span class="badge" data-review-stock
                  >{{ row.stock }} for storage, optional</span
                ></template
              >
            </td>
            <td>{{ row.generation }}</td>
            <td :class="row.power.short ? 'warn' : undefined" data-review-power>
              {{ row.power.text }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="view.rows.some(row => row.stock)" class="small muted" data-review-stock-note>
      Protected storage takes each phase’s surplus first. The buildings marked for storage are the
      storage-only lines for items with no surplus: optional, built last, at exact clocks.
    </p>
    <SupplyNotice :plan="view.plan" /><FuelVerdict :plan="view.plan" />
    <RoundingCost :entries="view.rounding" layout="table" />
    <div v-for="phaseDraft in view.drafts" :key="phaseDraft.phase" class="notice warn">
      <b>{{ phaseDraft.heading }}</b> {{ phaseDraft.reason
      }}<template v-if="phaseDraft.fixes.length"
        ><p><b>Options</b></p>
        <ul>
          <li v-for="fix in phaseDraft.fixes" :key="fix">{{ fix }}</li>
        </ul></template
      >
    </div>
    <details class="panel">
      <summary>Assumptions and calculation limits</summary>
      <p v-for="(warning, i) in view.warnings" :key="i" class="small">{{ warning }}</p>
    </details>
    <p class="small muted">
      You can save a plan that exceeds your budgets as a planning draft; its affected phases remain
      clearly flagged. Profiles are calculated snapshots. Create another profile to compare
      different settings.
    </p>
    <AlreadyHave /><CarryPanel />
  </template>
</template>
