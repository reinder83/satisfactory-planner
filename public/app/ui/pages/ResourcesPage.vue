<!--
  #resources for the original handbook, at the current stage: power tiles, the fresh
  resource table against plan.capacities, and the power commissioning checklist, whose boxes
  write the saved check keys `power-…` (toggleCheck in ui/actions.ts).
  A calculated profile gets CalculatedResourcesPage.vue instead. Much of
  the text (coal limit, rocket-fuel blocks, nuclear sequence) describes the owner's handbook
  and is fixed copy.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { checked, plan, stage } from '../../session.ts';
import { resourceUse } from '../../views/resources.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import PageHeader from '../PageHeader.vue';
import StatTile from '../StatTile.vue';
import { toggleCheck } from '../actions.ts';

// The handbook's power commissioning steps: saved check key, label.
const POWER_STEPS: [id: string, title: string][] = [
  ['power-retained', 'Retained turbofuel: 44.425 GW'],
  ['power-rocket-1', 'Rocket-fuel block 1: +72 GW'],
  ['power-rocket-2', 'Rocket-fuel block 2: +72 GW'],
  ['power-u4', 'Phase 4 uranium: +125 GW'],
  ...Array.from({ length: 4 }, (_, i): [string, string] => [
    'power-rocket-' + (i + 3),
    'Rocket-fuel block ' + (i + 3) + ': +72 GW',
  ]),
  ['power-nuclear-final', 'Complete nuclear fleet: 437.5 GW total'],
];

// null for a stage the handbook has no plan for (Phase 1 or 2, which only a calculated profile
// can be at): until render() swaps this page out, it draws nothing rather than throwing (#354).
const page = computed(() =>
  legacy(() => {
    const resources = plan.resources[stage()],
      p = plan.plans[stage()];
    if (!resources || !p) return null;
    return {
      power: num(plan.power[stage()]) + ' GW',
      peak: num(p.manufacturingPeakGW) + ' GW',
      average: num(p.manufacturingAvgGW) + ' GW',
      coal: num(74400 - resources.Coal!) + '/min',
      nitrogen: num(resources['Nitrogen Gas'] || 0),
      rows: Object.entries(resources)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, q]) => {
          // The same use figure and bar as a calculated profile's page (views/resources.ts).
          const cap = plan.capacities[name],
            u = cap ? resourceUse(q, cap) : null;
          return {
            name,
            required: num(q),
            available: cap ? num(cap) : name === 'Water' ? 'Extraction limited' : 'Verify wells',
            remaining: cap ? num(cap - q) : '—',
            tight: !!u?.tight,
            over: !!u?.over,
            use: u?.use ?? null,
            bar: u?.bar ?? 0,
          };
        }),
      steps: POWER_STEPS.map(([id, title]) => ({ id, title, done: checked(id) })),
    };
  }),
);
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="CAPACITY BEFORE CONSTRUCTION"
      title="Power & resources"
      subtitle="These are planned full-stage requirements, not live readings from your save. Mining totals already include retained turbofuel, trucks and all new power."
    />
    <div class="stats">
      <StatTile label="Gross generation" :value="page.power" caption="At this stage’s completion" />
      <StatTile label="Production peak" :value="page.peak" caption="Before the utility allowance" />
      <StatTile
        label="Production average"
        :value="page.average"
        caption="Half-consumption setting"
      />
      <StatTile label="Coal remaining" :value="page.coal" caption="Against all-pure mining limit" />
    </div>
    <div class="notice warn">
      Verify your randomized nitrogen wells can supply <b>{{ page.nitrogen }}/min</b> at this stage.
      The all-pure resource limits assume fully developed extraction and logistics. Additional
      completion modules are not included.
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Fresh resource</th>
            <th scope="col">Required /min</th>
            <th scope="col">Available /min</th>
            <th scope="col">Remaining /min</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in page.rows" :key="r.name">
            <td class="resource-name">
              <ItemIcon :name="r.name" /><span>{{ r.name }}</span>
            </td>
            <td class="number">{{ r.required }}</td>
            <td class="number">{{ r.available }}</td>
            <td :class="['number', r.tight ? 'warn' : '']">{{ r.remaining }}</td>
            <td>
              <template v-if="r.use"
                >{{ r.use }}
                <div
                  :class="['resource-bar', r.over ? 'over' : r.tight ? 'tight' : '']"
                  aria-hidden="true"
                >
                  <span :style="{ width: r.bar + '%' }"></span></div
              ></template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      Crude availability counts 30 ordinary pure nodes; oil wells are additional. Water includes a
      2,000/min reserve for retained turbofuel and resin processing.
    </p>
    <div class="backup-grid" style="margin-top: 24px">
      <section class="panel">
        <h2>Power commissioning</h2>
        <div class="checklist">
          <label v-for="s in page.steps" :key="s.id" class="check-row"
            ><input type="checkbox" :data-check="s.id" @change="toggleCheck" :checked="s.done" />{{
              s.title
            }}</label
          >
        </div>
      </section>
      <section class="panel">
        <h2>One 72 GW rocket-fuel block</h2>
        <p><b>Inputs/min:</b> 300 Crude, 800 Sulfur, 400 Coal, 600 Nitrogen and 1,000 Water.</p>
        <p>
          10 Heavy Oil Residue refineries → 8 Diluted Fuel blenders → 8 Nitro Rocket Fuel blenders.
          Add 5 Residual Rubber refineries and 288 Fuel Generators at 100%.
        </p>
        <p class="small muted">
          Produces 1,200 Rocket Fuel, 200 Compacted Coal and 100 Rubber/min. These byproducts are
          not credited against other factory contracts.
        </p>
        <div class="notice info">
          At Phase 5: (579.231 × 1.2 + 20) ÷ 0.8 ≈ <b>894 GW</b> preliminary requirement. Planned
          gross capacity: <b>913.925 GW</b>. Replace the 20 GW existing-load allowance with your
          measured load.
        </div>
      </section>
    </div>
    <section class="panel" style="margin-top: 24px">
      <h2>Nuclear sequence</h2>
      <p>
        Phase 4: 50 uranium reactors generate 500 waste/min. Process it into 2.5 Plutonium Fuel
        Rods/min and sink those rods.
      </p>
      <p>
        Phase 5: 100 uranium reactors → 1,000 Uranium Waste/min → 5 Plutonium Fuel Rods/min → 50
        plutonium reactors → 50 Plutonium Waste/min → 25 Ficsonium Fuel Rods/min → 25 Ficsonium
        reactors.
      </p>
      <p class="small muted">
        Build downstream processing and burning capacity first. Final reactor cooling needs 42,000
        Water/min, already included in the resource table. Keep radioactive buffers at the nuclear
        site.
      </p>
    </section>
  </template>
</template>
