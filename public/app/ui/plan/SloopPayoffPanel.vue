<!--
  "Where a somersloop pays off most" on a calculated profile's build plan (#1215, slice 7 of #1079),
  in its Somersloops tab (#1243): for each line of the phase on screen
  that could take somersloops under the planner's rules, what one amplified machine there would
  save at the plan's own rates (app/sloop-payoff.ts), best first by the raw resources per minute
  it saves per somersloop, every line (the tab has room, #1243). It is a table (BP-8, #1340): the
  line, its somersloops, the machines it saves, the raw resources saved per somersloop and the
  power change, with a sortable header per column (a button in the <th> with aria-sort, as the
  Hard drives tab's table, PayoffPanel.vue) and a Pin action per row. A line's name opens its
  production line dialog; Pin opens the same dialog with focus on its somersloop pin field
  (SloopPinChoice.vue), where the pin is saved. Presentation only: nothing is solved, stored or
  recalculated; "Change somersloops in Edit settings →" opens step 2, where the amplification
  budget is, and only its Review recalculates. Nothing shows before Phase 3 (the Production
  Amplifier research), for a phase with no such line, or in "New to Satisfactory" mode (#1076),
  which hides clock details.
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
import { startEdit } from '../../wizard/wizard.ts';
import {
  AMPLIFIER_RESEARCH,
  sloopCommitment,
  sloopPartsWords,
  type SloopCommitment,
} from '../../../somersloops.ts';
import { localeNumber } from '../../../wording.ts';
import { displayPower, displayRate, figureText, formatNumber } from '../../../numbers.ts';
import { factoryLink } from '../actions.ts';
import { legacy } from '../bridge.ts';

// Raw resources a minute to one decimal: an estimate needs no more.
const oneDecimal = (value: number | null | undefined) => localeNumber(value, 1);
// How many raw resources a line names.
const RAW_NAMED = 3;

// Every space becomes a non-breaking one, so a two-word name stays whole at 390 px (#1019):
// "−340 Iron Ore/min".
const together = (words: string) => words.replace(/ /g, ' ');
// "−340 Iron Ore/min, −120 Limestone/min and 1 more": the raw resources a line saves, by item.
function rawWords(entry: SloopPayoff): string {
  const named = entry.raw
    .slice(0, RAW_NAMED)
    .map(([item, rate]) => '−' + together(rateOfItem(item, rate, oneDecimal)));
  const more = entry.raw.length - RAW_NAMED;
  return more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', ');
}
// "+30 MW", "−1.2 MW" or "no change": the net power change, signed, in the app's power format.
function powerWords(net: number): string {
  if (Math.abs(net) < 0.005) return 'no change';
  return (net > 0 ? '+' : '−') + together(figureText(displayPower(Math.abs(net))));
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

// The columns the table sorts by (BP-8, #1340). The ranking is best first by raw resources saved
// per somersloop, so that is the order shown until a header is pressed. A first press sorts a
// number largest first (power: the biggest saving first) and the line's name A to Z; a second
// press reverses it.
type Column = 'line' | 'sloops' | 'machines' | 'perSloop' | 'power';
const COLUMNS: { key: Column; label: string; first: 1 | -1 }[] = [
  { key: 'line', label: 'Line', first: 1 },
  { key: 'sloops', label: 'Somersloops', first: -1 },
  { key: 'machines', label: 'Machines saved', first: -1 },
  { key: 'perSloop', label: 'Raw resources saved per somersloop', first: -1 },
  { key: 'power', label: 'Power change', first: 1 },
];
const sortKey = ref<Column>('perSloop');
const direction = ref<1 | -1>(-1);
function sortBy(column: (typeof COLUMNS)[number]) {
  if (sortKey.value === column.key) direction.value = direction.value === 1 ? -1 : 1;
  else {
    sortKey.value = column.key;
    direction.value = column.first;
  }
}
const ariaSort = (key: Column) =>
  sortKey.value === key ? (direction.value === 1 ? 'ascending' : 'descending') : 'none';
const arrow = (key: Column) => (sortKey.value === key ? (direction.value === 1 ? ' ▲' : ' ▼') : '');

function sortValue(entry: SloopPayoff, key: Column): number | string {
  if (key === 'line') return entry.name;
  if (key === 'sloops') return entry.sloops;
  if (key === 'machines') return entry.machinesSaved;
  if (key === 'perSloop') return entry.perSloop;
  return entry.netMW;
}

const view = computed(() =>
  legacy(() => {
    if (beginnerMode() || !calculated) return null;
    const entries = sloopPayoffs(calcStage(), stage(), calculated.settings);
    if (!entries.length) return null;
    const commitment = sloopCommitment(calculated.settings);
    const key = sortKey.value,
      sign = direction.value;
    // Array.sort is stable: lines that tie stay in the ranking's order.
    const sorted = [...entries].sort((a, b) => {
      const x = sortValue(a, key),
        y = sortValue(b, key);
      return sign * (typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y));
    });
    const lines = sorted.map(entry => ({
      id: entry.id,
      name: entry.name,
      // "(one Assembler)": what the somersloops go into, when a machine takes more than one.
      machine: entry.sloops > 1 ? `one ${entry.machine}` : '',
      sloops: formatNumber(entry.sloops),
      saved:
        entry.machinesSaved > 0
          ? `−${num(entry.machinesSaved)} ${buildingName(entry.machine, entry.machinesSaved)}`
          : 'none',
      raw: rawWords(entry),
      perSloop: figureText(displayRate(entry.perSloop, '/min')),
      power: powerWords(entry.netMW),
    }));
    return { lines, budget: budgetWords(commitment) };
  }),
);

// "Pin": the somersloop pin is saved in the production line's dialog (SloopPinChoice.vue), so
// the button opens that dialog (factoryLink's click, which runs first) and puts focus on the
// pin field once the dialog has drawn it.
function focusPin(id: string) {
  setTimeout(() => document.getElementById('sloop-pin-' + id)?.focus(), 50);
}

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
    <div class="table-wrap" tabindex="0" role="region" aria-label="Somersloop payoff by line">
      <table class="sloop-table" data-sloop-table>
        <thead>
          <tr>
            <th
              v-for="column in COLUMNS"
              :key="column.key"
              :aria-sort="ariaSort(column.key)"
              :class="column.key === 'line' ? '' : 'number'"
            >
              <button
                type="button"
                class="link"
                :data-sloop-sort="column.key"
                @click="sortBy(column)"
              >
                {{ column.label }}{{ arrow(column.key) }}
              </button>
            </th>
            <th><span class="visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in view.lines" :key="line.id" :data-sloop-line="line.id">
            <th scope="row" class="sloop-name">
              <button
                type="button"
                class="link"
                v-bind="factoryLink({ calcFactory: line.id })"
                :aria-label="'Production line: ' + line.name"
              >
                {{ line.name }}</button
              ><span v-if="line.machine" class="small muted"> ({{ line.machine }})</span>
              <span class="small muted sloop-raw" data-sloop-raw>{{ line.raw }}</span>
            </th>
            <td class="number" data-sloop-cell="sloops">{{ line.sloops }}</td>
            <td class="number" data-sloop-cell="machines">{{ line.saved }}</td>
            <td class="number" data-sloop-cell="perSloop">{{ line.perSloop }}</td>
            <td class="number" data-sloop-cell="power">{{ line.power }}</td>
            <td>
              <button
                type="button"
                class="btn quiet"
                v-bind="factoryLink({ calcFactory: line.id })"
                :data-sloop-pin-open="line.id"
                :aria-label="'Pin somersloops on ' + line.name"
                @click="focusPin(line.id)"
              >
                Pin
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
