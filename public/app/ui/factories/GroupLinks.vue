<!--
  "Between groups" on a calculated profile's factories page (#184): what each factory group hands
  the next per minute, and the belt or pipe it needs, from groupLinks (group-links.ts). Only
  shown when the profile has groups; flows inside a group are the group's own belts and are
  left out. Group names are user text, rendered as text.
  One card per group (#213), Ungrouped too when it has links, with an In part (where each flow
  comes from) and an Out part (where it goes). Places that are not groups (mines, storage, fuel,
  the Space Elevator, the sink) only show as the other end of a row.
  Each link can instead go by truck, tractor, explorer, train or drone (#205): the user gives the
  round trip in minutes and, for a road vehicle, its fuel; linkLoad (logistics.ts) works out the
  vehicles and fuel. The controls sit on the sender's Out row only, so each link is edited in one
  place; the receiver's In row shows the belt or vehicle badge. The choice saves as a
  factoryLinkTransport update (factoryGroups.links).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { allowSwitch, post, save, toast, writeQueue } from '../../api.ts';
import { num } from '../../format.ts';
import { FLUIDS, lanePlan } from '../../flow.ts';
import { groupLinks, MINES, OUTSIDE, UNGROUPED } from '../../group-links.ts';
import { FLUID_CAR_M3, LINK_MODES, linkLoad, transportFuel, VEHICLES } from '../../logistics.ts';
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
import { calcProgress } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import type {
  ItemRates,
  LinkMode,
  LinkTransport,
  StageKey,
  UpdateOp,
  WorkspaceSummary,
} from '../../../types/index.ts';

// Names for the places that are not factory groups.
const PLACES: Record<string, string> = {
  [UNGROUPED]: 'Ungrouped',
  [MINES]: 'Mines and existing supply',
  [OUTSIDE.storage]: 'Protected storage',
  [OUTSIDE.drone]: 'Drone fuel',
  [OUTSIDE.transport]: 'Vehicle fuel',
  [OUTSIDE.delivery]: 'Space Elevator',
  [OUTSIDE.surplus]: 'AWESOME Sink',
};
// What a newly picked vehicle starts with until the user says otherwise.
const DEFAULT_TRIP_MIN = 5;
const DEFAULT_FUEL = 'Packaged Fuel';
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

// For a link that goes by vehicle: the lines under its Out row, and the short badge on its In row.
function vehicleText(
  items: { item: string; rate: number }[],
  t: LinkTransport,
): { lines: string[]; badge: string } {
  const c = workspace.catalog,
    l = linkLoad(items, t, c, FLUIDS),
    v = VEHICLES[t.mode],
    lines: string[] = [];
  let badge = l.vehicles ? plural(l.vehicles, v.name.toLowerCase()) : `By ${v.name.toLowerCase()}`;
  if (t.mode === 'train') {
    const cars = [
      l.freightCars ? plural(l.freightCars, 'freight car') : '',
      l.fluidCars ? `${plural(l.fluidCars, 'fluid car')} (${num(FLUID_CAR_M3)} m³ each)` : '',
    ].filter(Boolean);
    if (l.vehicles) {
      lines.push(
        `1 train: ${cars.join(' and ')}. Electric: the locomotive draws 25–110 MW from the grid while moving.`,
      );
      badge = `1 train: ${cars.join(' and ')}`;
    }
  } else if (l.vehicles) {
    const fuel =
      t.mode === 'drone'
        ? ' Drone fuel depends on the distance flown; see the profile’s drone-fuel supply.'
        : l.fuelPerMin
          ? ` Up to ${num(l.fuelPerMin)} ${t.fuel}/min if they never stop.`
          : '';
    lines.push(
      `${plural(l.vehicles, v.name.toLowerCase())}, ${l.slotsUsed} of ${v.slots} slots each trip.${fuel}`,
    );
  }
  for (const n of l.unpackable)
    lines.push(`${n} cannot be packaged: keep it on a pipe, or send it by train.`);
  return { lines, badge };
}

// "3 × Mk.4 belts · 1 × Mk.2 pipe": the belts and pipes a link needs, totalled per mark.
function beltBadge(items: { item: string; rate: number }[]): string {
  const marks = new Map<string, { count: number; mark: string; word: string }>();
  for (const { item, rate } of items) {
    const p = lanePlan(rate, FLUIDS.has(item)),
      key = p.lane.mark + p.word,
      m = marks.get(key) ?? { count: 0, mark: p.lane.mark, word: p.word };
    m.count += p.count;
    marks.set(key, m);
  }
  return [...marks.values()]
    .map(m => `${m.count} × ${m.mark} ${m.word}${m.count > 1 ? 's' : ''}`)
    .join(' · ');
}

// "215/min · 96 m³/min": items and fluids add up separately.
function total(items: { rate: number; fluid: boolean }[]): string {
  let solid = 0,
    fluid = 0;
  for (const i of items) i.fluid ? (fluid += i.rate) : (solid += i.rate);
  return [solid ? `${num(solid)}/min` : '', fluid ? `${num(fluid)} m³/min` : '']
    .filter(Boolean)
    .join(' · ');
}

const view = computed(() =>
  legacy(() => {
    const x = calcStage(),
      g = factoryGroupsState();
    if (!calculated || !x?.rows?.length || !g.groups.length) return null;
    const name = (id: string) => g.groups.find(x => x.id === id)?.name ?? PLACES[id] ?? id;
    const links = groupLinks(x, g).map(l => {
      const key = l.from + ':' + l.to,
        t = g.links?.[key];
      const mode: 'belt' | LinkMode = t?.mode ?? 'belt';
      const vehicle = t ? vehicleText(l.items, t) : null;
      const items = l.items.map(({ item, rate }) => {
        const fluid = FLUIDS.has(item),
          pack = fluid && t && t.mode !== 'train' ? workspace.catalog.packaged?.[item]?.item : '';
        return {
          item,
          rate,
          fluid,
          pack: pack || '',
          text: `${num(rate)}${fluid ? ' m³' : ''}`,
          title: `${item}: ${num(rate)}${fluid ? ' m³' : ''}/min${pack ? `, as ${pack}` : ''}`,
        };
      });
      return {
        key,
        from: l.from,
        to: l.to,
        fromName: name(l.from),
        toName: name(l.to),
        transport: t,
        mode,
        fuelled: !!t && fuelledModes.includes(t.mode),
        items,
        packed: items.filter(i => i.pack),
        load: vehicle?.lines ?? [],
        badge: vehicle?.badge ?? beltBadge(l.items),
      };
    });
    type Row = (typeof links)[number];
    const part = (dir: 'in' | 'out', rows: Row[]) => ({
      dir,
      rows,
      count: plural(rows.length, 'link'),
      total: total(rows.flatMap(r => r.items)),
    });
    const places = g.groups.map(x => x.id);
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
    const idle = places.filter(id => !used(id)).map(name);
    return { links, cards, idle };
  }),
);
const fuels = computed(() => legacy(() => workspace.catalog.vehicleFuels || []));

type Link = NonNullable<typeof view.value>['links'][number];
// Saves a link's transport with `change` applied; the page redraws with what was saved.
async function setTransport(
  el: HTMLInputElement | HTMLSelectElement,
  l: Link,
  change: { mode?: 'belt' | LinkMode; roundTripMin?: number; fuel?: string },
) {
  const mode = change.mode ?? l.mode;
  const op: UpdateOp =
    mode === 'belt'
      ? { type: 'factoryLinkTransport', from: l.from, to: l.to, mode }
      : {
          type: 'factoryLinkTransport',
          from: l.from,
          to: l.to,
          mode,
          roundTripMin: change.roundTripMin ?? l.transport?.roundTripMin ?? DEFAULT_TRIP_MIN,
          ...(fuelledModes.includes(mode)
            ? { fuel: change.fuel ?? l.transport?.fuel ?? DEFAULT_FUEL }
            : {}),
        };
  el.disabled = true;
  try {
    await save(op);
  } catch {
  } finally {
    el.disabled = false;
    render();
  }
}
function setTrip(e: Event, l: Link) {
  const el = e.target as HTMLInputElement,
    minutes = Number(el.value);
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 1440) {
    toast('Enter a round trip between 0.1 and 1,440 minutes.', true);
    el.value = String(l.transport?.roundTripMin ?? DEFAULT_TRIP_MIN);
    return;
  }
  setTransport(el, l, { roundTripMin: minutes });
}

// The fuel the links' vehicles burn per phase (#206), and whether this plan already plans for
// exactly that; the note under the links offers a recalculated revision when it does not.
type PhaseFuel = Partial<Record<StageKey, ItemRates>>;
const sameFuel = (a: PhaseFuel, b: PhaseFuel) => {
  const flat = (x: PhaseFuel) =>
    Object.entries(x)
      .flatMap(([p, f]) => Object.entries(f || {}).map(([n, q]) => `${p}|${n}|${q}`))
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
    const text = (x: PhaseFuel) =>
      Object.entries(x)
        .map(
          ([p, f]) =>
            `Phase ${p}: ` +
            Object.entries(f || {})
              .map(([n, q]) => `${num(q)} ${n}/min`)
              .join(', '),
        )
        .join('; ');
    return { want, same: sameFuel(want, have), text: text(want), had: text(have) };
  }),
);

// "Recalculate with transport fuel": after the unsaved-notes check, a new profile in this save
// with the fuel as extra demand (planner settings.transportFuel), carrying this profile's
// progress the way a new profile does (calc rows that grew are left for review). It opens; this
// profile stays as it is. The button shows the calculation's progress meanwhile.
async function recalculate(e: Event) {
  const b = e.currentTarget as HTMLButtonElement,
    want = fuel.value?.want;
  if (!calculated || !want || !allowSwitch()) return;
  b.disabled = true;
  try {
    await writeQueue;
    const r = await post<{
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
        settings: { ...calculated.settings, transportFuel: want },
        carryFrom: currentProfile.id,
      },
      true,
      calcProgress(b, 'Recalculating…'),
    );
    setWorkspace(r.workspace);
    await loadContext(r.saveId, r.profileId);
    render();
    toast(
      'Created a profile that plans the vehicle fuel. ' +
        (r.reviewCount
          ? r.reviewCount +
            ' completed factory checks need review; the previous profile is unchanged.'
          : 'The previous profile is unchanged.'),
    );
  } catch (err) {
    toast((err as Error).message, true);
    b.disabled = false;
    b.textContent = 'Recalculate with transport fuel';
  }
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
        v-for="c in view.cards"
        :key="c.id"
        class="group-card"
        data-group-card
        :data-group="c.id"
      >
        <h3>{{ c.name }}</h3>
        <div class="group-flow">
          <section
            v-for="p in c.parts"
            :key="p.dir"
            :class="['flow-part', p.dir]"
            :data-flow="p.dir"
          >
            <h4>
              {{ p.dir === 'in' ? 'In' : 'Out' }}
              <span class="flow-sum" data-flow-sum
                >{{ p.count }}<template v-if="p.total"> · {{ p.total }}</template></span
              >
            </h4>
            <p v-if="!p.rows.length" class="small muted">
              {{ p.dir === 'in' ? 'Nothing comes in.' : 'Nothing goes out.' }}
            </p>
            <div
              v-for="l in p.rows"
              :key="l.key"
              class="flow-row"
              v-bind="p.dir === 'in' ? { 'data-link-in': l.key } : { 'data-link-out': l.key }"
            >
              <div class="flow-end">
                <template v-if="p.dir === 'in'"
                  >← from <b>{{ l.fromName }}</b></template
                >
                <template v-else
                  >→ to <b>{{ l.toName }}</b></template
                >
              </div>
              <ul class="flow-items">
                <li v-for="i in l.items" :key="i.item" :title="i.title">
                  <ItemIcon :name="i.item" /><span class="flow-item-name">{{ i.item }}: </span
                  >{{ i.text }}
                </li>
              </ul>
              <template v-if="p.dir === 'out'">
                <div class="link-transport">
                  <label
                    >By
                    <select
                      :data-link-mode="l.key"
                      :value="l.mode"
                      @change="
                        setTransport($event.target as HTMLSelectElement, l, {
                          mode: ($event.target as HTMLSelectElement).value as LinkMode,
                        })
                      "
                    >
                      <option v-for="[m, label] in LINK_MODES" :key="m" :value="m">
                        {{ label }}
                      </option>
                    </select></label
                  >
                  <label v-if="l.transport"
                    >Round trip
                    <input
                      type="number"
                      min="0.1"
                      max="1440"
                      step="0.1"
                      :data-link-trip="l.key"
                      :value="l.transport.roundTripMin"
                      @change="setTrip($event, l)"
                    />
                    min</label
                  >
                  <label v-if="l.fuelled"
                    >Fuel
                    <select
                      :data-link-fuel="l.key"
                      :value="l.transport!.fuel"
                      @change="
                        setTransport($event.target as HTMLSelectElement, l, {
                          fuel: ($event.target as HTMLSelectElement).value,
                        })
                      "
                    >
                      <option v-for="f in fuels" :key="f.name" :value="f.name">{{ f.name }}</option>
                    </select></label
                  >
                </div>
                <template v-if="l.transport">
                  <p v-for="(line, n) in l.load" :key="n" class="small" data-link-load>
                    {{ line }}
                  </p>
                  <p v-if="l.packed.length" class="small muted">
                    Packaged for the trip:
                    {{ l.packed.map(i => `${i.item} as ${i.pack}`).join(', ') }}.
                  </p>
                </template>
                <p v-else class="flow-badge" data-link-badge>{{ l.badge }}</p>
              </template>
              <p v-else :class="['flow-badge', { vehicle: l.transport }]" data-link-badge>
                {{ l.badge }}
              </p>
            </div>
          </section>
        </div>
      </article>
    </div>
    <p v-if="view.links.length && view.idle.length" class="small muted" data-idle-groups>
      Nothing moves in or out of {{ view.idle.join(', ') }} in this phase.
    </p>
    <div v-if="fuel" class="notice blue" data-transport-fuel-note>
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
        creates a new profile that plans for it and opens it; this profile stays as it is.</template
      >
    </div>
  </section>
</template>
