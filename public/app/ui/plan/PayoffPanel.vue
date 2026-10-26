<!--
  "Best next hard drive" on a calculated profile's plan page (#204, part 3 of #67; #1075), in its
  Hard drives tab (#1243): what each alternate recipe would change
  in the plan. "Rank alternates" runs POST /api/rank-alternates (#203) for the phase on screen and
  every later one the plan builds, with the recipes the plan counts on but the player does not own
  (`remaining` and `hunting`, #1075), and stores the result with the profile; a stored ranking for
  this phase shows at once, one made before #1075 as it was (that phase alone). Nothing is ranked
  or recalculated until the user presses the button.

  The table sorts by Δ buildings first, whatever the goal (#1075); a threshold hides the rows that
  save fewer buildings; the tab has room for every row (#1243). A recipe not allowed yet
  has "Add as hunting": it recalculates this profile in place with that recipe allowed as one to
  hunt (huntingSettings in app/recipe-states.ts: exactly the plan the ranking tried), after the
  confirmation every recalculation offer asks (recalculateOffer in ui/recalc-offer.ts: progress
  carried, the current version kept as a backup). A hunting row says so: its figures are what
  finding it saves. Rows open the alternate's recipe dialog. The sorting and formatting live in
  app/payoff.ts. It draws nothing in "New to Satisfactory" mode (#1076), so the tab goes too.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { post, toast } from '../../api.ts';
import { num } from '../../format.ts';
import {
  PAYOFF_COLUMNS,
  PAYOFF_STATUS,
  PAYOFF_WORDS,
  payoffDelta,
  payoffTable,
  rankedMessage,
  rankedPhases,
  type PayoffColumn,
} from '../../payoff.ts';
import { announce } from '../../announce.ts';
import { huntingSettings } from '../../recipe-states.ts';
import { beginnerMode } from '../../beginner.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { RANK_BUDGET_MS } from '../../../state.ts';
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
import { recalculateOffer } from '../recalc-offer.ts';
import type { StoredPayoff } from '../../../types/index.ts';

// The chosen sort; null is Δ buildings (#1075).
const sortBy = ref<PayoffColumn | null>(null);
const direction = ref<1 | -1>(1);
// "Checking 23 of 67 alternates…" while a ranking runs; empty otherwise.
const running = ref('');
// The payoff threshold (#1075): only rows saving at least this many buildings; 0 shows all.
const THRESHOLDS = [0, 1, 5, 10, 20];
const threshold = ref(0);
const ADD_LABEL = 'Add as hunting';
// The ranking's time limit in words, the same in both editions (#1257). A ranking started while
// others run may wait for one to finish first (two at once on the server, server/ranking.ts),
// and its limit only starts when it runs.
const RANK_LIMIT = `${RANK_BUDGET_MS / 60000} minutes`;

const transcribed = computed(() => legacy(() => isTranscribed(calculated)));
const view = computed(() =>
  legacy(() => {
    if (beginnerMode() || !calculated || !calcStage()?.feasible) return null;
    const plan = calculated;
    const column = sortBy.value ?? 'buildings';
    const stored = payoff;
    const ranking = stored?.ranking.phase === stage() ? stored.ranking : null;
    const table = ranking && payoffTable(ranking, column, direction.value);
    // A column no alternate changes (delivery time under fixed-hour goals) is left out and
    // named below the table instead; the sorted column always stays.
    const moves = (key: PayoffColumn) =>
      (table?.rows || []).some(
        row => payoffDelta(row, key) !== '0' && payoffDelta(row, key) !== '–',
      );
    const columns = PAYOFF_COLUMNS.filter(([key]) => key === column || moves(key));
    const rows = (table?.rows || [])
      .filter(row => !threshold.value || row.buildings <= -threshold.value)
      .map(row => ({
        id: row.id,
        name: row.name,
        machine: row.machine,
        status: row.status,
        hunting: !!row.hunting,
        // Settings to recalculate with, for a recipe not allowed yet that fits.
        hunt:
          row.hunting || row.status === 'infeasible' || row.status === 'error'
            ? null
            : huntingSettings(plan.settings, row.id),
        // A hunting recipe the plan does not fit without is needed, not a failure.
        needed: !!row.hunting && row.status === 'infeasible',
        label: row.hunting && row.status === 'infeasible' ? 'Needed' : PAYOFF_STATUS[row.status],
        error: row.error || '',
        cells: columns.map(([key]) => payoffDelta(row, key)),
      }));
    return {
      phase: phaseLabel(stage()),
      phases: ranking ? rankedPhases(ranking) : '',
      column,
      ranking,
      // A ranking kept from another phase, named so the button's meaning is clear.
      otherPhase: stored && !ranking ? phaseLabel(stored.ranking.phase) : '',
      when: stored?.rankedAt ? new Date(stored.rankedAt).toLocaleString() : '',
      rows,
      hidden: (table?.rows.length || 0) - rows.length,
      columns,
      unchanged: PAYOFF_COLUMNS.filter(([key]) => !columns.some(([shown]) => shown === key)).map(
        ([key]) => PAYOFF_WORDS[key],
      ),
      same: table?.same || 0,
    };
  }),
);

function sort(column: PayoffColumn) {
  const current = sortBy.value ?? view.value?.column;
  direction.value = current === column ? (direction.value === 1 ? -1 : 1) : 1;
  sortBy.value = column;
}
const ariaSort = (column: PayoffColumn) =>
  view.value?.column === column ? (direction.value === 1 ? 'ascending' : 'descending') : 'none';

// Runs the ranking for the phase on screen and the ones after it, and shows it, unless another
// profile was opened meanwhile (the result is stored with the profile it was run for either way).
// The button is busy while it runs (bound aria-disabled, app/busy.ts: it keeps focus, #299), and
// once the ranking shows a polite announcement says so (app/announce.ts, #1255).
async function rank() {
  if (running.value) return;
  const profileId = currentProfile.id;
  running.value = 'Checking alternates…';
  try {
    const result = await post<StoredPayoff>(
      '/api/rank-alternates',
      { phase: stage(), remaining: true, hunting: true },
      true,
      {
        onRankProgress: (done, total) =>
          (running.value = `Checking ${num(done)} of ${num(total)} alternates…`),
      },
    );
    if (currentProfile.id !== profileId) return;
    setPayoff(result);
    render();
    announce(rankedMessage(result.ranking));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    running.value = '';
  }
}

// "Add as hunting": the recalculation in place every plan offer makes, after its confirmation.
function addHunting(event: Event, row: NonNullable<(typeof view)['value']>['rows'][number]) {
  if (!row.hunt) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: row.hunt,
    change: `with ${row.name} allowed as a recipe to hunt`,
    label: ADD_LABEL,
  });
}
</script>

<template>
  <section v-if="view" class="panel payoff" data-payoff>
    <div class="section-head">
      <h2>Best next hard drive</h2>
      <button
        class="btn"
        data-rank-alternates
        :aria-disabled="!!running || undefined"
        @click="rank"
      >
        {{ view.ranking ? 'Re-rank' : 'Rank alternates' }}
      </button>
    </div>
    <!-- Ranking solves a transcribed handbook afresh, once per alternate (#480). -->
    <p v-if="transcribed" class="notice warn" data-resolve-warning>{{ RESOLVE_WARNING }}</p>
    <p v-if="running" class="small" data-payoff-progress role="status">
      {{ running }}
      This can take up to {{ RANK_LIMIT }}, or longer while other rankings are running.
    </p>
    <template v-if="!view.ranking">
      <p class="small muted">
        Which hard drive to spend next: what each alternate recipe would change in the plan from
        {{ view.phase }} on (buildings, raw resources, power and delivery time), and what each
        recipe you are hunting saves once found. It recalculates the plan once per alternate and
        keeps the result with this profile.
      </p>
      <p v-if="view.otherPhase" class="small muted" data-payoff-other>
        The stored ranking is for {{ view.otherPhase }}.
      </p>
    </template>
    <template v-else>
      <p class="small muted" data-payoff-summary>
        {{ view.ranking.candidates.length }} of {{ view.ranking.total }} alternates checked for
        {{ view.phases }}<template v-if="view.when">, {{ view.when }}</template
        >. Negative is better: fewer buildings, less raw, less power, sooner done.
      </p>
      <p v-if="view.ranking.stopped" class="notice error" data-payoff-stopped role="status">
        The ranking stopped at its time limit; Re-rank to try again.
      </p>
      <p v-if="!view.ranking.total" class="small" data-payoff-none>
        Every alternate available by {{ view.phase }} is already allowed in this profile.
      </p>
      <label v-if="view.ranking.total" class="payoff-threshold small"
        >Show alternates that save at least
        <select v-model.number="threshold" data-payoff-threshold>
          <option v-for="n in THRESHOLDS" :key="n" :value="n">
            {{ n ? `${n} ${n === 1 ? 'building' : 'buildings'}` : 'any number of buildings' }}
          </option>
        </select></label
      >
      <div v-if="view.rows.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Alternate</th>
              <th>Effect</th>
              <th v-for="[key, label] in view.columns" :key="key" :aria-sort="ariaSort(key)">
                <button class="link" :data-payoff-sort="key" @click="sort(key)">
                  {{ label }}{{ view.column === key ? (direction === 1 ? ' ▲' : ' ▼') : '' }}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in view.rows" :key="row.id" :data-payoff-row="row.id">
              <td>
                <button class="link" :data-payoff-recipe="row.id" @click="openAltRecipe(row.id)">
                  {{ row.name }}
                </button>
                <span class="small muted">{{ row.machine }}</span>
                <span v-if="row.hunting" class="small muted" data-payoff-hunting
                  >Hunting: if found</span
                ><button
                  v-else-if="row.hunt"
                  type="button"
                  class="btn quiet payoff-hunt"
                  :data-payoff-hunt="row.id"
                  :aria-label="`Add ${row.name} as a recipe to hunt`"
                  @click="addHunting($event, row)"
                >
                  {{ ADD_LABEL }}
                </button>
              </td>
              <td :class="'payoff-' + (row.needed ? 'needed' : row.status)" :title="row.error">
                {{ row.label }}
              </td>
              <td v-for="(cell, i) in row.cells" :key="i" class="number">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="view.hidden" class="small muted" data-payoff-hidden>
        {{ view.hidden }} more {{ view.hidden === 1 ? 'alternate saves' : 'alternates save' }}
        fewer buildings than that.
      </p>
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
