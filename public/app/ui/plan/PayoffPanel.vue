<!--
  "Hard-drive payoff" on a calculated profile's plan page (#204, part 3 of #67): what allowing
  each alternate recipe the profile does not allow yet would do to this phase's plan. "Rank
  alternates" runs POST /api/rank-alternates (#203), which stores the result with the profile;
  a stored ranking for this phase shows at once. Rows open the alternate's recipe dialog.
  The sorting and formatting live in app/payoff.ts.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { post, toast } from '../../api.ts';
import { num } from '../../format.ts';
import {
  PAYOFF_COLUMNS,
  PAYOFF_STATUS,
  PAYOFF_WORDS,
  payoffDefaultSort,
  payoffDelta,
  payoffTable,
  type PayoffColumn,
} from '../../payoff.ts';
import { browserMode } from '../../../browser-api.ts';
import {
  calcStage,
  calculated,
  currentProfile,
  payoff,
  phaseLabel,
  setPayoff,
  stage,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { openAltRecipe } from '../../wizard/recipes.ts';
import { legacy } from '../bridge.ts';
import type { StoredPayoff } from '../../../types/index.ts';

// The chosen sort; null follows the profile's goal.
const sortBy = ref<PayoffColumn | null>(null);
const dir = ref<1 | -1>(1);
// "Checking 23 of 67 alternates…" while a ranking runs; empty otherwise.
const running = ref('');

const view = computed(() =>
  legacy(() => {
    if (!calculated || !calcStage()?.feasible) return null;
    const column = sortBy.value ?? payoffDefaultSort(calculated.settings.goal);
    const stored = payoff;
    const ranking = stored?.ranking.phase === stage() ? stored.ranking : null;
    const table = ranking && payoffTable(ranking, column, dir.value);
    // A column no alternate changes (delivery time under fixed-hour goals) is left out and
    // named below the table instead; the sorted column always stays.
    const moves = (c: PayoffColumn) =>
      (table?.rows || []).some(p => payoffDelta(p, c) !== '0' && payoffDelta(p, c) !== '–');
    const columns = PAYOFF_COLUMNS.filter(([c]) => c === column || moves(c));
    return {
      phase: phaseLabel(stage()),
      column,
      ranking,
      // A ranking kept from another phase, named so the button's meaning is clear.
      otherPhase: stored && !ranking ? phaseLabel(stored.ranking.phase) : '',
      when: stored?.rankedAt ? new Date(stored.rankedAt).toLocaleString() : '',
      rows: (table?.rows || []).map(p => ({
        id: p.id,
        name: p.name,
        machine: p.machine,
        status: p.status,
        label: PAYOFF_STATUS[p.status],
        error: p.error || '',
        cells: columns.map(([c]) => payoffDelta(p, c)),
      })),
      columns,
      unchanged: PAYOFF_COLUMNS.filter(([c]) => !columns.some(([x]) => x === c)).map(
        ([c]) => PAYOFF_WORDS[c],
      ),
      same: table?.same || 0,
    };
  }),
);

function sort(column: PayoffColumn) {
  const current = sortBy.value ?? view.value?.column;
  dir.value = current === column ? (dir.value === 1 ? -1 : 1) : 1;
  sortBy.value = column;
}
const ariaSort = (column: PayoffColumn) =>
  view.value?.column === column ? (dir.value === 1 ? 'ascending' : 'descending') : 'none';

// Runs the ranking for the phase on screen and shows it, unless another profile was opened
// meanwhile (the result is stored with the profile it was run for either way).
async function rank() {
  const profileId = currentProfile.id;
  running.value = 'Checking alternates…';
  try {
    const result = await post<StoredPayoff>('/api/rank-alternates', { phase: stage() }, true, {
      onRankProgress: (done, total) =>
        (running.value = `Checking ${num(done)} of ${num(total)} alternates…`),
    });
    if (currentProfile.id !== profileId) return;
    setPayoff(result);
    render();
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    running.value = '';
  }
}
</script>

<template>
  <section v-if="view" class="panel payoff" data-payoff>
    <div class="section-head">
      <h2>Hard-drive payoff</h2>
      <button class="btn" data-rank-alternates :disabled="!!running" @click="rank">
        {{ view.ranking ? 'Re-rank' : 'Rank alternates' }}
      </button>
    </div>
    <p v-if="running" class="small" data-payoff-progress role="status">
      {{ running }}
      <template v-if="!browserMode">This can take up to 20 seconds.</template>
    </p>
    <template v-if="!view.ranking">
      <p class="small muted">
        What each alternate recipe this profile does not allow yet would change in
        {{ view.phase }}'s plan: buildings, raw resources, power and delivery time. It recalculates
        the phase once per alternate and keeps the result with this profile.
      </p>
      <p v-if="view.otherPhase" class="small muted" data-payoff-other>
        The stored ranking is for {{ view.otherPhase }}.
      </p>
    </template>
    <template v-else>
      <p class="small muted" data-payoff-summary>
        {{ view.ranking.candidates.length }} of {{ view.ranking.total }} alternates checked for
        {{ view.phase }}<template v-if="view.when">, {{ view.when }}</template
        >. Negative is better: fewer buildings, less raw, less power, sooner done.
      </p>
      <p v-if="view.ranking.stopped" class="notice" data-payoff-stopped>
        The ranking stopped at its time limit; Re-rank to try again.
      </p>
      <p v-if="!view.ranking.total" class="small" data-payoff-none>
        Every alternate available by {{ view.phase }} is already allowed in this profile.
      </p>
      <div v-if="view.rows.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Alternate</th>
              <th>Effect</th>
              <th v-for="[c, label] in view.columns" :key="c" :aria-sort="ariaSort(c)">
                <button class="link" :data-payoff-sort="c" @click="sort(c)">
                  {{ label }}{{ view.column === c ? (dir === 1 ? ' ▲' : ' ▼') : '' }}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in view.rows" :key="r.id" :data-payoff-row="r.id">
              <td>
                <button class="link" :data-payoff-recipe="r.id" @click="openAltRecipe(r.id)">
                  {{ r.name }}
                </button>
                <span class="small muted">{{ r.machine }}</span>
              </td>
              <td :class="'payoff-' + r.status" :title="r.error">{{ r.label }}</td>
              <td v-for="(cell, i) in r.cells" :key="i" class="number">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="view.same" class="small muted" data-payoff-same>
        {{ view.same }} other {{ view.same === 1 ? 'alternate changes' : 'alternates change' }}
        nothing in this plan.
      </p>
      <p v-if="view.unchanged.length" class="small muted" data-payoff-unchanged>
        No alternate changes {{ view.unchanged.join(' or ') }} here.
      </p>
    </template>
  </section>
</template>
