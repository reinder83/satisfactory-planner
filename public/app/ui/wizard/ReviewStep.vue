<!--
  All settings step 5, Review, drawn from the calculated preview (never missing here: moving
  to step 5 always calculates). Phases before the profile's start phase are left out. Then
  what was credited from production you already run, whether fueled augmenters pay off, the
  options for each phase that does not fit, the calculation's assumptions and, when adding a
  profile to a save, the carry-over panel.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { draft } from '../../session.ts';
import { draftFixes } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import CarryPanel from './CarryPanel.vue';
import FuelVerdict from './FuelVerdict.vue';
import SupplyNotice from './SupplyNotice.vue';

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
        hours: stageResult.hours ? num(stageResult.hours) + ' h' : '—',
        was: stageResult.aheadOf !== undefined ? num(stageResult.aheadOf) : '',
        buildings: stageResult.rows
          ? num(stageResult.rows.reduce((sum, row) => sum + row.machines, 0))
          : '—',
        generation: stageResult.generationMW !== undefined ? power(stageResult.generationMW) : '—',
        budget: stageResult.feasible ? 'Within entered limits' : 'Needs adjustment',
      })),
      drafts: stages
        .filter(([, stageResult]) => !stageResult.feasible)
        .map(([phase, stageResult]) => ({
          phase,
          reason: stageResult.reason,
          fixes: draftFixes(stageResult, preview.settings),
        })),
      warnings: preview.warnings,
    };
  }),
);
</script>

<template>
  <template v-if="view">
    <h2>Review {{ view.name }}</h2>
    <p>Nothing has been created yet. Your other profiles and their progress stay intact.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Delivery time</th>
            <th>Buildings</th>
            <th>New generation</th>
            <th>Budget</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.rows" :key="row.phase">
            <td>{{ row.phase }}</td>
            <td>
              {{ row.hours
              }}<template v-if="row.was"
                >{{ ' ' }}<span class="badge">was {{ row.was }} h</span></template
              >
            </td>
            <td>{{ row.buildings }}</td>
            <td>{{ row.generation }}</td>
            <td>{{ row.budget }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <SupplyNotice :plan="view.plan" /><FuelVerdict :plan="view.plan" />
    <div v-for="phaseDraft in view.drafts" :key="phaseDraft.phase" class="notice warn">
      <b>Phase {{ phaseDraft.phase }}:</b> {{ phaseDraft.reason
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
    <CarryPanel />
  </template>
</template>
