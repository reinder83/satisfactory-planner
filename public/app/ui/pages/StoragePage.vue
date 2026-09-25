<!--
  #storage on both profile kinds: floor tabs and the search, the layout editor, the workshop
  (on its floor), the bay grid and the storage build checklist. The checklist is the
  handbook's storageTasks, or for a calculated profile one step with the saved key
  `calc-storage-layout`. When the remembered floor no longer exists (a removed floor), the
  page switches to the first one.
-->
<script setup lang="ts">
import { computed } from 'vue';
import {
  calculated,
  currentProfile,
  floor,
  layoutEditing,
  plan,
  query,
  setFloor,
  setLayoutEditing,
  setQuery,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { storageBays, storageFloors } from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import PageHeader from '../PageHeader.vue';
import LayoutEditor from '../storage/LayoutEditor.vue';
import StorageBay from '../storage/StorageBay.vue';
import StorageChecklist from '../storage/StorageChecklist.vue';
import WorkshopPanel from '../storage/WorkshopPanel.vue';

const CALCULATED_TASKS = [
  {
    id: 'calc-storage-layout',
    title: 'Build and label the selected storage positions',
    body: 'Use one container per selected item. Reserve its refill supply and route sinkable overflow to the AWESOME Sink; gathered items need manual replenishment.',
  },
];

const page = computed(() =>
  legacy(() => {
    const floors = storageFloors();
    // The three built-in floors always exist, so the fallback and the lookup both succeed.
    if (!floors.some(f => f.id === floor)) setFloor(floors[0]!.id);
    const current = floors.find(f => f.id === floor)!;
    // Bays on this floor; the search narrows them to bays with a match.
    const floorBays = storageBays().filter(b => b.floor === floor),
      display = floorBays.filter(
        b =>
          !query ||
          b.items.some(
            x => x.name && (x.id + ' ' + x.name).toLowerCase().includes(query.toLowerCase()),
          ),
      );
    // The wide grid reads like the hall itself: the rear row at the top, two bays to a row
    // with the aisle between them. A narrow screen gets a single column, where that
    // arrangement reads as a jumble, so the document keeps the bays in address order and
    // their hall positions are grid placement only. Keyboard focus then follows the stacked
    // order too.
    const placed = [...display]
      .sort(
        (a, b) =>
          Math.floor((b.id.charCodeAt(0) - 65) / 2) - Math.floor((a.id.charCodeAt(0) - 65) / 2) ||
          a.id.localeCompare(b.id),
      )
      .map(b => b.id);
    return {
      floors: floors.map(f => ({ ...f, active: f.id === floor })),
      current,
      floorBays: floorBays.length,
      workshop: floor === 'workshop',
      // The floor's notice. The ground-floor instructions describe the owner's built room,
      // so only the original profile gets them.
      notice:
        floor === 'ground'
          ? currentProfile.id !== 'original'
            ? 'template'
            : 'built'
          : floor === 'upper'
            ? 'upper'
            : '',
      query,
      editing: layoutEditing,
      bays: [...display]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(b => ({ bay: b, position: placed.indexOf(b.id) })),
      aisles: Math.floor(placed.length / 2),
      tasks: calculated ? CALCULATED_TASKS : plan.storageTasks,
      calculated: !!calculated,
    };
  }),
);

// A floor tab: switch floor and clear the search.
function showFloor(id: string) {
  setFloor(id);
  setQuery('');
  render();
}

function search(e: Event) {
  setQuery((e.target as HTMLInputElement).value);
  render();
}

// "Edit layout" / "Done editing": show or hide the layout editor (view state only).
function toggleLayout() {
  setLayoutEditing(!layoutEditing);
  render();
}
</script>

<template>
  <PageHeader
    eyebrow="ONE ITEM · ONE ADDRESS"
    title="Storage room"
    :subtitle="
      page.calculated
        ? 'Showing your selected storage supply across all phases. Unselected positions are reserved; addresses stay stable.'
        : 'Mark containers Done here, or complete a room after placing, labelling, connecting and checking its containers. Click an item for details. Positions match your printed storage plan.'
    "
  />
  <div class="toolbar">
    <div class="tabs">
      <button
        v-for="f in page.floors"
        :key="f.id"
        :class="['tab', f.active ? 'active' : '']"
        :data-floor="f.id"
        @click="showFloor(f.id)"
      >
        {{ f.label }}
      </button>
    </div>
    <input
      id="storage-search"
      class="search"
      aria-label="Find storage on this floor"
      placeholder="Find an item or address on this floor…"
      :value="page.query"
      @input="search"
    /><button
      :class="['btn', page.editing ? 'primary' : '']"
      data-toggle-layout
      @click="toggleLayout"
    >
      {{ page.editing ? 'Done editing' : 'Edit layout' }}
    </button>
  </div>
  <LayoutEditor v-if="page.editing" :floor="page.current" :bays="page.floorBays" /><WorkshopPanel
    v-if="page.workshop"
  />
  <div v-if="page.notice === 'template'" class="notice blue">
    Optional storage template. Each position has its own checklist; nothing is assumed built.
  </div>
  <div v-else-if="page.notice === 'built'" class="notice blue">
    <b>Ground floor is built.</b> The shell is marked complete. Move Gas Filters G08 → H02 and
    Nobelisks H02 → H08; assign Medicinal Inhalers to G08. H01 stays Iodine-Infused Filter.
  </div>
  <div v-else-if="page.notice === 'upper'" class="notice blue">
    Q sits behind O; R sits behind P. Packaged fluids only. Nuclear items and unpackaged fluids stay
    outside this room.
  </div>
  <p v-if="page.query" class="small muted">
    Filtered view: showing matching bays only. Clear search to see the full floor arrangement.
  </p>
  <p v-if="page.bays.length" class="eyebrow floor-marker">REAR OF HALL ↑</p>
  <div class="floor-grid">
    <template v-if="page.aisles || page.bays.length"
      ><div v-for="r in page.aisles" :key="'aisle' + r" class="aisle" :style="`--aisle-row:${r}`">
        MAIN AISLE
      </div>
      <StorageBay v-for="b in page.bays" :key="b.bay.id" :bay="b.bay" :position="b.position"
    /></template>
    <div v-else-if="!page.workshop" class="empty-state">
      {{
        page.floorBays
          ? 'No matching item on this floor. Try another floor.'
          : 'No bays on this floor yet. Use Edit layout to add one.'
      }}
    </div>
  </div>
  <template v-if="page.bays.length"
    ><div class="entry floor-marker">↓ ENTRANCE / STAIRS</div>
    <div class="small muted">
      Within each bay, 01–04 are the rear bank; 05–08 are the front bank. Read left to right on both
      banks. Grey positions remain unassigned. Positions from 09 are containers added beyond the
      printed bay.
    </div></template
  >
  <section style="margin-top: 28px">
    <h2>Storage build checklist</h2>
    <StorageChecklist :steps="page.tasks" />
  </section>
</template>
