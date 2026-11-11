<!--
  "Best next hard drive" on a calculated profile's plan page (#204, part 3 of #67; #1075), in its
  Hard drives tab (#1243): what each alternate recipe would change
  in the plan. "Rank alternates" runs POST /api/rank-alternates (#203) for the phase on screen and
  every later one the plan builds, with the recipes the plan counts on but the player does not own
  (`remaining` and `hunting`, #1075), and stores the result with the profile; a stored ranking for
  this phase shows at once, one made before #1075 as it was (that phase alone). Nothing is ranked
  or recalculated until the user presses the button.

  A ranking takes up to two minutes (#1332, BUG-7), so it runs in app/rank-job.ts, which outlives
  this panel: while it runs the panel shows "Checking 12 of 58 alternates…" with a progress bar and
  Cancel, which stops it before its next alternate and keeps those checked so far, marked partial.
  The user can leave the tab or the page and come back to the same progress; when it finishes
  elsewhere a toast, a polite announcement and ADA say so.

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
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  PAYOFF_COLUMNS,
  PAYOFF_STATUS,
  PAYOFF_WORDS,
  payoffDelta,
  payoffTable,
  rankedPhases,
  type PayoffColumn,
} from '../../payoff.ts';
import { cancelRank, clearRankDone, rankLabel, startRank, wasCancelled } from '../../rank-job.ts';
import { RANK_LIMIT, rankLeftOut, rankLive, rankRun } from './rank-state.ts';
import { huntingSettings } from '../../recipe-states.ts';
import { beginnerMode } from '../../beginner.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { calcStage, calculated, currentProfile, payoff, phaseLabel, stage } from '../../session.ts';
import { openAltRecipe } from '../../wizard/recipes.ts';
import { legacy } from '../bridge.ts';
import { recalculateOffer } from '../recalc-offer.ts';

// The chosen sort; null is Δ buildings (#1075).
const sortBy = ref<PayoffColumn | null>(null);
const direction = ref<1 | -1>(1);
// The ranking that is running, from app/rank-job.ts (which outlives this panel); null otherwise.
const run = computed(() => rankRun.current);
const running = computed(() => !!run.value);
// "Checking 23 of 67 alternates…" while it runs.
const label = computed(() => (run.value ? rankLabel(run.value) : ''));
const otherProfile = computed(() => !!run.value && run.value.profileId !== currentProfile.id);
// Cancel was pressed from the keyboard or pointer: when the progress goes, focus goes back to the
// button that started it rather than to <body>.
let refocus = false;
watch(running, now => {
  if (now) return;
  const focusLost = refocus || !document.activeElement || document.activeElement === document.body;
  refocus = false;
  if (focusLost)
    void nextTick(() =>
      document.querySelector<HTMLButtonElement>('[data-rank-alternates]')?.focus(),
    );
});
function cancel() {
  refocus = true;
  void cancelRank();
}
// A ranking that finished while the user was elsewhere has had its say with ADA once it is looked
// at here.
onMounted(clearRankDone);
// The payoff threshold (#1075): only rows saving at least this many buildings; 0 shows all.
const THRESHOLDS = [0, 1, 5, 10, 20];
const threshold = ref(0);
const ADD_LABEL = 'Add as hunting';

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
      leftOut: ranking && rankLeftOut.value?.payoff === stored ? rankLeftOut.value.notes : [],
      cancelled: !!ranking && wasCancelled(ranking),
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

// "Rank alternates" starts the ranking (app/rank-job.ts), which the button is busy for while it runs
// (bound aria-disabled, app/busy.ts: it keeps focus, #299). A second press starts nothing (#1255).
function rank() {
  if (!running.value) void startRank();
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
    <!-- The ranking's progress (#1332). Its label is not a live region itself: one update per
         alternate would be read out every couple of seconds; the hidden status line is throttled
         (rankLive, app/rank-job.ts) and the finished ranking is announced separately. -->
    <div v-if="run" class="payoff-run" data-payoff-progress>
      <p id="payoff-run-label" class="payoff-run-label" data-payoff-label>{{ label }}</p>
      <div class="payoff-run-bar">
        <progress
          aria-labelledby="payoff-run-label"
          :max="run.total || undefined"
          :value="run.total && !run.queued ? run.done : undefined"
          data-payoff-bar
        ></progress>
        <button
          type="button"
          class="btn quiet"
          data-rank-cancel
          :aria-disabled="run.cancelling || undefined"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
      <span class="visually-hidden" role="status" data-payoff-live>{{ rankLive }}</span>
      <p class="small muted">
        <template v-if="otherProfile">This ranking is for another profile. </template>This can take
        up to {{ RANK_LIMIT }}, or longer while other rankings are running. You can leave this page
        or tab: the ranking carries on, and you are told when it is done. Cancel keeps what is
        checked so far.
      </p>
    </div>
    <template v-if="!view.ranking">
      <p class="small muted" data-payoff-empty>
        Shows which alternate recipe saves the most buildings, raw resources, power or delivery time
        from {{ view.phase }} on, and what each recipe you are hunting would save once found. Takes
        up to {{ RANK_LIMIT }}; the result stays with this profile.
      </p>
      <p v-if="view.otherPhase" class="small muted" data-payoff-other>
        The stored ranking is for {{ view.otherPhase }}.
      </p>
    </template>
    <template v-else>
      <p class="small muted" data-payoff-summary>
        <span v-if="view.ranking.stopped" class="payoff-partial" data-payoff-partial>Partial</span>
        {{ view.ranking.candidates.length }} of {{ view.ranking.total }} alternates checked for
        {{ view.phases }}<template v-if="view.when">, {{ view.when }}</template
        >. Negative is better: fewer buildings, less raw, less power, sooner done.
      </p>
      <p
        v-if="view.ranking.stopped"
        class="notice"
        :class="view.cancelled ? 'info' : 'error'"
        data-payoff-stopped
        role="status"
      >
        <template v-if="view.cancelled">You cancelled the ranking</template
        ><template v-else
          >The ranking stopped before it was done (cancelled, or at its time limit)</template
        >: the {{ view.ranking.candidates.length }} alternates checked are ranked below, the other
        {{ view.ranking.total - view.ranking.candidates.length }} are not. Re-rank to check them
        all.
      </p>
      <!-- Pins the ranking left out (#1273); any recalculation of the plan drops them. -->
      <p v-for="note in view.leftOut" :key="note" class="notice warn" data-payoff-left-out>
        {{ note }}
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
