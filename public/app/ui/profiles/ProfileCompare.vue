<!--
  "Compare profiles" under a save's cards on Saves & profiles (#1074, compareView in
  app/profile-compare.ts): with two or more calculated profiles, one phase's buildings, buildings
  to add, build materials, power, ore, oil, alternates and delivery time per profile, each with its
  difference from the baseline, then every planned phase's time to finish and the total, the
  fastest marked. The figures come from the stored plans, nothing calculated again; the time to
  finish adds an estimated building time, the buildings to add times the minutes per building set
  here (buildMinutes in session.ts, a view preference remembered in this browser, never stored
  with a profile; 0 compares delivery time only). The baseline starts as the open profile (else
  the save's active one) and the phase as the one the baseline works on; both pickers are view
  state, never stored. Each table scrolls sideways inside its own box when it does not fit
  (ui/scroll-box.ts), with the profile column kept in view.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { compareView, type ComparedProfile } from '../../profile-compare.ts';
import { BUILD_MINUTES_MAX, buildMinutes, setBuildMinutes } from '../../session.ts';
import { render } from '../../shell.ts';
import { useScrollBox } from '../scroll-box.ts';

const props = defineProps<{
  saveId: string;
  profiles: ComparedProfile[];
  // The profile the comparison starts from, and the phase it starts on.
  baseline: string;
  phase: string;
}>();

const chosenBaseline = ref(props.baseline);
const chosenPhase = ref(props.phase);
const minutes = ref(buildMinutes);
const view = computed(() =>
  compareView(props.profiles, chosenBaseline.value, chosenPhase.value, minutes.value),
);
// A new estimate is remembered in this browser; one out of range puts the field back. ADA's line
// follows it, so the page is drawn again.
function changeMinutes(event: Event) {
  const input = event.target as HTMLInputElement;
  setBuildMinutes(input.value);
  minutes.value = buildMinutes;
  input.value = String(buildMinutes);
  render();
}
const baselineName = computed(
  () => view.value?.rows.find(row => row.id === view.value?.baselineId)?.name ?? '',
);
const phaseBox = useScrollBox('phaseTable'),
  timeBox = useScrollBox('timeTable');
const id = (what: string) => `compare-${what}-${props.saveId}`;
</script>

<template>
  <section
    v-if="view"
    class="profile-compare"
    :aria-labelledby="id('heading')"
    :data-profile-compare="saveId"
  >
    <h3 :id="id('heading')">Compare profiles</h3>
    <p class="small muted">
      Figures from each profile's plan as it was calculated; nothing is recalculated. Differences
      are against the baseline: <span class="delta lower">−</span> is fewer or sooner,
      <span class="delta higher">+</span> more or later.
    </p>
    <div class="compare-pickers">
      <label
        >Baseline
        <select v-model="chosenBaseline" data-compare-baseline>
          <option v-for="row in view.rows" :key="row.id" :value="row.id">{{ row.name }}</option>
        </select>
      </label>
      <label
        >Phase
        <select v-model="chosenPhase" data-compare-phase>
          <option v-for="phase in view.phases" :key="phase" :value="phase">
            Phase {{ phase }}
          </option>
        </select>
      </label>
    </div>
    <div
      ref="phaseTable"
      class="compare-table"
      data-compare-phase-table
      v-bind="phaseBox.scrollAttrs(`Phase ${view.phase} by profile`)"
    >
      <table>
        <caption class="visually-hidden">
          Phase
          {{
            view.phase
          }}
          by profile, against
          {{
            baselineName
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Profile</th>
            <th v-for="column in view.columns" :key="column" scope="col">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in view.rows"
            :key="row.id"
            :class="{ baseline: row.baseline }"
            :data-compare-row="row.id"
          >
            <th scope="row">
              {{ row.name }}
              <span v-if="row.baseline" class="compare-tag" data-compare-baseline-tag
                >Baseline</span
              >
              <span v-if="row.note" class="compare-note">{{ row.note }}</span>
            </th>
            <td v-for="(cell, index) in row.cells" :key="index" :data-compare-cell="index">
              <span class="compare-value">{{ cell.text }}</span>
              <span v-if="cell.delta" :class="['delta', cell.delta.trend]" data-compare-delta>{{
                cell.delta.text
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted" data-compare-workload-note>
      Buildings to add: the machines each phase adds to its production lines, all of them in the
      first phase and then those beyond what the phase before runs on the same line. Build
      materials: the parts those buildings cost. Miners, extractors, belts and pipes are not
      counted.
    </p>
    <h4>Time to finish</h4>
    <p class="small muted" data-compare-time-note>
      Delivery time, how long each phase's production lines take to make its Space Elevator parts as
      the build plan gives it, plus an estimated building time: the buildings to add times the
      minutes per building below. The planner does not measure building time, so that part is your
      estimate, remembered in this browser; set 0 to compare delivery time only.
    </p>
    <div class="compare-pickers">
      <label
        >Minutes per building (estimate)
        <input
          type="number"
          min="0"
          :max="BUILD_MINUTES_MAX"
          step="0.5"
          inputmode="decimal"
          :value="minutes"
          data-compare-build-minutes
          @change="changeMinutes"
      /></label>
    </div>
    <div
      ref="timeTable"
      class="compare-table"
      data-compare-time-table
      v-bind="timeBox.scrollAttrs('Time to finish by profile')"
    >
      <table>
        <caption class="visually-hidden">
          Time to finish by profile, against
          {{
            baselineName
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Profile</th>
            <th v-for="phase in view.phases" :key="phase" scope="col">Phase {{ phase }}</th>
            <th scope="col">All phases</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in view.time"
            :key="row.id"
            :class="{ baseline: row.baseline }"
            :data-compare-time="row.id"
          >
            <th scope="row">
              {{ row.name }}
              <span v-if="row.baseline" class="compare-tag">Baseline</span>
            </th>
            <td v-for="(cell, index) in row.phases" :key="index" :data-compare-time-cell="index">
              <span class="compare-value">{{ cell.text }}</span>
              <span
                v-for="part in cell.parts ?? []"
                :key="part"
                class="compare-note"
                data-compare-time-parts
                >{{ part }}</span
              >
            </td>
            <td data-compare-total>
              <span class="compare-value">{{ row.total.text }}</span>
              <span v-if="row.covers" class="compare-note">{{ row.covers }}</span>
              <span
                v-for="part in row.total.parts ?? []"
                :key="part"
                class="compare-note"
                data-compare-total-parts
                >{{ part }}</span
              >
              <span
                v-if="row.total.delta"
                :class="['delta', row.total.delta.trend]"
                data-compare-delta
                >{{ row.total.delta.text }}</span
              >
              <span v-if="row.fastest" class="compare-tag best" data-compare-fastest>Fastest</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="view.otherPhases.length" class="small muted" data-compare-other-phases>
      Only profiles that plan the same phases as the baseline are compared for the fastest.
    </p>
  </section>
</template>
