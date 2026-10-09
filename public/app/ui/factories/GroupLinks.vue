<!--
  "Between factories" on the Logistics page (#184; on the calculated factories page until #229):
  what each factory group hands the next per minute, and the belt or pipe it needs, from
  groupLinks (group-links.ts). Only
  shown when the profile has groups; flows inside a group are the group's own belts and are
  left out. Group names are user text, rendered as text.
  One card per group (#213), Ungrouped too when it has links, with an In part (where each flow
  comes from) and an Out part (where it goes). Each raw resource and existing-supply item that
  sends anything gets a card of its own with only an Out part (#222, #231, #339), before the
  groups: mined resources first, then existing supply, the largest flow first within each. The destinations that are not groups (storage,
  fuel, the Space Elevator, the sink) only show as the other end of a row.
  Each link can instead go by truck, tractor, explorer, train or drone (#205): the user gives the
  round trip in minutes and, for a road vehicle, its fuel; linkLoad (logistics.ts) works out the
  vehicles and fuel. The controls sit on the sender's Out row only, so each link is edited in one
  place; the receiver's In row shows the belt or vehicle badge. The choice saves as a
  factoryLinkTransport update (factoryGroups.links).
  How a link travels is one choice the factory's flow page shares (linkCarrier in logistics.ts,
  #1067): Water from the Water source is pumped by Water Extractors at the site that uses it, so
  its link has no transport controls; a belted link puts its trickle items (trickleItems) on
  mixed belts and says so under its badge.
  A Space Elevator part delivered in full (its saved count at the target, #1062) is dimmed on its
  link to the elevator and marked "delivered"; the link stays, as the plan has it.
  Mining and belts per phase (#1065): a mined resource's card names the nodes the phase's draw
  taps (stageMiningAdvice in public/mining.ts), and while the best belt or pipe mark's milestone is
  not ticked a line under the intro says which one and the mark to plan with until then
  (laneUnlockNote in flow.ts).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { save, toast } from '../../api.ts';
import { num, plural } from '../../format.ts';
import { bestLane, FLUIDS, laneUnlockNote, lanePlan, rateOfItem } from '../../flow.ts';
import { stageMiningAdvice } from '../../../mining.ts';
import { deliveredParts } from '../../delivered.ts';
import {
  groupLinks,
  isSource,
  OUTSIDE,
  placeName,
  sourceItem,
  UNGROUPED,
} from '../../group-links.ts';
import {
  carrierTransport,
  DEFAULT_TRIP_MIN,
  EXTRACT_BADGE,
  LINK_MODES,
  linkBeltBadge,
  linkCarrier,
  linkSiblings,
  linkTotal,
  linkTransportUpdate,
  linkVehicleText,
  TRICKLE_SHARE,
  trickleItems,
  transportFuel,
} from '../../logistics.ts';
import { calcStage, calculated, stage as stageKey, state, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { fuelledModes } from '../../../state.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { legacy } from '../bridge.ts';
import { leaveDraft, resetDraft, useDrafts } from '../draft.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';
import ItemIcon from '../ItemIcon.vue';
import type { ItemRates, LinkMode, StageKey } from '../../../types/index.ts';

const view = computed(() =>
  legacy(() => {
    const stage = calcStage(),
      groupsState = factoryGroupsState();
    if (!calculated || !stage?.rows?.length || !groupsState.groups.length) return null;
    const name = (id: string) => placeName(id, groupsState.groups, stage.raw);
    // The parts delivered in full (#1062): their links to the Space Elevator say so.
    const delivered = deliveredParts(stage, stageKey(), state.deliveries);
    const links = groupLinks(stage, groupsState, calculated.settings.onSite).map(link => {
      // The one transport choice the flow page shares (linkCarrier, #1067): extracted Water
      // needs none, a saved vehicle, or belts and pipes.
      const key = link.from + ':' + link.to,
        carrier = linkCarrier(groupsState.links, link.from, link.to),
        transport = carrierTransport(carrier),
        extract = carrier.kind === 'extract';
      const mode: 'belt' | LinkMode = transport?.mode ?? 'belt';
      const vehicle = transport
        ? linkVehicleText(
            link.items,
            transport,
            workspace.catalog,
            FLUIDS,
            bestLane(false),
            bestLane(true),
          )
        : null;
      const items = link.items.map(({ item, rate }) => {
        const fluid = FLUIDS.has(item),
          pack =
            fluid && transport && transport.mode !== 'train'
              ? workspace.catalog.packaged?.[item]?.item
              : '',
          done = link.to === OUTSIDE.delivery && delivered.has(item);
        return {
          item,
          rate,
          fluid,
          pack: pack || '',
          delivered: done,
          // With its unit, as the part header above has it: 213,27/min, 139,36 m³/min (#462).
          text: `${num(rate)}${fluid ? ' m³' : ''}/min`,
          title: `${item}: ${num(rate)}${fluid ? ' m³' : ''}/min${pack ? `, as ${pack}` : ''}${done ? ', delivered' : ''}`,
        };
      });
      return {
        key,
        from: link.from,
        to: link.to,
        fromName: name(link.from),
        toName: name(link.to),
        transport,
        mode,
        fuelled: !!transport && fuelledModes.includes(transport.mode),
        items,
        packed: items.filter(item => item.pack),
        load: vehicle?.lines ?? [],
        extract,
        mixed: transport || extract ? '' : mixedText(link.items, link.to),
        // Protected storage fed from surplus first (#1061): how the link ends in game.
        overflow: link.to === OUTSIDE.storage && !!stage?.storageAsked,
        badge: extract
          ? EXTRACT_BADGE
          : (vehicle?.badge ?? linkBeltBadge(link.items, FLUIDS, lanePlan)),
      };
    });
    type Row = (typeof links)[number];
    const part = (dir: 'in' | 'out', rows: Row[]) => ({
      dir,
      rows,
      count: plural(rows.length, 'link'),
      total: linkTotal(rows.flatMap(r => r.items)),
    });
    const places = groupsState.groups.map(group => group.id);
    if (links.some(l => l.from === UNGROUPED || l.to === UNGROUPED)) places.push(UNGROUPED);
    // Groups nothing reaches or leaves (yet, in this phase) share one line instead of empty cards.
    const used = (id: string) => links.some(l => l.from === id || l.to === id);
    const cards = places.filter(used).map(id => ({
      id,
      name: name(id),
      parts: [
        part(
          'in',
          links.filter(l => l.to === id),
        ),
        part(
          'out',
          links.filter(l => l.from === id),
        ),
      ],
    }));
    // Each raw resource and existing-supply item is a source of its own (#231), which sends but
    // never receives: a card each with only an Out part, before the groups (#339), so every link,
    // straight to storage, fuel, the elevator or the sink too, has its sender's Out row and its
    // transport controls (#222). Mined resources come first, then existing supply, the largest
    // flow first within each.
    const mined = links.filter(l => isSource(l.from));
    const flow = (rows: Row[]) => rows.reduce((sum, row) => sum + row.items[0]!.rate, 0);
    const minedFirst = (id: string) => (stage.raw?.[sourceItem(id)] ? 0 : 1);
    // A mined resource's nodes (#1065), on a plan with mining per phase.
    const nodes = new Map(stageMiningAdvice(stage).map(entry => [entry.resource, entry.words]));
    const sources = [...new Set(mined.map(l => l.from))]
      .map(id => ({ id, rows: mined.filter(l => l.from === id) }))
      .sort((a, b) => minedFirst(a.id) - minedFirst(b.id) || flow(b.rows) - flow(a.rows))
      .map(({ id, rows }) => ({
        id,
        name: name(id),
        parts: [part('out', rows)],
        mining: nodes.get(sourceItem(id)) ?? '',
      }));
    cards.unshift(...sources);
    const idle = places.filter(id => !used(id)).map(name);
    // What the belts and pipes the links use still need (#1065): their milestones, until ticked.
    const unlock = [laneUnlockNote(bestLane(false)), laneUnlockNote(bestLane(true))]
      .filter(Boolean)
      .join(' ');
    return { links, cards, idle, unlock };
  }),
);
const fuels = computed(() => legacy(() => workspace.catalog.vehicleFuels || []));
const TRANSPORT_LABEL = 'Recalculate in place with transport fuel';

// The line under a belted link whose trickle items share a mixed belt (trickleItems, #1067):
// "The 14 items under 120/min share a mixed belt; Smart Splitters sort them where it arrives." The
// sink takes them mixed, so a link to it needs no sorting. '' without trickle items.
function mixedText(items: { item: string; rate: number }[], to: string): string {
  const trickle = trickleItems(items, FLUIDS, lanePlan);
  if (!trickle.size) return '';
  const rate = items.filter(entry => trickle.has(entry.item)).reduce((sum, e) => sum + e.rate, 0),
    lanes = lanePlan(rate, false),
    under = num(lanes.lane.cap * TRICKLE_SHARE);
  const share = `The ${trickle.size} items under ${under}/min share ${lanes.count > 1 ? lanes.count + ' mixed belts' : 'a mixed belt'}`;
  return to === OUTSIDE.surplus
    ? share + '.'
    : share +
        '; Smart Splitters sort them where ' +
        (lanes.count > 1 ? 'they arrive.' : 'it arrives.');
}
// A transcribed handbook says so before it is solved afresh (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

type Link = NonNullable<typeof view.value>['links'][number];
// Saves a link's transport with `change` applied (logistics.ts linkTransportUpdate); the page
// redraws with what was saved.
async function setTransport(
  control: HTMLInputElement | HTMLSelectElement,
  link: Link,
  change: { mode?: 'belt' | LinkMode; roundTripMin?: number; fuel?: string },
) {
  const update = linkTransportUpdate(
    link,
    change,
    linkSiblings(calculated?.stages, factoryGroupsState(), link, calculated?.settings.onSite),
  );
  // Busy while it saves (app/busy.ts, #299). A select changed by a key meanwhile saves nothing and
  // shows the saved choice again.
  if (isBusy(control)) return render();
  await whileBusy(control, async () => {
    try {
      await save(update);
    } catch {
    } finally {
      render();
    }
  });
}
// The round trip fields show the saved minutes, then what the user types, so a redraw while
// another control saves keeps minutes typed but not yet committed (#654, ui/draft.ts).
const savedTrips = (): Record<string, string> =>
  Object.fromEntries(
    (view.value?.links ?? []).flatMap(link =>
      link.transport ? [[link.key, String(link.transport.roundTripMin)]] : [],
    ),
  );
// Left without a commit, a field shows the saved minutes again (#687).
const trips = useDrafts(savedTrips);
// Then the saved minutes again, after a refused entry or a save (failed or not).
const savedTrip = (link: Link) => {
  const minutes =
    savedTrips()[link.key] ?? String(link.transport?.roundTripMin ?? DEFAULT_TRIP_MIN);
  resetDraft(trips, link.key, minutes);
  return minutes;
};

async function setTrip(event: Event, link: Link) {
  const input = event.target as HTMLInputElement,
    minutes = Number(input.value);
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 1440) {
    toast('Enter a round trip between 0.1 and 1,440 minutes.', true);
    input.value = savedTrip(link);
    return;
  }
  await setTransport(input, link, { roundTripMin: minutes });
  savedTrip(link);
}

// The fuel the links' vehicles burn per phase (#206), and whether this plan already plans for
// exactly that; the note under the links offers a recalculated revision when it does not.
type PhaseFuel = Partial<Record<StageKey, ItemRates>>;
const sameFuel = (a: PhaseFuel, b: PhaseFuel) => {
  const flat = (phases: PhaseFuel) =>
    Object.entries(phases)
      .flatMap(([phase, rates]) =>
        Object.entries(rates || {}).map(([item, rate]) => `${phase}|${item}|${rate}`),
      )
      .sort()
      .join(',');
  return flat(a) === flat(b);
};
const fuel = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const want = transportFuel(calculated, factoryGroupsState(), workspace.catalog, FLUIDS);
    const have = calculated.settings.transportFuel || {};
    if (!Object.keys(want).length && !Object.keys(have).length) return null;
    const text = (phases: PhaseFuel) =>
      Object.entries(phases)
        .map(
          ([phase, rates]) =>
            `Phase ${phase}: ` +
            Object.entries(rates || {})
              .map(([item, rate]) => rateOfItem(item, rate))
              .join(', '),
        )
        .join('; ');
    return { want, same: sameFuel(want, have), text: text(want), had: text(have) };
  }),
);

// "Recalculate in place with transport fuel": recalculates this profile in place with the fuel as
// extra demand (planner settings.transportFuel), after a confirmation that names the backup kept
// of the current version (recalculateOffer in ui/recalc-offer.ts, #1071): the progress is carried
// as Edit settings carries it (calc rows that grew are left for review). The button shows the
// calculation's progress meanwhile, busy so it keeps focus (#299); the recalculated page has no
// such button, so focus then goes to the page's heading (#300, #304).
function recalculate(event: Event) {
  const want = fuel.value?.want;
  if (!calculated || !want) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: { ...calculated.settings, transportFuel: want },
    change: 'with the vehicle fuel the links between factories burn now',
    label: TRANSPORT_LABEL,
  });
}
</script>

<template>
  <section v-if="view" class="panel group-links" data-group-links>
    <h2>Between factories</h2>
    <p class="small muted">
      What comes into each factory and what goes out per minute, with the best belt or pipe you have
      unlocked. Flows inside a factory are left out. Pick a vehicle on a factory's outgoing link and
      give its round trip to see how many it takes.
    </p>
    <p v-if="view.unlock" class="small" data-lane-unlock>{{ view.unlock }}</p>
    <p v-if="!view.links.length" class="small">Nothing moves between factories yet.</p>
    <div v-else class="group-cards">
      <article
        v-for="card in view.cards"
        :key="card.id"
        class="group-card"
        data-group-card
        :data-group="card.id"
      >
        <h3>{{ card.name }}</h3>
        <p v-if="'mining' in card && card.mining" class="small muted" data-mining-source>
          {{ card.mining }}
        </p>
        <div class="group-flow">
          <section
            v-for="part in card.parts"
            :key="part.dir"
            :class="['flow-part', part.dir]"
            :data-flow="part.dir"
          >
            <h4>
              {{ part.dir === 'in' ? 'In' : 'Out' }}
              <span class="flow-sum" data-flow-sum
                >{{ part.count }}<template v-if="part.total"> · {{ part.total }}</template></span
              >
            </h4>
            <p v-if="!part.rows.length" class="small muted">
              {{ part.dir === 'in' ? 'Nothing comes in.' : 'Nothing goes out.' }}
            </p>
            <div
              v-for="link in part.rows"
              :key="link.key"
              class="flow-row"
              v-bind="
                part.dir === 'in' ? { 'data-link-in': link.key } : { 'data-link-out': link.key }
              "
            >
              <div class="flow-end">
                <template v-if="part.dir === 'in'"
                  >← from <b>{{ link.fromName }}</b></template
                >
                <template v-else
                  >→ to <b>{{ link.toName }}</b></template
                >
              </div>
              <ul class="flow-items">
                <li
                  v-for="item in link.items"
                  :key="item.item"
                  :title="item.title"
                  :class="{ delivered: item.delivered }"
                >
                  <ItemIcon :name="item.item" /><span class="flow-item-name">{{ item.item }}: </span
                  >{{ item.text
                  }}<span v-if="item.delivered" data-delivered-link> · delivered</span>
                </li>
              </ul>
              <p v-if="part.dir === 'out' && link.overflow" class="small muted" data-link-storage>
                Surplus first: end each item's belt in its container through a Priority Merger or an
                overflow splitter, so a full container overflows to the AWESOME Sink.
              </p>
              <template v-if="part.dir === 'out' && link.extract">
                <p class="small" data-link-extract>
                  Build the Water Extractors at {{ link.toName }}: no pipe or vehicle between
                  places. Each production line's dialog says how many.
                </p>
                <p class="flow-badge" data-link-badge>{{ link.badge }}</p>
              </template>
              <template v-else-if="part.dir === 'out'">
                <div class="link-transport">
                  <label
                    >By
                    <select
                      :data-link-mode="link.key"
                      :value="link.mode"
                      @change="
                        setTransport($event.target as HTMLSelectElement, link, {
                          mode: ($event.target as HTMLSelectElement).value as LinkMode,
                        })
                      "
                    >
                      <option v-for="[mode, label] in LINK_MODES" :key="mode" :value="mode">
                        {{ label }}
                      </option>
                    </select></label
                  >
                  <label v-if="link.transport"
                    >Round trip
                    <input
                      type="number"
                      min="0.1"
                      max="1440"
                      step="0.1"
                      :data-link-trip="link.key"
                      :value="trips[link.key]"
                      @input="trips[link.key] = ($event.target as HTMLInputElement).value"
                      @change="setTrip($event, link)"
                      @blur="leaveDraft(trips, link.key, $event)"
                    />
                    min</label
                  >
                  <label v-if="link.fuelled"
                    >Fuel
                    <select
                      :data-link-fuel="link.key"
                      :value="link.transport!.fuel"
                      @change="
                        setTransport($event.target as HTMLSelectElement, link, {
                          fuel: ($event.target as HTMLSelectElement).value,
                        })
                      "
                    >
                      <option
                        v-for="vehicleFuel in fuels"
                        :key="vehicleFuel.name"
                        :value="vehicleFuel.name"
                      >
                        {{ vehicleFuel.name }}
                      </option>
                    </select></label
                  >
                </div>
                <template v-if="link.transport">
                  <p v-for="(line, i) in link.load" :key="i" class="small" data-link-load>
                    {{ line }}
                  </p>
                  <p v-if="link.packed.length" class="small muted">
                    Packaged for the trip:
                    {{ link.packed.map(item => `${item.item} as ${item.pack}`).join(', ') }}.
                  </p>
                </template>
                <template v-else>
                  <p v-if="link.mixed" class="small muted" data-link-mixed>{{ link.mixed }}</p>
                  <p class="flow-badge" data-link-badge>{{ link.badge }}</p>
                </template>
              </template>
              <p v-else :class="['flow-badge', { vehicle: link.transport }]" data-link-badge>
                {{ link.badge }}
              </p>
            </div>
          </section>
        </div>
      </article>
    </div>
    <p v-if="view.links.length && view.idle.length" class="small muted" data-idle-groups>
      Nothing moves in or out of {{ view.idle.join(', ') }} in this phase.
    </p>
    <div v-if="fuel" class="notice info" data-transport-fuel-note>
      <template v-if="fuel.same"
        >This plan already includes the vehicle fuel for these links: {{ fuel.text }}.</template
      >
      <template v-else
        ><template v-if="fuel.text"
          >The vehicles on these links burn up to {{ fuel.text }}. </template
        ><template v-else>No link burns fuel any more. </template
        ><template v-if="fuel.had">This plan was calculated with {{ fuel.had }}. </template>
        <button class="btn primary" data-recalc-transport @click="recalculate">
          {{ TRANSPORT_LABEL }}
        </button>
        {{ IN_PLACE_NOTE
        }}<template v-if="transcribed"
          ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
        ></template
      >
    </div>
  </section>
</template>
