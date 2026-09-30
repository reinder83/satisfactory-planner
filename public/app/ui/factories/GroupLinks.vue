<!--
  "Between groups" on the Logistics page (#184; on the calculated factories page until #229):
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
-->
<script setup lang="ts">
import { computed } from 'vue';
import { allowSwitch, post, save, toast, writeQueue } from '../../api.ts';
import { num, plural } from '../../format.ts';
import { bestLane, FLUIDS, lanePlan, rateOfItem } from '../../flow.ts';
import {
  groupLinks,
  isSource,
  linkTransportFor,
  placeName,
  sourceItem,
  UNGROUPED,
} from '../../group-links.ts';
import {
  DEFAULT_TRIP_MIN,
  LINK_MODES,
  linkBeltBadge,
  linkSiblings,
  linkTotal,
  linkTransportUpdate,
  linkVehicleText,
  transportFuel,
} from '../../logistics.ts';
import {
  calcStage,
  calculated,
  currentProfile,
  currentSave,
  loadContext,
  setWorkspace,
  workspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { fuelledModes } from '../../../state.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { calcProgress } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import { resetDraft, useDrafts } from '../draft.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { refocusOnOpenedPage } from '../refocus.ts';
import ItemIcon from '../ItemIcon.vue';
import type { ItemRates, LinkMode, StageKey, WorkspaceSummary } from '../../../types/index.ts';

const view = computed(() =>
  legacy(() => {
    const stage = calcStage(),
      groupsState = factoryGroupsState();
    if (!calculated || !stage?.rows?.length || !groupsState.groups.length) return null;
    const name = (id: string) => placeName(id, groupsState.groups, stage.raw);
    const links = groupLinks(stage, groupsState).map(link => {
      const key = link.from + ':' + link.to,
        transport = linkTransportFor(groupsState.links, link.from, link.to);
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
              : '';
        return {
          item,
          rate,
          fluid,
          pack: pack || '',
          // With its unit, as the part header above has it: 213,27/min, 139,36 m³/min (#462).
          text: `${num(rate)}${fluid ? ' m³' : ''}/min`,
          title: `${item}: ${num(rate)}${fluid ? ' m³' : ''}/min${pack ? `, as ${pack}` : ''}`,
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
        badge: vehicle?.badge ?? linkBeltBadge(link.items, FLUIDS, lanePlan),
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
    const sources = [...new Set(mined.map(l => l.from))]
      .map(id => ({ id, rows: mined.filter(l => l.from === id) }))
      .sort((a, b) => minedFirst(a.id) - minedFirst(b.id) || flow(b.rows) - flow(a.rows))
      .map(({ id, rows }) => ({ id, name: name(id), parts: [part('out', rows)] }));
    cards.unshift(...sources);
    const idle = places.filter(id => !used(id)).map(name);
    return { links, cards, idle };
  }),
);
const fuels = computed(() => legacy(() => workspace.catalog.vehicleFuels || []));
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
    linkSiblings(calculated?.stages, factoryGroupsState(), link),
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

// "Recalculate with transport fuel": after the unsaved-notes check, a new profile in this save
// with the fuel as extra demand (planner settings.transportFuel), carrying this profile's
// progress the way a new profile does (calc rows that grew are left for review). It opens; this
// profile stays as it is. The button shows the calculation's progress meanwhile, busy
// (app/busy.ts) so it keeps focus (#299). The new profile's page has no such button, so focus
// then goes to the page's heading (refocusOnOpenedPage in ui/refocus.ts, #300, #304).
async function recalculate(event: Event) {
  const button = event.currentTarget as HTMLButtonElement,
    want = fuel.value?.want;
  if (isBusy(button) || !calculated || !want || !(await allowSwitch())) return;
  const settings = { ...calculated.settings, transportFuel: want },
    refocus = refocusOnOpenedPage(button);
  await whileBusy(button, async () => {
    try {
      await writeQueue;
      const result = await post<{
        workspace: WorkspaceSummary;
        saveId: string;
        profileId: string;
        reviewCount: number;
      }>(
        '/api/profiles',
        {
          saveId: currentSave.id,
          name: (currentProfile.name.replace(/ · transport fuel$/, '') + ' · transport fuel').slice(
            0,
            80,
          ),
          settings,
          carryFrom: currentProfile.id,
        },
        true,
        calcProgress(button, 'Recalculating…'),
      );
      setWorkspace(result.workspace);
      await loadContext(result.saveId, result.profileId);
      render();
      toast(
        'Created a profile that plans the vehicle fuel. ' +
          (result.reviewCount
            ? result.reviewCount +
              ' completed factory checks need review; the previous profile is unchanged.'
            : 'The previous profile is unchanged.'),
      );
      void refocus();
    } catch (error) {
      toast((error as Error).message, true);
      button.textContent = 'Recalculate with transport fuel';
    }
  });
}
</script>

<template>
  <section v-if="view" class="panel group-links" data-group-links>
    <h2>Between groups</h2>
    <p class="small muted">
      What comes into each group and what goes out per minute, with the best belt or pipe you have
      unlocked. Flows inside a group are left out. Pick a vehicle on a group's outgoing link and
      give its round trip to see how many it takes.
    </p>
    <p v-if="!view.links.length" class="small">Nothing moves between groups yet.</p>
    <div v-else class="group-cards">
      <article
        v-for="card in view.cards"
        :key="card.id"
        class="group-card"
        data-group-card
        :data-group="card.id"
      >
        <h3>{{ card.name }}</h3>
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
                <li v-for="item in link.items" :key="item.item" :title="item.title">
                  <ItemIcon :name="item.item" /><span class="flow-item-name">{{ item.item }}: </span
                  >{{ item.text }}
                </li>
              </ul>
              <template v-if="part.dir === 'out'">
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
                <p v-else class="flow-badge" data-link-badge>{{ link.badge }}</p>
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
          Recalculate with transport fuel
        </button>
        creates a new profile that plans for it and opens it; this profile stays as it is.<template
          v-if="transcribed"
          ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
        ></template
      >
    </div>
  </section>
</template>
