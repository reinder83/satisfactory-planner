<!--
  #wizard while the draft is in the node survey (wizard.mode 'extraction'), opened from All
  settings step 4 or the guided start: four screens that turn node counts into resource
  budgets. 1. where the counts come from and how you mine (miner mark and clock); 2. the ore
  nodes; 3. crude oil nodes and resource-well satellites; 4. the budgets, less what is
  already committed. The draft lives in wizard/extraction.ts: every change reads the screen
  into wizard.extraction (readExtraction) and redraws, the tabs and Back move between
  screens keeping what was typed, and the submit button past the last screen writes
  settings.limits and returns to whatever opened the survey. The form keeps the shared
  #wizard-form id, so moveExtraction reads it.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import {
  clockChoices,
  knownWorld,
  minedResources,
  minerMarks,
  nodeYield,
  resourcePool,
  wellYield,
} from '../../../preferences.ts';
import { FLUIDS, itemRate, rateUnit } from '../../flow.ts';
import { num } from '../../format.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  EXTRACTION_STEPS,
  extractionOf,
  leaveExtraction,
  moveExtraction,
  readExtraction,
  refillExtraction,
} from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import HelpTip from '../form/HelpTip.vue';
import SelectField from '../form/SelectField.vue';
import ItemIcon from '../ItemIcon.vue';
import PageHeader from '../PageHeader.vue';
import CountTable from '../survey/CountTable.vue';
import WorldSettings from '../survey/WorldSettings.vue';

const MAP_URL = 'https://satisfactory-calculator.com/en/interactive-map';
const BUDGET_ROWS = [...minedResources, 'Crude Oil', 'Nitrogen Gas'];
const marks = minerMarks.map(([v, l]) => [String(v), l]);
const clocks = clockChoices.map(([v, l]) => [String(v), l]);

// null once the draft has left the survey: until render() swaps this page out, it draws
// nothing rather than reading a survey that is not there.
const page = computed(() =>
  legacy(() => {
    if (wizard?.mode !== 'extraction') return null;
    const e = extractionOf(wizard),
      // openExtraction sets the screen when it switches to this mode.
      step = wizard.extractionStep ?? 1;
    const sample = (name: string, purity: string) => num(Math.round(nodeYield(name, purity, e)));
    const budgets = BUDGET_ROWS.map(name => {
      const pool = Math.round(resourcePool(e, name)),
        used = Number(e.used?.[name]) || 0;
      // Each rate carries its own unit (#363): m³/min for a fluid, /min for an ore. The
      // committed input keeps a bare number; its unit is a suffix beside it and in its name.
      const fluid = FLUIDS.has(name);
      return {
        name,
        pool: pool ? itemRate(name, pool) : '—',
        used: used || '',
        unit: rateUnit(name),
        label: name + ' already committed' + (fluid ? ', cubic metres' : '') + ' per minute',
        left: pool ? itemRate(name, Math.max(0, pool - used)) : '—',
        over: pool && used > pool,
      };
    });
    // Leaving a resource at zero is a legitimate answer, and it is also exactly what a
    // half-finished survey looks like. The plan that follows would simply fail to fit, so
    // the last screen names them rather than let that be a surprise.
    const empty = BUDGET_ROWS.filter(n => resourcePool(e, n) <= 0);
    return {
      step,
      last: step >= EXTRACTION_STEPS.length,
      mark: String(e.mark),
      clock: String(e.clock),
      samples: {
        impure: sample('Iron Ore', 'impure'),
        normal: sample('Iron Ore', 'normal'),
        pure: sample('Iron Ore', 'pure'),
        oil: itemRate('Crude Oil', Math.round(nodeYield('Crude Oil', 'normal', e))),
        well: itemRate('Crude Oil', Math.round(wellYield('normal', e))),
      },
      water: itemRate('Water', wizard.settings.limits.Water || 0),
      budgets,
      empty: empty.length
        ? {
            heading:
              (empty.length === 1 ? 'One resource has' : num(empty.length) + ' resources have') +
              ' no nodes entered:',
            names: empty.join(', '),
          }
        : null,
    };
  }),
);

// Any survey field, once committed: read the screen into the survey and redraw, since the
// totals and budgets follow the counts. Choosing a purity and distribution whose world is
// fully known (knownWorld) refills every count from that preset. Any other edit drops a
// pending undo (of a reset or refill): undoing after it would silently throw the edit away.
function changed(e: Event) {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (!/^(mark|clock|purity|distribution|node:|well:|used:)/.test(String(el.name))) return;
  readExtraction(e.currentTarget as HTMLFormElement);
  if (['purity', 'distribution'].includes(el.name)) {
    const s = draft().settings;
    if (knownWorld(s.purity, s.distribution)) refillExtraction();
  } else draft().extractionUndo = null;
  render();
}

// The tabs, Back (from the first screen it leaves the survey) and the submit button, which
// past the last screen applies the survey. The submit stops here, so no other
// submit listener takes the same Enter for the screen the survey returns to.
const go = (target: number) => moveExtraction(target);
function submit() {
  moveExtraction((draft().extractionStep ?? 1) + 1);
}
</script>

<template>
  <template v-if="page">
    <BrowserNotice v-if="browserMode" />
    <PageHeader
      eyebrow="YOUR WORLD"
      title="Work out your resource budgets"
      subtitle="Count what your world holds; the planner turns it into the rates it plans against."
    />
    <div class="wizard-progress">
      <button
        v-for="(n, i) in EXTRACTION_STEPS"
        :key="n"
        type="button"
        :class="page.step === i + 1 ? 'current' : ''"
        :data-extraction-step="i + 1"
        :aria-current="page.step === i + 1 ? 'step' : undefined"
        @click="go(i + 1)"
      >
        {{ i + 1 }}. {{ n }}
      </button>
    </div>
    <form
      id="wizard-form"
      class="panel wizard-panel extraction-panel"
      @change="changed"
      @submit.prevent.stop="submit"
    >
      <template v-if="page.step === 1">
        <h2>Where your numbers come from</h2>
        <div class="notice info">
          <b>You do not have to count nodes by hand.</b> Open the
          <a :href="MAP_URL" target="_blank" rel="noreferrer"
            >Satisfactory Calculator interactive map</a
          >, upload your save file there, and it lists every resource node your world holds —
          including which are impure, normal and pure, and which resource wells you have found. Copy
          those counts into the next two screens.
          <p class="small">
            Uploading a save to that site is your decision and happens entirely between you and
            them; this planner never sends your save anywhere. If you would rather not, the map also
            works without a save and shows the default world's nodes.
          </p>
        </div>
        <h2>How you will mine them</h2>
        <p>
          Extraction depends on the miner and its clock speed far more than on anything else. Plan
          for the miner this phase can build and power, not the one you happen to have running
          today.
        </p>
        <div class="form-grid">
          <SelectField label="Miner" name="mark" :options="marks" :value="page.mark" />
          <SelectField label="Clock speed" name="clock" :options="clocks" :value="page.clock" />
        </div>
        <div class="notice info">
          <b>At these settings</b> one iron node gives {{ page.samples.impure }}/min impure,
          {{ page.samples.normal }}/min normal and {{ page.samples.pure }}/min pure. A crude oil
          node gives {{ page.samples.oil }} normal, and one resource-well satellite
          {{ page.samples.well }}.
        </div>
      </template>
      <template v-else-if="page.step === 2">
        <h2>Your ore nodes</h2>
        <WorldSettings />
        <p>
          How many nodes of each purity your world holds for each ore.
          <HelpTip name="extractionNodes" /> Zero means zero: a purity your world has none of, or an
          ore you have not found. Whatever you leave at zero, the plan cannot mine — so enter
          everything you intend to work.
        </p>
        <CountTable kind="node" :names="minedResources" />
      </template>
      <template v-else-if="page.step === 3">
        <h2>Resource wells</h2>
        <WorldSettings />
        <p>
          Crude oil comes from ordinary nodes and from resource wells; nitrogen only from wells.
          <HelpTip name="extractionWells" />
        </p>
        <h3>Crude oil nodes</h3>
        <CountTable kind="node" :names="['Crude Oil']" />
        <h3>Resource well satellites</h3>
        <CountTable kind="well" :names="['Crude Oil', 'Nitrogen Gas']" />
        <div class="notice info">
          <ItemIcon name="Water" /> <b>Water is not counted.</b> Extractors sit on any lake or ocean
          and there is far more coastline than a factory can draw on, so a node count would be a
          fiction. The planner keeps its standing water allowance of {{ page.water }}, which you can
          still change in All settings if you want to model a genuinely constrained site.
        </div>
      </template>
      <template v-else-if="page.step === 4">
        <h2>Your budgets</h2>
        <p>
          What those nodes yield, less anything already committed to factories this plan does not
          include. That deduction is what makes a budget mean <em>free for this plan to use</em>.
          <HelpTip name="extractionUsed" />
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Whole pool</th>
                <th>Already committed</th>
                <th>Budget</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in page.budgets" :key="r.name">
                <td class="resource-name">
                  <ItemIcon :name="r.name" /><span>{{ r.name }}</span>
                </td>
                <td class="number">{{ r.pool }}</td>
                <td>
                  <span class="used-field"
                    ><input
                      class="used-input"
                      :name="'used:' + r.name"
                      type="number"
                      min="0"
                      max="10000000"
                      step="any"
                      :value="r.used"
                      placeholder="0"
                      :aria-label="r.label"
                    /><span class="used-unit" aria-hidden="true">{{ r.unit }}</span></span
                  >
                </td>
                <td :class="['number', r.over ? 'warn' : '']">{{ r.left }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="page.empty" class="notice warn">
          <b>{{ page.empty.heading }}</b>
          {{ page.empty.names }}. A zero budget means this plan may not use that resource at all — a
          fine answer for something you have genuinely not found, but if you simply have not counted
          them yet, go back and fill them in or the plan will not fit.
        </div>
        <p class="small muted">
          Production you already run is a different question, asked separately: that one credits
          finished parts, this one takes raw extraction off the top. Use this for ore feeding
          factories the plan will not rebuild, and the other for parts the plan would otherwise make
          again.
        </p>
      </template>
      <p
        id="wizard-error"
        class="form-error notice error"
        role="alert"
        tabindex="-1"
        data-wizard-error
      ></p>
      <div class="wizard-actions">
        <button type="button" class="btn" data-extraction-back @click="go(page.step - 1)">
          {{ page.step <= 1 ? 'Cancel' : 'Back' }}
        </button>
        <span class="guided-escape"
          ><button
            v-if="page.step > 1"
            type="button"
            class="btn quiet"
            data-extraction-cancel
            @click="leaveExtraction()"
          >
            Leave these budgets alone
          </button>
          <button class="btn primary" type="submit">
            {{ page.last ? 'Use these budgets' : 'Continue →' }}
          </button></span
        >
      </div>
    </form>
  </template>
</template>
