<!--
  "Alternates you already own" on All settings step 2 (#1068), under every Recipe access choice:
  one box per hard-drive alternate the game has (MAM and milestone recipes come with their research
  steps, so they are not listed). Ticked boxes (name="ownedAlt") become settings.ownedAlternates,
  read back by readWizard with the rest of the step (readOwnedAlternates in wizard/wizard.ts), and
  the planner adds each to its recipe pool from the phase it becomes available in (recipePool in
  planner/recipes.ts), so a Standard plan can use it. Review's "What you already have" then shows
  them ticked, and the new profile starts with their unlock steps ticked (alreadyHaveKeys).

  Folded, and open when the draft already owns some. The list shows the recipes available by the
  draft's start phase, the ticked ones and, with "Show later phases", the rest; the filter narrows
  it by recipe or product. A hidden row's box stays in the form, so filtering never drops a tick.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { draft, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';

// A stable empty list, so a draft without owned alternates does not look replaced on every redraw.
const NONE: string[] = [];

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return {
      owned: settings.ownedAlternates || NONE,
      start: Number(settings.phase || 1),
      rows: (workspace.catalog.alternates || [])
        .filter(alternate => !alternate.mam && !alternate.milestone)
        .map(alternate => {
          const outs = Object.keys(alternate.outputs);
          return {
            id: alternate.id,
            name: alternate.name,
            outs,
            phase: alternate.phase,
            text: (alternate.name + ' ' + outs.join(' ')).toLowerCase(),
          };
        })
        .sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name)),
    };
  }),
);

type OwnedRow = (typeof view)['value']['rows'][number];

// The ticks on screen, from the draft whenever its list is replaced (a read of the step).
const picked = ref(new Set<string>());
watch(
  () => view.value.owned,
  list => (picked.value = new Set(list)),
  { immediate: true },
);
// Open on arrival when the draft owns some; afterwards the user's own toggle decides.
const startOpen = view.value.owned.length > 0;

const filter = ref('');
const later = ref(false);
const shown = (row: OwnedRow) =>
  (later.value || row.phase <= view.value.start || picked.value.has(row.id)) &&
  (filter.value.trim() === '' || row.text.includes(filter.value.trim().toLowerCase()));

function tick(row: OwnedRow, on: boolean) {
  const picks = new Set(picked.value);
  on ? picks.add(row.id) : picks.delete(row.id);
  picked.value = picks;
}
</script>

<template>
  <details class="alt-picker owned-alt-picker" data-owned-alt-picker :open="startOpen">
    <summary>Alternates you already own · {{ picked.size }} ticked</summary>
    <p class="small muted">
      Tick the alternate recipes you have already unlocked in game. The plan may use them whatever
      Recipe access says, from the phase each becomes available, and their unlock steps start
      ticked, so no hard drives go to them. MAM and milestone recipes are not listed: their research
      steps cover them.
    </p>
    <div class="owned-alt-tools">
      <input
        v-model="filter"
        type="search"
        placeholder="Filter by recipe or product…"
        aria-label="Filter the alternates you own"
      /><label v-if="view.start < 5" class="check-row"
        ><input v-model="later" type="checkbox" data-owned-alt-later /><span
          >Show recipes from after Phase {{ view.start }}</span
        ></label
      >
    </div>
    <div class="alt-list owned-alt-list" role="group" aria-label="Alternates you already own">
      <div v-for="row in view.rows" :key="row.id" class="alt-row" :hidden="!shown(row)">
        <label class="check-row"
          ><input
            type="checkbox"
            name="ownedAlt"
            data-owned-alt
            :value="row.id"
            :checked="picked.has(row.id)"
            @change="tick(row, ($event.target as HTMLInputElement).checked)"
          /><span
            >{{ row.name
            }}<small class="muted">
              · {{ row.outs.join(', ') }} · Phase {{ row.phase }}</small
            ></span
          ></label
        >
      </div>
    </div>
  </details>
</template>
