<!--
  #resources on a calculated profile, for the current phase: the draft and headroom notices,
  one power headroom bar (SP-29: needed against available, with the somersloop and augmenter
  counts in its legend when the plan uses them), raw resources
  against the entered budgets (settings.limits), then a panel of icon rows each for drone fuel,
  vehicle fuel (when the plan has any), protected storage, credited existing production and
  surplus (SP-28), and one for conversions. A plan guide's power section (#393, #469; a migrated
  handbook profile) follows: its commissioning checklist, ticking the guide's own ids, and its
  blocks of copy such as the rocket-fuel block and the nuclear sequence, as the handbook page
  showed them. Everything reads the profile's frozen calculation snapshot; nothing here
  recalculates.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate } from '../../flow.ts';
import { num } from '../../format.ts';
import { calcStage, calculated, checked, workspace } from '../../session.ts';
import { resourceUse, tightestFirst } from '../../views/resources.ts';
import { itemRateRows } from '../../views/storage.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import PageHeader from '../PageHeader.vue';
import { toggleCheck } from '../actions.ts';
import CalcWarnings from '../plan/CalcWarnings.vue';
import type { StoredCalculatedPlan, StoredStage } from '../../../types/index.ts';

interface Part {
  key: string;
  label: string;
  mw: number;
  caption: string;
}

// One power headroom bar (SP-29): what the phase needs, its whole-machine peak plus the utility
// allowance, against what it has, new generation (with any augmenter boost) plus the existing
// spare figure, as planner.ts sums them into requiredMW and availableMW. The headline is the
// share of that available power left over, or the shortfall. The somersloop and augmenter
// counts are legend captions.
function headroom(x: StoredStage, s: StoredCalculatedPlan['settings']) {
  const peak = x.peakMW || 0,
    utility = Math.max(0, (x.requiredMW ?? peak) - peak),
    generation = x.generationMW || 0,
    spare = s.availablePowerGW * 1000,
    // What the augmenters add: their 500 MW each and the boost on new and installed
    // generation, which planner.ts counts into availableMW.
    boost = (x.augmenters ?? 0) > 0 ? Math.max(0, (x.availableMW ?? 0) - generation - spare) : 0,
    required = peak + utility,
    available = generation + boost + spare,
    short = required - available > 0.01 ? required - available : 0;
  const sloops = x.sloopsUsed ?? 0,
    augmenters = x.augmenters ?? 0;
  const demand: Part[] = [
    {
      key: 'peak',
      label: 'Whole-machine peak',
      mw: peak,
      caption:
        'At selected consumption multiplier' +
        (sloops > 0
          ? ` · ${num(sloops)} somersloop${sloops > 1 ? 's' : ''} in production: amplified machines give double output at four times the power`
          : ''),
    },
    {
      key: 'utility',
      label: 'Utility allowance',
      mw: utility,
      caption: (s.utilityPercent ?? 20) + '% for transport and utilities; verify actual load',
    },
  ];
  const supply: Part[] = [
    {
      key: 'generation',
      label: 'New generation',
      mw: generation,
      caption: 'Fuel and recycling included',
    },
    ...(augmenters > 0
      ? [
          {
            key: 'boost',
            label: 'Augmenter boost',
            mw: boost,
            caption: `${num(augmenters)} augmenter${augmenters > 1 ? 's' : ''} · ${num(x.augmenterMW)} MW plus ${Math.round((x.boost || 0) * 100)}% of base production`,
          },
        ]
      : []),
    {
      key: 'spare',
      label: 'Existing spare power',
      mw: spare,
      caption: 'Not total installed generation',
    },
  ];
  const scale = Math.max(required, available) || 1,
    width = (mw: number) => (mw / scale) * 100 + '%';
  const headline = short
    ? 'Short by ' + power(short)
    : available > 0
      ? Math.floor(((available - required) / available) * 100) + '% headroom'
      : 'No power needed';
  const list = (parts: Part[]) =>
    parts
      .filter(p => p.mw > 0)
      .map(p => `${power(p.mw)} ${p.label.toLowerCase()}`)
      .join(' + ') || '0 MW';
  return {
    headline,
    short: short > 0,
    required: power(required),
    available: power(available),
    demand: demand.map(p => ({ ...p, value: power(p.mw), width: width(p.mw) })),
    supply: supply.map(p => ({ ...p, value: power(p.mw), width: width(p.mw) })),
    shortWidth: width(short),
    // The bars' text alternative: every figure they draw, in one sentence.
    label: `${headline}. Needed: ${power(required)} (${list(demand)}). Available: ${power(available)} (${list(supply)}).`,
  };
}

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    const x = calcStage();
    if (!calculated || !x) return null;
    const s = calculated.settings;
    const g = calculated.guide?.power;
    return {
      // The guide's commissioning checks and blocks, each block's text a paragraph per blank line.
      guidePower: g
        ? {
            checks: g.checks.map(c => ({ ...c, done: checked(c.id) })),
            blocks: g.blocks.map((b, i) => ({
              key: i,
              title: b.title,
              paragraphs: b.body.split(/\n\s*\n/).filter(p => p.trim()),
            })),
          }
        : null,
      power: headroom(x, s),
      // Tightest first (SP-27): over budget, then by use, and resources this phase does not
      // draw on last; the catalogue order breaks ties.
      rows: (workspace.catalog.raw || [])
        .map(n => {
          // The plan's limits hold every raw resource.
          const required = x.raw?.[n] || 0,
            budget = s.limits[n]!,
            use = resourceUse(required, budget);
          // Each rate carries its own unit (#363): m³/min for a fluid, /min for an ore.
          return {
            ...use,
            name: n,
            required: itemRate(n, required),
            budget: itemRate(n, budget),
            remaining: itemRate(n, budget - required),
            overBy: use.over ? itemRate(n, Math.max(0, required) - Math.max(0, budget)) : '',
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
    <section class="panel power-headroom" data-power-headroom>
      <h2>Power headroom</h2>
      <p :class="['power-headline', page.power.short ? 'short' : '']" data-power-headline>
        <strong
          ><span v-if="page.power.short" aria-hidden="true">⚠ </span
          >{{ page.power.headline }}</strong
        >
        <span>{{ page.power.required }} needed of {{ page.power.available }} available</span>
      </p>
      <div class="power-bars" role="img" :aria-label="page.power.label">
        <span class="eyebrow" aria-hidden="true">Needed</span>
        <div class="power-bar" data-power-bar="demand">
          <span
            v-for="p in page.power.demand"
            :key="p.key"
            :class="'seg-' + p.key"
            :style="{ width: p.width }"
          ></span>
        </div>
        <span class="eyebrow" aria-hidden="true">Available</span>
        <div class="power-bar" data-power-bar="supply">
          <span
            v-for="p in page.power.supply"
            :key="p.key"
            :class="'seg-' + p.key"
            :style="{ width: p.width }"
          ></span>
          <span
            v-if="page.power.short"
            class="seg-short"
            :style="{ width: page.power.shortWidth }"
          ></span>
        </div>
      </div>
      <ul class="power-legend">
        <li
          v-for="p in [...page.power.demand, ...page.power.supply]"
          :key="p.key"
          :data-power-part="p.key"
        >
          <i :class="'seg-' + p.key" aria-hidden="true"></i
          ><span class="eyebrow">{{ p.label }}</span
          ><b>{{ p.value }}</b
          ><small>{{ p.caption }}</small>
        </li>
      </ul>
    </section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" class="resource-cell">Resource</th>
            <th scope="col">Required</th>
            <th scope="col">Budget</th>
            <th scope="col">Remaining</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in page.rows" :key="r.name" :class="r.idle ? 'muted' : undefined">
            <td class="resource-cell">
              <div class="resource-name">
                <ItemIcon :name="r.name" /><span>{{ r.name }}</span>
              </div>
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
                <span aria-hidden="true">⚠ </span>Over by {{ r.overBy }}
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
    <div v-if="page.guidePower" class="backup-grid" style="margin-top: 24px" data-guide-power>
      <section v-if="page.guidePower.checks.length" class="panel">
        <h2>Power commissioning</h2>
        <div class="checklist">
          <label v-for="c in page.guidePower.checks" :key="c.id" class="check-row"
            ><input type="checkbox" :data-check="c.id" @change="toggleCheck" :checked="c.done" />{{
              c.label
            }}</label
          >
        </div>
      </section>
      <section v-for="b in page.guidePower.blocks" :key="b.key" class="panel" data-guide-block>
        <h2>{{ b.title }}</h2>
        <p v-for="(para, i) in b.paragraphs" :key="i">{{ para }}</p>
      </section>
    </div>
  </template>
</template>
