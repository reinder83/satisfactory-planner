<!--
  All settings step 5, Review, drawn from the calculated preview (never missing here: moving
  to step 5 always calculates). Phases before the profile's start phase are left out. Then
  what was credited from production you already run, whether fueled augmenters pay off, the
  options for each phase that does not fit, the calculation's assumptions and, when adding a
  profile to a save, the carry-over panel.
-->
<script setup>
import { computed } from 'vue';
import { num } from '../../format.js';
import { wizard } from '../../session.js';
import { draftFixes } from '../../views/calculated.js';
import { power } from '../../wizard/fields.js';
import { legacy } from '../bridge.js';
import CarryPanel from './CarryPanel.vue';
import FuelVerdict from './FuelVerdict.vue';
import SupplyNotice from './SupplyNotice.vue';

const view = computed(() =>
  legacy(() => {
    const w = wizard,
      p = w.preview;
    if (!p) return null;
    const from = Number(p.settings.phase || 1);
    const stages = Object.entries(p.stages).filter(([ph]) => Number(ph) >= from);
    return {
      name: w.name,
      plan: p,
      rows: stages.map(([ph, x]) => ({
        phase: ph,
        hours: x.hours ? num(x.hours) + ' h' : '—',
        was: x.aheadOf !== undefined ? num(x.aheadOf) : '',
        buildings: x.rows ? num(x.rows.reduce((a, r) => a + r.machines, 0)) : '—',
        generation: x.generationMW !== undefined ? power(x.generationMW) : '—',
        budget: x.feasible ? 'Within entered limits' : 'Needs adjustment',
      })),
      drafts: stages
        .filter(([, x]) => !x.feasible)
        .map(([ph, x]) => ({ phase: ph, reason: x.reason, fixes: draftFixes(x, p.settings) })),
      warnings: p.warnings,
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
          <tr v-for="r in view.rows" :key="r.phase">
            <td>{{ r.phase }}</td>
            <td>
              {{ r.hours
              }}<template v-if="r.was"
                >{{ ' ' }}<span class="badge">was {{ r.was }} h</span></template
              >
            </td>
            <td>{{ r.buildings }}</td>
            <td>{{ r.generation }}</td>
            <td>{{ r.budget }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <SupplyNotice :plan="view.plan" /><FuelVerdict :plan="view.plan" />
    <div v-for="d in view.drafts" :key="d.phase" class="notice">
      <b>Phase {{ d.phase }}:</b> {{ d.reason
      }}<template v-if="d.fixes.length"
        ><p><b>Options</b></p>
        <ul>
          <li v-for="f in d.fixes" :key="f">{{ f }}</li>
        </ul></template
      >
    </div>
    <details class="panel">
      <summary>Assumptions and calculation limits</summary>
      <p v-for="(x, i) in view.warnings" :key="i" class="small">{{ x }}</p>
    </details>
    <p class="small muted">
      You can save a plan that exceeds your budgets as a planning draft; its affected phases remain
      clearly flagged. Profiles are calculated snapshots. Create another profile to compare
      different settings.
    </p>
    <CarryPanel />
  </template>
</template>
