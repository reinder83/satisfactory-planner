<!--
  What whole machines cost (#1066): a whole-machine phase's buildings, power, overflow to storage
  or the sink and delivery time, each beside the same phase planned with exact clocks (the stage's
  `exactPlan`, worded by roundingCost in app/exact-clocks.ts), and the raw resources it draws beyond
  that plan. The build plan's side column shows the phase on screen as a list (`layout` 'list',
  with a pointer to the line dialog's exact-clocks choice); the wizard's Review shows every phase
  it lists as a table. Nothing shows for a plan without whole machines, or one calculated before
  the planner recorded the exact plan: the figures are the calculation's, never worked out again.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { roundingCost } from '../../exact-clocks.ts';
import { itemRate } from '../../flow.ts';
import { durationOfHours, num } from '../../format.ts';
import { power } from '../../wizard/fields.ts';
import { listNames } from '../../../wording.ts';
import type { StoredStage } from '../../../types/index.ts';

const props = withDefaults(
  defineProps<{ entries: { phase: string; stage: StoredStage | undefined }[]; layout?: string }>(),
  { layout: 'list' },
);

// A time, or "never" for a phase whose deliveries never finish.
const hoursText = (hours: number) => (Number.isFinite(hours) ? durationOfHours(hours) : 'never');

const view = computed(() => {
  const phases = props.entries.flatMap(({ phase, stage }) => {
    const cost = roundingCost(stage);
    if (!cost) return [];
    return [
      {
        phase,
        figures: [
          { label: 'Buildings', whole: num(cost.buildings[0]), exact: num(cost.buildings[1]) },
          {
            label: 'Power needed',
            whole: power(cost.requiredMW[0]),
            exact: power(cost.requiredMW[1]),
          },
          {
            label: 'To storage or the sink',
            whole: num(cost.surplus[0]) + '/min',
            exact: num(cost.surplus[1]) + '/min',
          },
          {
            label: 'Delivery time',
            whole: hoursText(cost.hours[0]),
            exact: hoursText(cost.hours[1]),
          },
        ],
        raw: cost.extraRaw.length
          ? listNames(
              cost.extraRaw.slice(0, 4).map(([item, rate]) => `${item} +${itemRate(item, rate)}`),
            ) + (cost.extraRaw.length > 4 ? ` and ${cost.extraRaw.length - 4} more` : '')
          : '',
      },
    ];
  });
  return phases.length ? phases : null;
});
</script>

<template>
  <section v-if="view" class="panel rounding-cost" data-rounding-cost>
    <h2>What whole machines cost</h2>
    <p class="small muted">
      Every machine runs at 100%, so the lines that feed it run at full speed too, and what no line
      uses goes to storage or the sink. Beside each figure: the same phase with exact clocks, where
      the last machine of each line is underclocked to the exact remainder.
    </p>
    <template v-if="layout === 'table'">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th v-for="figure in view[0]!.figures" :key="figure.label">{{ figure.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in view" :key="entry.phase" :data-rounding-phase="entry.phase">
              <td>{{ entry.phase }}</td>
              <td v-for="figure in entry.figures" :key="figure.label">
                {{ figure.whole }}<br /><small class="muted"
                  >exact clocks: {{ figure.exact }}</small
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-for="entry in view.filter(e => e.raw)" :key="entry.phase" class="small">
        Phase {{ entry.phase }} also draws more raw resources: {{ entry.raw }}.
      </p>
    </template>
    <template v-else>
      <dl v-for="entry in view" :key="entry.phase" class="rounding-figures">
        <div v-for="figure in entry.figures" :key="figure.label">
          <dt>{{ figure.label }}</dt>
          <dd>
            {{ figure.whole }} <small class="muted">exact clocks: {{ figure.exact }}</small>
          </dd>
        </div>
        <div v-if="entry.raw">
          <dt>More raw resources</dt>
          <dd>{{ entry.raw }}</dd>
        </div>
      </dl>
      <p class="small muted">
        To run one production line at exact clocks, open it (Production line ↗) and tick “Exact
        clocks for this line”.
      </p>
    </template>
  </section>
</template>
