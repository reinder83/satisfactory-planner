<!--
  "Between groups" on a calculated profile's factories page (#184): what each factory group hands
  the next per minute, and the belt or pipe it needs, from groupLinks (group-links.ts). Only
  shown when the profile has groups; flows inside a group are the group's own belts and are
  left out. Group names are user text, rendered as text.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { FLUIDS, lanePlan } from '../../flow.ts';
import { groupLinks, MINES, OUTSIDE, UNGROUPED } from '../../group-links.ts';
import { calcStage, calculated } from '../../session.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';

// Names for the places that are not factory groups.
const PLACES: Record<string, string> = {
  [UNGROUPED]: 'Ungrouped',
  [MINES]: 'Mines and existing supply',
  [OUTSIDE.storage]: 'Protected storage',
  [OUTSIDE.drone]: 'Drone fuel',
  [OUTSIDE.delivery]: 'Space Elevator',
  [OUTSIDE.surplus]: 'AWESOME Sink',
};

const view = computed(() =>
  legacy(() => {
    const x = calcStage(),
      g = factoryGroupsState();
    if (!calculated || !x?.rows?.length || !g.groups.length) return null;
    const name = (id: string) => g.groups.find(x => x.id === id)?.name ?? PLACES[id] ?? id;
    return groupLinks(x, g).map(l => ({
      key: l.from + '>' + l.to,
      from: name(l.from),
      to: name(l.to),
      items: l.items.map(({ item, rate }) => {
        const fluid = FLUIDS.has(item),
          p = lanePlan(rate, fluid);
        return {
          item,
          text: `${num(rate)}${fluid ? ' m³/min' : '/min'} · ${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`,
        };
      }),
    }));
  }),
);
</script>

<template>
  <section v-if="view" class="panel group-links" data-group-links>
    <h2>Between groups</h2>
    <p class="small muted">
      What each group hands the next per minute, with the best belt or pipe you have unlocked. Flows
      inside a group are left out.
    </p>
    <p v-if="!view.length" class="small">Nothing moves between groups yet.</p>
    <div v-for="l in view" :key="l.key" class="group-link" data-group-link>
      <h3>{{ l.from }} → {{ l.to }}</h3>
      <ul>
        <li v-for="i in l.items" :key="i.item">
          <b>{{ i.item }}</b> · {{ i.text }}
        </li>
      </ul>
    </div>
  </section>
</template>
