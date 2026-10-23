<!--
  "Where a somersloop pays off most" on a calculated profile's build plan (#1215, slice 7 of #1079),
  after "Best next hard drive" and above the build sequence: for each line of the phase on screen
  that could take somersloops under the planner's rules, what one amplified machine there would
  save at the plan's own rates (app/sloop-payoff.ts), best first by the raw resources per minute
  it saves per somersloop. The first lines show until "Show all". A line's name opens its
  production line dialog. Presentation only: nothing is solved, stored or recalculated; "Change
  somersloops in Edit settings →" opens step 2, where the amplification budget is, and only its
  Review recalculates. Nothing shows before Phase 3 (the Production Amplifier research), for a
  phase with no such line, or in "New to Satisfactory" mode (#1076), which hides clock details.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { toast } from '../../api.ts';
import { beginnerMode } from '../../beginner.ts';
import { buildingName } from '../../../wording.ts';
import { rateOfItem } from '../../flow.ts';
import { num } from '../../format.ts';
import { calcStage, calculated, currentProfile, currentSave, stage } from '../../session.ts';
import { sloopPayoffs, type SloopPayoff } from '../../sloop-payoff.ts';
import { power } from '../../wizard/fields.ts';
import { startEdit } from '../../wizard/wizard.ts';
import {
  AMPLIFIER_RESEARCH,
  sloopCommitment,
  sloopPartsWords,
  type SloopCommitment,
} from '../../../somersloops.ts';
import { localeNumber } from '../../../wording.ts';
import { factoryLink } from '../actions.ts';
import { legacy } from '../bridge.ts';

// Raw resources a minute to one decimal: an estimate needs no more.
const oneDecimal = (value: number | null | undefined) => localeNumber(value, 1);
// How many lines show until "Show all", and how many raw resources a line names.
const FIRST_LINES = 5;
const RAW_NAMED = 3;
const showAll = ref(false);

// "1 somersloop", "4 somersloops": what one amplified machine of the line takes.
const sloopsWords = (entry: SloopPayoff) =>
  `${num(entry.sloops)} somersloop${entry.sloops === 1 ? '' : 's'}`;
// "−1 Manufacturer, −340 Iron Ore/min, −120 Limestone/min and 1 more, +30 MW".
function effectWords(entry: SloopPayoff): string {
  const named = entry.raw
    .slice(0, RAW_NAMED)
    .map(([item, rate]) => '−' + rateOfItem(item, rate, oneDecimal));
  const more = entry.raw.length - RAW_NAMED;
  const net = entry.netMW;
  return [
    entry.machinesSaved > 0
      ? `−${num(entry.machinesSaved)} ${buildingName(entry.machine, entry.machinesSaved)}`
      : '',
    more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', '),
    Math.abs(net) < 0.005 ? 'no change in power' : (net > 0 ? '+' : '−') + power(Math.abs(net)),
  ]
    .filter(Boolean)
    .join(', ');
}

// What the plan commits of the somersloops the profile has: "This plan commits 91 of the 106
// somersloops you have to spend: 3 parked in hand-fed lines and 88 for production amplification."
// '' when none were entered.
function budgetWords(commitment: SloopCommitment): string {
  const available = `the ${num(commitment.available)} somersloop${commitment.available === 1 ? '' : 's'} you have to spend`;
  if (!commitment.available) return '';
  if (!commitment.committed) return `This plan commits none of ${available}.`;
  return `This plan commits ${num(commitment.committed)} of ${available}: ${sloopPartsWords(commitment)}.`;
}

const view = computed(() =>
  legacy(() => {
    if (beginnerMode() || !calculated) return null;
    const entries = sloopPayoffs(calcStage(), stage(), calculated.settings);
    if (!entries.length) return null;
    const commitment = sloopCommitment(calculated.settings);
    const lines = entries.map(entry => ({
      id: entry.id,
      sloops: sloopsWords(entry),
      name: entry.name,
      machine: entry.sloops > 1 ? ` (one ${entry.machine})` : '',
      effects: effectWords(entry),
      perSloop:
        entry.sloops > 1 ? `${oneDecimal(entry.perSloop)} raw resources/min per somersloop` : '',
    }));
    return {
      lines: showAll.value ? lines : lines.slice(0, FIRST_LINES),
      total: lines.length,
      budget: budgetWords(commitment),
    };
  }),
);

const toPreferences = () =>
  void startEdit(currentSave.id, currentProfile.id, 2).catch(error =>
    toast((error as Error).message, true),
  );
</script>

<template>
  <section v-if="view" class="panel sloop-payoff" data-sloop-payoff>
    <h2>Where a somersloop pays off most</h2>
    <p class="small muted">
      One amplified machine makes what two make, from the input of one, at four times the power.
      Here is what that saves on each line of this phase at the plan’s rates, best first by raw
      resources saved per somersloop (Water does not count). An estimate: nothing is recalculated.
      Machines take somersloops once the MAM research {{ AMPLIFIER_RESEARCH }} is done.
    </p>
    <ol class="sloop-payoff-lines">
      <li v-for="line in view.lines" :key="line.id" :data-sloop-line="line.id">
        {{ line.sloops }} on
        <button
          type="button"
          class="link"
          v-bind="factoryLink({ calcFactory: line.id })"
          :aria-label="'Production line: ' + line.name"
        >
          {{ line.name }}</button
        >{{ line.machine }}: {{ line.effects
        }}<span v-if="line.perSloop" class="small muted"> · {{ line.perSloop }}</span>
      </li>
    </ol>
    <button
      v-if="view.total > FIRST_LINES"
      type="button"
      class="btn quiet"
      data-sloop-more
      @click="showAll = !showAll"
    >
      {{ showAll ? 'Show fewer' : `Show all ${view.total}` }}
    </button>
    <p class="small muted" data-sloop-budget>
      {{ view.budget ? view.budget + ' ' : '' }}To plan with somersloops, raise the amplification
      budget on step 2 of Edit settings; the plan is recalculated only when you press Recalculate in
      place.
      <button type="button" class="btn quiet" data-sloop-payoff-settings @click="toPreferences">
        Change somersloops in Edit settings →
      </button>
    </p>
  </section>
</template>
