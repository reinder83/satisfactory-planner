<!--
  #resources on a calculated profile, for the current phase: the draft and headroom notices,
  one power headroom bar (SP-29: needed against available, with the somersloop and augmenter
  counts in its legend when the plan uses them), raw resources
  against the entered budgets (settings.limits; with mining per phase, #1065, the phase's own,
  stage.mining.budgets), the miners and extractors the phase's draw taps (on a plan with mining
  per phase), then a panel of icon rows each for drone fuel,
  vehicle fuel (when the plan has any), protected storage, credited existing production and
  surplus (SP-28), and one for conversions. A plan guide's power section (#393, #469; a migrated
  handbook profile) follows: its commissioning checklist, ticking the guide's own ids, and its
  blocks of copy such as the rocket-fuel block and the nuclear sequence, as the handbook page
  showed them. Everything reads the profile's frozen calculation snapshot; nothing here
  recalculates. A milestone-only phase (#759) shows only the header and why it has none of this.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate } from '../../flow.ts';
import { num } from '../../format.ts';
import { calcStage, calculated, checked, milestoneOnly, workspace } from '../../session.ts';
import { resourceUse, tightestFirst } from '../../views/resources.ts';
import { itemRateRows, storageRows } from '../../views/storage.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import { ALLOWANCE_SETTING } from '../../../power.ts';
import { currentProfile, currentSave } from '../../session.ts';
import { startEdit } from '../../wizard/wizard.ts';
import { toast } from '../../api.ts';
import PageHeader from '../PageHeader.vue';
import { toggleCheck } from '../actions.ts';
import CalcWarnings from '../plan/CalcWarnings.vue';
import { powerView, type PowerPart } from '../../../power.ts';
import { equipmentWords, stageBudget, stageMiningAdvice } from '../../../mining.ts';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';
import type { StoredCalculatedPlan, StoredStage } from '../../../types/index.ts';

// A milestone-only phase before the profile's start phase (#759) uses no power or resources of
// its own: the page says so (MilestoneOnlyNotice.vue) rather than drawing nothing.
const milestones = computed(() => legacy(() => !!calculated && milestoneOnly()));

// One power headroom bar (SP-29): what the phase needs against what it has, from the one power
// model every page reads (powerView in public/power.ts, #1064): the production lines at their
// clocked power, their utility allowance and the miners and extractors, against whole generators
// (with any augmenter boost) and the existing spare figure. A plan made before #1064 shows its
// own figures as it always did (whole-machine peak and new generation). The headline is the share
// of that available power left over, or the shortfall. The somersloop and augmenter counts and
// the variable-power machines' average are legend captions. Under the headline, what Power
// needed holds, the utility allowance for trains, drones and pumps included, and where the
// variable-power machines count at their peak (#1090, powerView's need in public/power.ts).
function headroom(stagePlan: StoredStage, settings: StoredCalculatedPlan['settings']) {
  const view = powerView(stagePlan, settings);
  const required = view.needMW,
    available = view.availableMW,
    short = view.shortMW;
  const scale = Math.max(required, available) || 1,
    width = (mw: number) => (mw / scale) * 100 + '%';
  const headline = short
    ? 'Short by ' + power(short)
    : available > 0
      ? Math.floor(((available - required) / available) * 100) + '% headroom'
      : 'No power needed';
  const list = (parts: PowerPart[]) =>
    parts
      .filter(p => p.mw > 0)
      .map(p => `${power(p.mw)} ${p.label.toLowerCase()}`)
      .join(' + ') || '0 MW';
  return {
    headline,
    short: short > 0,
    required: power(required),
    available: power(available),
    demand: view.demand.map(p => ({ ...p, value: power(p.mw), width: width(p.mw) })),
    supply: view.supply.map(p => ({ ...p, value: power(p.mw), width: width(p.mw) })),
    shortWidth: width(short),
    // What the need holds, in one sentence (#1090), and the variable-power machines' peak.
    parts: view.need.words,
    peak: view.need.peak,
    // The bars' text alternative: every figure they draw, in one sentence.
    label: `${headline}. Needed: ${power(required)} (${list(view.demand)}). Available: ${power(available)} (${list(view.supply)}).`,
  };
}

// "Change Extra utilities power in Edit settings" (#1090, #1071): Edit settings of the profile
// this tab shows, opened on the Preferences step of All settings, whose Review recalculates it in
// place with its progress carried and keeps the current version as a backup profile, once the
// user presses "Recalculate in place". Nothing changes until then.
const toPreferences = () =>
  void startEdit(currentSave.id, currentProfile.id, 2).catch(error =>
    toast((error as Error).message, true),
  );

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    const stagePlan = calcStage();
    if (!calculated || !stagePlan) return null;
    const settings = calculated.settings;
    const powerGuide = calculated.guide?.power;
    return {
      // The guide's commissioning checks and blocks, each block's text a paragraph per blank line.
      guidePower: powerGuide
        ? {
            checks: powerGuide.checks.map(c => ({ ...c, done: checked(c.id) })),
            blocks: powerGuide.blocks.map((block, i) => ({
              key: i,
              title: block.title,
              paragraphs: block.body.split(/\n\s*\n/).filter(p => p.trim()),
            })),
          }
        : null,
      power: headroom(stagePlan, settings),
      // Tightest first (SP-27): over budget, then by use, and resources this phase does not
      // draw on last; the catalogue order breaks ties.
      rows: (workspace.catalog.raw || [])
        .map(name => {
          // The plan's limits hold every raw resource.
          const required = stagePlan.raw?.[name] || 0,
            budget = stageBudget(stagePlan, settings, name),
            use = resourceUse(required, budget);
          // Each rate carries its own unit (#363): m³/min for a fluid, /min for an ore.
          return {
            ...use,
            name,
            required: itemRate(name, required),
            budget: itemRate(name, budget),
            remaining: itemRate(name, budget - required),
            overBy: use.over ? itemRate(name, Math.max(0, required) - Math.max(0, budget)) : '',
          };
        })
        .sort(tightestFirst),
      // Each item list is its own panel of icon rows (SP-28); an empty one keeps its sentence.
      // Vehicle fuel shows only when the plan burns some on its group links.
      lists: [
        {
          id: 'drone',
          title: 'Dedicated drone fuel',
          rows: itemRateRows(stagePlan.drone || {}),
          empty: 'No dedicated drone fuel in this phase.',
        },
        {
          id: 'transport',
          title: 'Vehicle fuel for links between factories',
          rows: itemRateRows(stagePlan.transport || {}),
          empty: '',
        },
        {
          id: 'storage',
          title: 'Protected storage',
          rows: storageRows(stagePlan),
          empty: 'No storage production requested.',
        },
        {
          id: 'supplied',
          title: 'From production you already run',
          rows: itemRateRows(stagePlan.supplied || {}),
          empty: 'None credited in this phase.',
        },
        {
          id: 'surplus',
          title: 'Surplus solids',
          rows: itemRateRows(stagePlan.surplus || {}),
          empty: 'None',
        },
      ].filter(list => list.rows.length || list.empty),
      // The phase's miners and extractors (#1065): its equipment and, per resource it draws,
      // the nodes that draw taps. Null on a plan without mining per phase.
      mining: stagePlan.mining
        ? {
            equipment: equipmentWords(stagePlan.mining),
            rows: stageMiningAdvice(stagePlan).map(entry => ({
              name: entry.resource,
              rate: itemRate(entry.resource, entry.rate),
              words: entry.words,
            })),
          }
        : null,
      credited: Object.keys(stagePlan.supplied || {}).length > 0,
      fromSurplus: !!stagePlan.storageAsked,
      conversions: stagePlan.conversions || [],
      plutonium: num(stagePlan.plutoniumSink),
    };
  }),
);
</script>

<template>
  <template v-if="milestones">
    <PageHeader eyebrow="CHECK BEFORE EXPANDING" title="Power &amp; resources" />
    <MilestoneOnlyNotice />
  </template>
  <template v-else-if="page">
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
      <p v-if="page.power.parts" class="small power-parts" data-power-parts>
        Power needed: {{ page.power.parts }}.
        <button type="button" class="btn quiet" data-power-preferences @click="toPreferences">
          Change {{ ALLOWANCE_SETTING }} in Edit settings →
        </button>
      </p>
      <p v-if="page.power.peak" class="small muted" data-power-peak>{{ page.power.peak }}</p>
      <div class="power-bars" role="img" :aria-label="page.power.label">
        <span class="eyebrow" aria-hidden="true">Needed</span>
        <div class="power-bar" data-power-bar="demand">
          <span
            v-for="part in page.power.demand"
            :key="part.key"
            :class="'seg-' + part.key"
            :style="{ width: part.width }"
          ></span>
        </div>
        <span class="eyebrow" aria-hidden="true">Available</span>
        <div class="power-bar" data-power-bar="supply">
          <span
            v-for="part in page.power.supply"
            :key="part.key"
            :class="'seg-' + part.key"
            :style="{ width: part.width }"
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
          v-for="part in [...page.power.demand, ...page.power.supply]"
          :key="part.key"
          :data-power-part="part.key"
        >
          <i :class="'seg-' + part.key" aria-hidden="true"></i
          ><span class="eyebrow">{{ part.label }}</span
          ><b>{{ part.value }}</b
          ><small>{{ part.caption }}</small>
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
          <tr v-for="row in page.rows" :key="row.name" :class="row.idle ? 'muted' : undefined">
            <td class="resource-cell">
              <div class="resource-name">
                <ItemIcon :name="row.name" /><span>{{ row.name }}</span>
              </div>
            </td>
            <td class="number">{{ row.required }}</td>
            <td class="number">{{ row.budget }}</td>
            <td :class="['number', row.over ? 'warn' : '']">{{ row.remaining }}</td>
            <td :class="row.over ? 'warn' : undefined" data-use>
              {{ row.use }}
              <div
                :class="['resource-bar', row.over ? 'over' : row.tight ? 'tight' : '']"
                aria-hidden="true"
              >
                <span :style="{ width: row.bar + '%' }"></span>
              </div>
              <div v-if="row.over" class="small" data-over>
                <span aria-hidden="true">⚠ </span>Over by {{ row.overBy }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      Sorted by use, tightest first. Resources this phase does not draw on are listed last.<template
        v-if="page.mining"
      >
        Budgets are this phase's: what its miners and belts get from the nodes behind your entered
        budgets.</template
      >
    </p>
    <section v-if="page.mining" class="panel mining-advice" data-mining>
      <h2>Miners and extractors</h2>
      <p class="small muted" data-mining-equipment>{{ page.mining.equipment }}</p>
      <ul v-if="page.mining.rows.length" class="supply-summary">
        <li v-for="row in page.mining.rows" :key="row.name" :data-mining-resource="row.name">
          <ItemIcon :name="row.name" aria-hidden="true" /><span
            ><b>{{ row.name }}</b> {{ row.rate }}. {{ row.words }}</span
          >
        </li>
      </ul>
      <p v-else>This phase mines nothing.</p>
      <p class="small muted">
        Tap the best nodes first. Water Extractors are listed with each line that takes Water.
      </p>
    </section>
    <div class="backup-grid">
      <section v-for="list in page.lists" :key="list.id" class="panel" :data-rate-list="list.id">
        <h2>{{ list.title }}</h2>
        <ul
          v-if="list.rows.length"
          class="supply-summary"
          :data-transport-fuel="list.id === 'transport' || undefined"
        >
          <li v-for="row in list.rows" :key="row.name">
            <ItemIcon :name="row.name" aria-hidden="true" /><span
              ><b>{{ row.name }}</b> {{ row.rate
              }}<span v-if="row.note" class="muted" data-storage-source>
                · {{ row.note }}</span
              ></span
            >
          </li>
        </ul>
        <p v-else>{{ list.empty }}</p>
        <p v-if="list.id === 'storage' && page.fromSurplus" class="small muted">
          Each container takes the plan’s surplus of its item first, and a full one overflows to the
          AWESOME Sink. Storage-only lines run only for items with no surplus; they are optional and
          built last.
        </p>
        <p v-if="list.id === 'supplied' && page.credited" class="small muted">
          The plan does not build these lines or the chain behind them. Their extraction is assumed
          to be outside the budgets above.
        </p>
      </section>
      <section class="panel" data-conversions>
        <h2>Conversion and byproducts</h2>
        <p>
          <template v-if="page.conversions.length"
            ><template v-for="(conversion, i) in page.conversions" :key="i"
              ><br v-if="i" />{{ conversion }}</template
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
          <label v-for="check in page.guidePower.checks" :key="check.id" class="check-row"
            ><input
              type="checkbox"
              :data-check="check.id"
              @change="toggleCheck"
              :checked="check.done"
            />{{ check.label }}</label
          >
        </div>
      </section>
      <section
        v-for="block in page.guidePower.blocks"
        :key="block.key"
        class="panel"
        data-guide-block
      >
        <h2>{{ block.title }}</h2>
        <p v-for="(para, i) in block.paragraphs" :key="i">{{ para }}</p>
      </section>
    </div>
  </template>
</template>
