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
import { DragDropProvider } from '@dnd-kit/vue';
import type { DragDropManager, DragEndEvent } from '@dnd-kit/vue';
import {
  floorOrder,
  hiddenStorageBays,
  hiddenStorageFloors,
  storageBays,
  storageFloors,
} from '../../views/storage.ts';
import { save, toast } from '../../api.ts';
import { moveContainer } from '../actions.ts';
import { legacy } from '../bridge.ts';
import { refocusAfterRemoval } from '../refocus.ts';
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

// Hall order for bays listed from the entrance: rows of two from the back of the hall (the top
// of the grid) to the front, each row left then right. An odd bay out sits alone on the left
// of the back row; the empty place beside it is an empty string.
function inHallOrder(ids: string[]): string[] {
  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += 2) rows.push([ids[i]!, ids[i + 1] ?? '']);
  return rows.reverse().flat();
}

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
    // A floor with its own bay order (#191) pairs the bays in that order instead: the first two
    // share the row by the entrance, left then right, the next two the row behind, and so on.
    const order = floorOrder(
        floor,
        floorBays.map(b => b.id).sort((a, b) => a.localeCompare(b)),
      ),
      shown = new Set(display.map(b => b.id));
    const placed = order
      ? inHallOrder(order.filter(id => shown.has(id)))
      : [...display]
          .sort(
            (a, b) =>
              Math.floor((b.id.charCodeAt(0) - 65) / 2) -
                Math.floor((a.id.charCodeAt(0) - 65) / 2) || a.id.localeCompare(b.id),
          )
          .map(b => b.id);
    const byId = new Map(display.map(b => [b.id, b]));
    return {
      floors: floors.map(f => ({ ...f, active: f.id === floor })),
      current,
      floorBays: floorBays.length,
      // Hidden handbook bays moved onto this floor: not shown, but the floor cannot be hidden
      // or removed while they are here (#216).
      hiddenHere: hiddenStorageBays()
        .filter(b => b.moved && b.floor === floor)
        .map(b => b.id),
      workshop: floor === 'workshop',
      // The floor's notice. The ground-floor instructions describe the owner's built room,
      // so only original (handbook) profiles get them, copies included: a duplicated or
      // imported one has a new id but keeps its kind and the built ground floor.
      notice:
        floor === 'ground'
          ? currentProfile.kind !== 'original'
            ? 'template'
            : 'built'
          : floor === 'upper'
            ? 'upper'
            : '',
      // Handbook ground-floor bays moved to another floor (#190), which the built room still has.
      movedOff: storageBays()
        .filter(
          b =>
            !b.custom &&
            b.floor !== 'ground' &&
            plan.storage.find(x => x.id === b.id)?.floor === 'ground',
        )
        .map(b => `${b.id} to ${floors.find(f => f.id === b.floor)?.label ?? b.floor}`),
      query,
      editing: layoutEditing,
      // Hidden handbook bays (#166) and the planned items left without a container.
      hidden: hiddenStorageBays(),
      hiddenFloors: hiddenStorageFloors(),
      unplaced: hiddenStorageBays().flatMap(b => b.items),
      // In the floor's order, which the narrow single column and keyboard focus follow.
      bays: (order
        ? order.filter(id => shown.has(id)).map(id => byId.get(id)!)
        : [...display].sort((a, b) => a.id.localeCompare(b.id))
      ).map(b => ({ bay: b, position: placed.indexOf(b.id) })),
      // Every bay on the floor in its current order, search or not, for Move left / right.
      order: order ?? floorBays.map(b => b.id).sort((a, b) => a.localeCompare(b)),
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

// Where focus goes once a Restore leaves "Hidden bays and floors" (ui/refocus.ts, #290): the next
// row's Restore, else the previous one's, and once the list is empty `after`, what came back.
const hiddenList = (after: string[]) => ({
  row: '#main [data-hidden-bays] .check-row',
  control: '[data-restore-bay], [data-restore-floor]',
  fallback: after,
});

// "Restore": bring a hidden handbook bay back, with everything saved for it. Once nothing is
// left to restore, focus goes to the bay's Hide on this floor, else to its floor's tab.
async function restoreBay(e: Event, id: string) {
  const button = e.currentTarget as HTMLButtonElement,
    on = hiddenStorageBays().find(b => b.id === id)?.floor ?? '';
  const refocus = refocusAfterRemoval(
    button,
    hiddenList([
      `#main [data-hide-bay="${CSS.escape(id)}"]`,
      `#main .tabs [data-floor="${CSS.escape(on)}"]`,
    ]),
  );
  let saved = false;
  button.disabled = true;
  try {
    await save({ type: 'storageBayRestore', id });
    saved = true;
    toast(`Bay ${id} is back, with its containers, checkmarks and notes.`);
  } catch {
  } finally {
    button.disabled = false;
    render();
  }
  if (saved) await refocus();
}

// "Restore" on a hidden built-in floor (#168): its tab comes back, and takes focus once nothing
// is left to restore.
async function restoreFloor(e: Event, id: string) {
  const button = e.currentTarget as HTMLButtonElement;
  const refocus = refocusAfterRemoval(
    button,
    hiddenList([`#main .tabs [data-floor="${CSS.escape(id)}"]`]),
  );
  let saved = false;
  button.disabled = true;
  try {
    await save({ type: 'storageFloorRestore', id });
    saved = true;
    toast('The floor is back.');
  } catch {
  } finally {
    button.disabled = false;
    render();
  }
  if (saved) await refocus();
}

// A container dropped on another position (#208, ui/storage/SlotCell.vue): one save that moves or
// swaps it, its checks and note going along. A cancelled drag, or a drop back on its own place,
// saves nothing.
//
// The save waits until dnd-kit has finished the drop. At dragend the dragged card is still in the
// top layer with a placeholder beside its place, and dnd-kit puts both back only after its drop
// animation. A quick save (the browser edition, a nearby server) redrew the bay before that, so Vue
// patched around nodes dnd-kit had moved, threw, and left the bay half drawn: the moved container
// missing and a blank position that took no drops, until a reload showed what had been saved
// (#292). A drop that never settles is saved after two seconds anyway.
async function dropped(event: DragEndEvent, manager: DragDropManager) {
  const { source, target } = event.operation;
  if (event.canceled || !source || !target) return;
  for (let waited = 0; !manager.dragOperation.status.idle && waited < 2000; waited += 20)
    await new Promise(resolve => setTimeout(resolve, 20));
  return moveContainer(String(source.id), String(target.id));
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
  <div v-if="page.unplaced.length" class="notice" data-unplaced>
    <b
      >{{ page.unplaced.length }} planned item{{ page.unplaced.length === 1 ? ' has' : 's have' }}
      no container while
      {{ page.hidden.length === 1 ? 'a bay is' : 'bays are' }} hidden:</b
    >
    {{ page.unplaced.join(', ') }}. Restore the bay under Edit layout, or add them to another bay.
  </div>
  <section
    v-if="page.editing && (page.hidden.length || page.hiddenFloors.length)"
    class="panel hidden-bays"
    data-hidden-bays
  >
    <h2>Hidden bays and floors</h2>
    <p v-if="page.hidden.length" class="small muted">
      Their containers, checkmarks and notes are kept until you restore them.
    </p>
    <div v-for="b in page.hidden" :key="b.id" class="check-row">
      <span
        ><b>{{ b.id }}</b> · {{ b.name }}</span
      ><span v-if="b.taken" class="small muted">An added bay uses this letter.</span
      ><button v-else class="btn" :data-restore-bay="b.id" @click="restoreBay($event, b.id)">
        Restore
      </button>
    </div>
    <div v-for="f in page.hiddenFloors" :key="f.id" class="check-row">
      <span
        ><b>{{ f.label }}</b> · floor</span
      ><button class="btn" :data-restore-floor="f.id" @click="restoreFloor($event, f.id)">
        Restore
      </button>
    </div>
  </section>
  <LayoutEditor
    v-if="page.editing"
    :floor="page.current"
    :bays="page.floorBays"
    :hidden-here="page.hiddenHere"
  /><WorkshopPanel v-if="page.workshop" />
  <div v-if="page.notice === 'template'" class="notice blue">
    Optional storage template. Each position has its own checklist; nothing is assumed built.
  </div>
  <div v-else-if="page.notice === 'built'" class="notice blue">
    <b>Ground floor is built.</b> The shell is marked complete. Move Gas Filters G08 → H02 and
    Nobelisks H02 → H08; assign Medicinal Inhalers to G08. H01 stays Iodine-Infused Filter.
    <template v-if="page.movedOff.length"
      ><br /><span data-moved-off
        >Moved in this plan: bay {{ page.movedOff.join(', ') }}. The built room still has
        {{ page.movedOff.length === 1 ? 'it' : 'them' }} here.</span
      ></template
    >
  </div>
  <div v-else-if="page.notice === 'upper'" class="notice blue">
    Q sits behind O; R sits behind P. Packaged fluids only. Nuclear items and unpackaged fluids stay
    outside this room.
  </div>
  <p v-if="page.query" class="small muted">
    Filtered view: showing matching bays only. Clear search to see the full floor arrangement.
  </p>
  <p v-if="page.bays.length" class="eyebrow floor-marker">REAR OF HALL ↑</p>
  <DragDropProvider @drag-end="dropped"
    ><div class="floor-grid">
      <template v-if="page.aisles || page.bays.length"
        ><div v-for="r in page.aisles" :key="'aisle' + r" class="aisle" :style="`--aisle-row:${r}`">
          MAIN AISLE
        </div>
        <StorageBay
          v-for="b in page.bays"
          :key="b.bay.id"
          :bay="b.bay"
          :position="b.position"
          :order="page.order"
      /></template>
      <div v-else-if="!page.workshop" class="empty-state">
        {{
          page.floorBays
            ? 'No matching item on this floor. Try another floor.'
            : 'No bays on this floor yet. Use Edit layout to add one.'
        }}
      </div>
    </div></DragDropProvider
  >
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
