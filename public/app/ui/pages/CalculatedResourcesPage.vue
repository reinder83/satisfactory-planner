<!--
  #resources on a calculated profile, for the current phase: the draft and headroom notices,
  power tiles (somersloop and augmenter tiles only when the plan uses them), raw resources
  against the entered budgets (settings.limits), then drone fuel, protected storage, credited
  existing production, conversions and surplus. Everything reads the profile's frozen
  calculation snapshot; nothing here recalculates.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { calcStage, calculated, workspace } from '../../session.ts';
import { inputText } from '../../views/storage.ts';
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
      rows: (workspace.catalog.raw || []).map(n => ({
        name: n,
        required: num(x.raw?.[n]),
        budget: num(s.limits[n]),
        // The plan's limits hold every raw resource.
        remaining: num(s.limits[n]! - (x.raw?.[n] || 0)),
        over: (x.raw?.[n] || 0) > s.limits[n]!,
      })),
      drone: inputText(x.drone || {}) || 'No dedicated drone fuel in this phase.',
      transport: inputText(x.transport || {}),
      storage: inputText(x.storage || {}) || 'No storage production requested.',
      supplied: inputText(x.supplied || {}) || 'None credited in this phase.',
      credited: Object.keys(x.supplied || {}).length > 0,
      conversions: x.conversions || [],
      plutonium: num(x.plutoniumSink),
      surplus: inputText(x.surplus || {}) || 'None',
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
            <th>Resource</th>
            <th>Required /min</th>
            <th>Budget /min</th>
            <th>Remaining</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in page.rows" :key="r.name">
            <td class="resource-name">
              <ItemIcon :name="r.name" /><span>{{ r.name }}</span>
            </td>
            <td>{{ r.required }}</td>
            <td>{{ r.budget }}</td>
            <td :class="r.over ? 'warn' : ''">{{ r.remaining }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="backup-grid">
      <section class="panel">
        <h2>Dedicated drone fuel /min</h2>
        <p>{{ page.drone }}</p>
        <template v-if="page.transport"
          ><h2>Vehicle fuel for group links /min</h2>
          <p data-transport-fuel>{{ page.transport }}</p></template
        >
        <h2>Protected storage /min</h2>
        <p>{{ page.storage }}</p>
        <h2>From production you already run</h2>
        <p>{{ page.supplied }}</p>
        <p v-if="page.credited" class="small muted">
          The plan does not build these lines or the chain behind them. Their extraction is assumed
          to be outside the budgets above.
        </p>
      </section>
      <section class="panel">
        <h2>Conversion and byproducts</h2>
        <p>
          <template v-if="page.conversions.length"
            ><template v-for="(c, i) in page.conversions" :key="i"
              ><br v-if="i" />{{ c }}</template
            ></template
          ><template v-else>No raw-resource conversion required.</template>
        </p>
        <p>Plutonium rods to sink: {{ page.plutonium }}/min.</p>
        <p>Surplus solids: {{ page.surplus }}</p>
        <p class="small muted">
          Liquid and radioactive material balances are enforced. Do not let storage or overflow
          block recycling.
        </p>
      </section>
    </div>
  </template>
</template>
