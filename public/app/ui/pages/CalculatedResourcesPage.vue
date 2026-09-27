<!--
  #resources on a calculated profile, for the current phase: the draft and headroom notices,
  power tiles (somersloop and augmenter tiles only when the plan uses them), raw resources
  against the entered budgets (settings.limits), then a panel of icon rows each for drone fuel,
  vehicle fuel (when the plan has any), protected storage, credited existing production and
  surplus (SP-28), and one for conversions. Everything reads the profile's frozen
  calculation snapshot; nothing here recalculates.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { calcStage, calculated, workspace } from '../../session.ts';
import { resourceUse, tightestFirst } from '../../views/resources.ts';
import { itemRateRows } from '../../views/storage.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import PageHeader from '../PageHeader.vue';
import CalcWarnings from '../plan/CalcWarnings.vue';
import StatTile from '../StatTile.vue';

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    const x = calcStage();
    if (!calculated || !x) return null;
    const s = calculated.settings;
    return {
      generation: power(x.generationMW),
      peak: power(x.peakMW),
      required: power(x.requiredMW),
      utility: (s.utilityPercent ?? 20) + '% for transport and utilities; verify actual load',
      spare: power(s.availablePowerGW * 1000),
      sloops: (x.sloopsUsed ?? 0) > 0 ? num(x.sloopsUsed) : '',
      augmented: (x.augmenters ?? 0) > 0 && {
        value: power(x.availableMW),
        caption:
          num(x.augmenters) +
          ' augmenter' +
          ((x.augmenters ?? 0) > 1 ? 's' : '') +
          ' · ' +
          num(x.augmenterMW) +
          ' MW plus ' +
          // Plans with augmenters have their boost too.
          Math.round(x.boost! * 100) +
          '% of base production',
      },
      // Tightest first (SP-27): over budget, then by use, and resources this phase does not
      // draw on last; the catalogue order breaks ties.
      rows: (workspace.catalog.raw || [])
        .map(n => {
          // The plan's limits hold every raw resource.
          const required = x.raw?.[n] || 0,
            budget = s.limits[n]!;
          return {
            ...resourceUse(required, budget),
            name: n,
            required: num(required),
            budget: num(budget),
            remaining: num(budget - required),
          };
        })
        .sort(tightestFirst),
      // Each item list is its own panel of icon rows (SP-28); an empty one keeps its sentence.
      // Vehicle fuel shows only when the plan burns some on its group links.
      lists: [
        {
          id: 'drone',
          title: 'Dedicated drone fuel',
          rows: itemRateRows(x.drone || {}),
          empty: 'No dedicated drone fuel in this phase.',
        },
        {
          id: 'transport',
          title: 'Vehicle fuel for group links',
          rows: itemRateRows(x.transport || {}),
          empty: '',
        },
        {
          id: 'storage',
          title: 'Protected storage',
          rows: itemRateRows(x.storage || {}),
          empty: 'No storage production requested.',
        },
        {
          id: 'supplied',
          title: 'From production you already run',
          rows: itemRateRows(x.supplied || {}),
          empty: 'None credited in this phase.',
        },
        {
          id: 'surplus',
          title: 'Surplus solids',
          rows: itemRateRows(x.surplus || {}),
          empty: 'None',
        },
      ].filter(l => l.rows.length || l.empty),
      credited: Object.keys(x.supplied || {}).length > 0,
      conversions: x.conversions || [],
      plutonium: num(x.plutoniumSink),
    };
  }),
);
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="CHECK BEFORE EXPANDING"
      title="Power & resources"
      subtitle="New production and new generator fuel are included. Existing fuel consumption must already be deducted from your entered budgets."
    />
    <CalcWarnings />
    <div class="stats">
      <StatTile
        label="New generation"
        :value="page.generation"
        caption="Fuel and recycling included"
      />
      <StatTile
        label="Whole-machine peak"
        :value="page.peak"
        caption="At selected consumption multiplier"
      />
      <StatTile label="With utility allowance" :value="page.required" :caption="page.utility" />
      <StatTile
        label="Existing spare power"
        :value="page.spare"
        caption="Not total installed generation"
      />
      <StatTile
        v-if="page.sloops"
        label="Somersloops in production"
        :value="page.sloops"
        caption="Amplified machines: double output, four times the power"
      />
      <StatTile
        v-if="page.augmented"
        label="With augmenter boost"
        :value="page.augmented.value"
        :caption="page.augmented.caption"
      />
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">Required /min</th>
            <th scope="col">Budget /min</th>
            <th scope="col">Remaining</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in page.rows" :key="r.name" :class="r.idle ? 'muted' : undefined">
            <td class="resource-name">
              <ItemIcon :name="r.name" /><span>{{ r.name }}</span>
            </td>
            <td class="number">{{ r.required }}</td>
            <td class="number">{{ r.budget }}</td>
            <td :class="['number', r.over ? 'warn' : '']">{{ r.remaining }}</td>
            <td :class="r.over ? 'warn' : undefined" data-use>
              {{ r.use }}
              <div
                :class="['resource-bar', r.over ? 'over' : r.tight ? 'tight' : '']"
                aria-hidden="true"
              >
                <span :style="{ width: r.bar + '%' }"></span>
              </div>
              <div v-if="r.over" class="small" data-over>
                <span aria-hidden="true">⚠ </span>Over by {{ r.overBy }}/min
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      Sorted by use, tightest first. Resources this phase does not draw on are listed last.
    </p>
    <div class="backup-grid">
      <section v-for="l in page.lists" :key="l.id" class="panel" :data-rate-list="l.id">
        <h2>{{ l.title }}</h2>
        <ul
          v-if="l.rows.length"
          class="supply-summary"
          :data-transport-fuel="l.id === 'transport' || undefined"
        >
          <li v-for="r in l.rows" :key="r.name">
            <ItemIcon :name="r.name" aria-hidden="true" /><span
              ><b>{{ r.name }}</b> {{ r.rate }}</span
            >
          </li>
        </ul>
        <p v-else>{{ l.empty }}</p>
        <p v-if="l.id === 'supplied' && page.credited" class="small muted">
          The plan does not build these lines or the chain behind them. Their extraction is assumed
          to be outside the budgets above.
        </p>
      </section>
      <section class="panel" data-conversions>
        <h2>Conversion and byproducts</h2>
        <p>
          <template v-if="page.conversions.length"
            ><template v-for="(c, i) in page.conversions" :key="i"
              ><br v-if="i" />{{ c }}</template
            ></template
          ><template v-else>No raw-resource conversion required.</template>
        </p>
        <p>Plutonium rods to sink: {{ page.plutonium }}/min.</p>
        <p class="small muted">
          Liquid and radioactive material balances are enforced. Do not let storage or overflow
          block recycling.
        </p>
      </section>
    </div>
  </template>
</template>
