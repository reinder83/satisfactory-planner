<!--
  Create stations from train links (#1301), in #detail (kind 'trains'): the preview of what the
  Logistics page's Trains tab proposes for each link of the phase shown that goes by train
  (proposeTrains in app/train-proposal.ts): a pick-up station at the supplying factory or a mining
  outpost, a drop-off station at the receiving factory, their platforms with the cargo, and a line
  between them with the wagons its rate and round trip need. Each proposed link has a checkbox,
  ticked to start with, and its round trip, which the player may edit: the map's estimate where
  both ends have a place on the world map (marked as an estimate), else the link's own. A link
  whose items a line already carries is listed as served, and one with an end that cannot have a
  station says why; neither has a checkbox. Nothing is saved before Create, which adds the ticked
  links' new stations and lines in one write with Undo in the toast (ui/train-proposal-actions.ts);
  Cancel, × and Escape save nothing. Focus then goes back to the button that opened it.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ROUND_TRIP_MAX, roundTripOf } from '../../../state.ts';
import { whileBusy } from '../../busy.ts';
import { required } from '../../format.ts';
import { phase, phaseLabel } from '../../session.ts';
import { newLineId, DIRECTION_TEXT } from '../../train-lines.ts';
import { newStationId, ownerText, platformCounts } from '../../train-stations.ts';
import {
  createdEntries,
  proposeTrains,
  ratesText,
  STOP_DWELL,
  TRACK_FACTOR,
  TRAIN_SPEED,
  trainText,
  wagonText,
  type LinkProposal,
  type StationPick,
} from '../../train-proposal.ts';
import { phaseTrainLinks, proposalWorld } from '../../views/trains.ts';
import { listNames, localeNumber } from '../../../wording.ts';
import { closeDetail } from '../actions.ts';
import { legacy } from '../bridge.ts';
import { createTrains } from '../train-proposal-actions.ts';
import DialogFrame from './DialogFrame.vue';

// New ids, made once per link and role while the dialog is open, so the preview keeps them.
const made = new Map<string, string>();
const ids = (kind: 'ts' | 'tl', key: string, role: string) => {
  const at = `${kind}|${key}|${role}`;
  if (!made.has(at)) made.set(at, kind === 'ts' ? newStationId() : newLineId());
  return made.get(at)!;
};

// The links the player unticked, and the round trips typed ('' for a cleared box), by link key.
const unticked = ref(new Set<string>());
const typed = ref<Record<string, number | ''>>({});
const bad = ref(new Set<string>());

const trips = computed(() => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(typed.value)) {
    const minutes = value === '' ? null : roundTripOf(value);
    if (minutes) out[key] = minutes;
  }
  return out;
});
const links = computed(() => legacy(() => phaseTrainLinks()));
const proposals = computed(() =>
  legacy(() =>
    proposeTrains(links.value, proposalWorld(), {
      ids,
      trips: trips.value,
      unticked: unticked.value,
    }),
  ),
);
const facts = computed(() => legacy(() => proposalWorld().facts));
const groups = computed(() => legacy(() => proposalWorld().groups));
const phaseName = computed(() => legacy(() => phaseLabel(phase())));

const isTicked = (key: string) => !unticked.value.has(key);
function tick(key: string, on: boolean) {
  const next = new Set(unticked.value);
  if (on) next.delete(key);
  else next.add(key);
  unticked.value = next;
}
const chosen = computed(() =>
  createdEntries(
    proposals.value,
    new Set(proposals.value.filter(p => isTicked(p.key)).map(p => p.key)),
  ),
);
const proposed = computed(() => proposals.value.filter(p => p.status === 'propose'));
const createText = computed(() => {
  const { stations, lines } = chosen.value;
  if (!lines.length) return 'Create';
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`;
  return `Create ${count(stations.length, 'station')} and ${count(lines.length, 'line')}`;
});

// The words of one proposal.
const figure = (value: number) => localeNumber(value, 1);
// Line names in a sentence: “Ore run” and “Plate run”.
const lineNames = (names: string[]) => listNames(names.map(name => `“${name}”`));
function stationText(role: 'Pick-up' | 'Drop-off', pick: StationPick): string {
  const owner = ownerText(pick.station.owner, groups.value);
  return pick.reused
    ? `${role}: your station “${pick.station.name}” (${owner}), as it is: ${platformCounts(pick.station.platforms)}.`
    : `${role}: new station “${pick.station.name}” (${owner}), ${platformCounts(pick.station.platforms)}.`;
}
function lineText(proposal: LinkProposal): string {
  const line = proposal.line!;
  const wagons = proposal.wagons.map(wagonText).join('; ');
  return `Line: “${line.name}”, ${DIRECTION_TEXT[line.direction].label.toLowerCase()}, ${trainText(proposal)}: ${wagons}.`;
}
const ASSUMED = `about ${figure(TRAIN_SPEED * 3.6)} km/h on track ${figure(TRACK_FACTOR)} times the straight line and ${figure(STOP_DWELL * 60)} seconds at each stop`;
function tripNote(proposal: LinkProposal): string {
  const apart = proposal.estimate
    ? `The stations are ${figure(proposal.estimate.km)} km apart on the map`
    : '';
  if (proposal.tripSource === 'map')
    return `${apart}; this assumes ${ASSUMED}. Edit it once you have timed a round in the game.`;
  const own =
    proposal.tripSource === 'edited' ? 'As you entered it.' : 'The round trip saved on the link.';
  return proposal.estimate
    ? `${own} ${apart}: about ${figure(proposal.estimate.minutes)} minutes, assuming ${ASSUMED}.`
    : `${own} With both ends placed on the world map, the distance gives an estimate.`;
}
const tripValue = (proposal: LinkProposal) =>
  typed.value[proposal.key] !== undefined ? typed.value[proposal.key] : proposal.roundTrip;
function typeTrip(key: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value === '' ? '' : Number(input.value);
  typed.value = { ...typed.value, [key]: value };
  if (bad.value.has(key) && value !== '' && roundTripOf(value)) {
    const next = new Set(bad.value);
    next.delete(key);
    bad.value = next;
  }
}
const domKey = (key: string) => key.replace(/[^a-zA-Z0-9-]/g, '_');

async function create(event: Event) {
  const element = event.currentTarget as HTMLFormElement;
  // A round trip that is no number of minutes in range is refused under its box.
  const wrong = proposed.value.filter(proposal => {
    const value = typed.value[proposal.key];
    return (
      isTicked(proposal.key) && value !== undefined && !roundTripOf(value === '' ? NaN : value)
    );
  });
  bad.value = new Set(wrong.map(proposal => proposal.key));
  if (wrong.length) {
    await nextTick();
    element
      .querySelector<HTMLInputElement>(`[data-proposal-trip="${CSS.escape(wrong[0]!.key)}"]`)
      ?.focus();
    return;
  }
  const { stations, lines } = chosen.value;
  if (!lines.length) return;
  const saved = await whileBusy(element.querySelector<HTMLElement>('[data-proposal-create]')!, () =>
    createTrains(stations, lines),
  );
  if (!saved) return;
  required<HTMLDialogElement>('#detail').close();
  // The button that opened the preview stays on the page, so focus goes back to it (a re-run is
  // one press away).
  await nextTick();
  document.querySelector<HTMLElement>('#main [data-trains-from-links-open]')?.focus();
}
</script>

<template>
  <DialogFrame title="Create stations from train links" subtitle="Trains">
    <p v-if="!links.length" class="notice info" data-proposal-none>
      No link goes by train in {{ phaseName }}. Pick Train under By on a link of the Between
      factories tab, and this proposes its stations and line.
    </p>
    <form
      v-else
      class="station-form proposal-form"
      data-proposal-form
      novalidate
      @submit.prevent="create"
    >
      <p class="small muted">
        For each link that goes by train in {{ phaseName }}: a pick-up station, a drop-off station
        and a line between them, with the wagons its rate and round trip need. Untick a link to
        leave it out. Nothing is saved until you press Create, and a link that already has a line
        gets nothing new.
      </p>
      <ul class="proposal-list" aria-label="Train links">
        <li
          v-for="proposal in proposals"
          :key="proposal.key"
          class="group-card proposal-card"
          :data-proposal="proposal.key"
          :data-proposal-status="proposal.status"
        >
          <template v-if="proposal.status === 'propose'">
            <label class="check-row proposal-pick"
              ><input
                type="checkbox"
                :checked="isTicked(proposal.key)"
                :data-proposal-pick="proposal.key"
                :aria-describedby="`proposal-${domKey(proposal.key)}`"
                @change="tick(proposal.key, ($event.target as HTMLInputElement).checked)"
              />
              <strong>{{ proposal.fromName }} to {{ proposal.toName }}</strong></label
            >
            <div :id="`proposal-${domKey(proposal.key)}`" class="proposal-parts">
              <p class="small" data-proposal-rates>{{ ratesText(proposal.missing, facts) }}</p>
              <ul class="small">
                <li data-proposal-pickup>{{ stationText('Pick-up', proposal.pickup!) }}</li>
                <li data-proposal-dropoff>{{ stationText('Drop-off', proposal.dropoff!) }}</li>
                <li data-proposal-line>{{ lineText(proposal) }}</li>
                <li v-if="proposal.servedBy.length" data-proposal-partly>
                  {{
                    ratesText(
                      proposal.items.filter(entry => !proposal.missing.includes(entry)),
                      facts,
                    )
                  }}
                  already goes by {{ lineNames(proposal.servedBy) }}, so only the rest is proposed.
                </li>
              </ul>
              <p v-if="proposal.wanted" class="notice warn" data-proposal-long>
                The rate needs {{ proposal.wanted }} wagons, more than one train pulls: this line
                has {{ proposal.wagons.reduce((sum, wagon) => sum + wagon.wagons, 0) }}. Add a
                second line for the rest.
              </p>
            </div>
            <label class="field proposal-trip"
              >Round trip (minutes)<input
                type="number"
                inputmode="decimal"
                min="0.1"
                :max="ROUND_TRIP_MAX"
                step="0.1"
                :value="tripValue(proposal)"
                :data-proposal-trip="proposal.key"
                :data-trip-source="proposal.tripSource"
                :aria-invalid="bad.has(proposal.key) ? 'true' : undefined"
                :aria-describedby="`trip-${domKey(proposal.key)} trip-error-${domKey(proposal.key)}`"
                @input="typeTrip(proposal.key, $event)"
            /></label>
            <p :id="`trip-${domKey(proposal.key)}`" class="small muted" data-proposal-trip-note>
              <strong v-if="proposal.tripSource === 'map'" class="proposal-estimate"
                >Estimate.</strong
              >
              {{ tripNote(proposal) }}
            </p>
            <p
              :id="`trip-error-${domKey(proposal.key)}`"
              class="form-error"
              role="alert"
              v-text="
                bad.has(proposal.key)
                  ? `Give the round trip in minutes, above 0 and at most ${ROUND_TRIP_MAX}.`
                  : ''
              "
            ></p>
          </template>
          <template v-else>
            <h3 class="proposal-title">{{ proposal.fromName }} to {{ proposal.toName }}</h3>
            <p class="small" data-proposal-rates>{{ ratesText(proposal.items, facts) }}</p>
            <p v-if="proposal.status === 'served'" class="small muted" data-proposal-served>
              Already goes by {{ lineNames(proposal.servedBy) }}: nothing to add.
            </p>
            <p v-else class="small muted" data-proposal-skipped>{{ proposal.reason }}</p>
          </template>
        </li>
      </ul>
      <p v-if="!proposed.length" class="small" data-proposal-nothing>
        Every link that goes by train already has a line, so there is nothing to add.
      </p>
      <div class="detail-actions">
        <button
          type="submit"
          class="btn primary"
          data-proposal-create
          :disabled="!chosen.lines.length"
        >
          {{ createText }}
        </button>
        <button type="button" class="btn" data-proposal-cancel @click="closeDetail">Cancel</button>
      </div>
    </form>
  </DialogFrame>
</template>
