<!--
  #storage on both profile kinds: floor tabs and the search, the layout editor, the workshop
  (on its floor), the bay grid and the storage build checklist. The search looks on every floor
  (#240): its results above the grid lead to each container, and it narrows the floor shown to
  the bays with a match. The checklist is the handbook's storageTasks, or for a calculated
  profile one step with the saved key `calc-storage-layout`. When the remembered floor no longer
  exists (a removed floor), the page switches to the first one.
-->
<script setup lang="ts">
import { computed, nextTick } from 'vue';
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
import type { DragDropManager, DragEndEvent, DragStartEvent } from '@dnd-kit/vue';
import { followScroll, landsOnTarget } from '../storage/drop-point.ts';
import {
  floorOrder,
  floorProgress,
  GROUND_MOVES,
  groundMovesPending,
  hiddenStorageBays,
  hiddenStorageFloors,
  slotMatches,
  storageBays,
  storageFloors,
  storageMatches,
} from '../../views/storage.ts';
import type { StorageMatch } from '../../views/storage.ts';
import { save, toast } from '../../api.ts';
import { moveContainer } from '../actions.ts';
import { legacy } from '../bridge.ts';
import { whileBusy } from '../../busy.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import ItemIcon from '../ItemIcon.vue';
import EditBar from '../EditBar.vue';
import PageHeader from '../PageHeader.vue';
import LayoutEditor from '../storage/LayoutEditor.vue';
import StorageBay from '../storage/StorageBay.vue';
import StorageChecklist from '../storage/StorageChecklist.vue';
import WorkshopPanel from '../storage/WorkshopPanel.vue';

// The most search results listed at once (#240); a short query can match most of the room.
const RESULT_LIMIT = 24;

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
      display = floorBays.filter(b => !query || b.items.some(x => slotMatches(x, query)));
    // The containers that answer the search on every floor (#240).
    const matches = storageMatches(query),
      floorsHit = new Set(matches.map(m => m.floor)).size;
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
    // Each tab's named containers and how many are Done (SP-23, #258): the same count as its
    // bays' lines, over the bays the room shows. The search does not narrow it.
    const progress = floorProgress();
    return {
      floors: floors.map(f => ({
        ...f,
        active: f.id === floor,
        done: progress.get(f.id)?.done ?? 0,
        named: progress.get(f.id)?.named ?? 0,
      })),
      current,
      floorBays: floorBays.length,
      // Hidden handbook bays moved onto this floor: not shown, but the floor cannot be hidden
      // or removed while they are here (#216).
      hiddenHere: hiddenStorageBays()
        .filter(b => b.moved && b.floor === floor)
        .map(b => b.id),
      workshop: floor === 'workshop',
      // The built room's moves, until their Done (SP-25, #260).
      groundMoves: groundMovesPending(),
      // The floor's notice. The ground-floor instructions describe the owner's built room,
      // so only original (handbook) profiles get them, copies included: a duplicated or
      // imported one has a new id but keeps its kind and the built ground floor.
      notice: floor === 'ground' ? (currentProfile.kind !== 'original' ? 'template' : 'built') : '',
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
      results: matches.slice(0, RESULT_LIMIT),
      matches: matches.length,
      elsewhere: matches.filter(m => m.floor !== floor).length,
      // Read out politely as the results change (the status line is always on the page, so a
      // screen reader hears the first count too).
      status: !query
        ? ''
        : !matches.length
          ? 'No container holds ' + query
          : `${matches.length} container${matches.length === 1 ? ' matches' : 's match'} ${query}${
              floorsHit > 1 ? `, on ${floorsHit} floors` : ''
            }`,
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

// A floor tab: switch floor. The search stays (#240), and narrows the new floor.
function showFloor(id: string) {
  setFloor(id);
  render();
}

// A search result (#240): switch to its floor, where it is marked as a match, and focus the
// container's button (the target its dialog and Complete room use too). Focus moves without the
// browser's own scroll, then the whole container card (its address, item and Done box) is
// scrolled just into view, not only the button, which ends above the Done box (#327).
async function showMatch(m: StorageMatch) {
  if (m.floor !== floor) {
    setFloor(m.floor);
    render();
    await nextTick();
  }
  const target = document.querySelector<HTMLElement>(`#main [data-slot="${CSS.escape(m.id)}"]`);
  if (!target) return;
  target.focus({ preventScroll: true });
  (target.closest<HTMLElement>('.slot') ?? target).scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });
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
  // Busy while it saves (app/busy.ts), so a failed restore leaves focus on it (#299).
  await whileBusy(button, async () => {
    try {
      await save({ type: 'storageBayRestore', id });
      saved = true;
      toast(`Bay ${id} is back, with its containers, checkmarks and notes.`);
    } catch {
    } finally {
      render();
    }
  });
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
  await whileBusy(button, async () => {
    try {
      await save({ type: 'storageFloorRestore', id });
      saved = true;
      toast('The floor is back.');
    } catch {
    } finally {
      render();
    }
  });
  if (saved) await refocus();
}

// "Done" on the built room's moves (SP-25, #260): ticks their storage step, which this profile
// alone keeps, and the notice goes. Its button goes with it, so focus moves to the ground floor's
// tab just above (ui/refocus.ts). Unticking the step in the build checklist brings it back.
async function groundMovesDone(e: Event) {
  const button = e.currentTarget as HTMLButtonElement;
  const refocus = refocusAfterRemoval(button, {
    fallback: ['#main .tabs [data-floor="ground"]'],
  });
  const step = plan.storageTasks.find(t => t.id === GROUND_MOVES);
  let saved = false;
  // Busy while it saves (app/busy.ts), so a failed save leaves focus on it (#299).
  await whileBusy(button, async () => {
    try {
      await save({ type: 'check', key: GROUND_MOVES, value: true });
      saved = true;
      toast(
        step
          ? `Ground-floor moves done. Untick “${step.title}” in the storage build checklist to see them again.`
          : 'Ground-floor moves done.',
      );
    } catch {
    } finally {
      render();
    }
  });
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
//
// A drop counts only where it was let go: over the position dnd-kit chose, as it is drawn at the
// release, and inside the window (ui/storage/drop-point.ts). Released in the aisle, beside a bay
// or outside the window, the card goes back and nothing is saved; after an auto-scroll dnd-kit
// could still name a position that had scrolled away from under the pointer (#298).
async function dropped(event: DragEndEvent, manager: DragDropManager) {
  const { source, target } = event.operation;
  if (event.canceled || !source || !target || !landsOnTarget(event.operation)) return;
  for (let waited = 0; !manager.dragOperation.status.idle && waited < 2000; waited += 20)
    await new Promise(resolve => setTimeout(resolve, 20));
  return moveContainer(String(source.id), String(target.id));
}
// While a drag lasts, the target follows the page as it scrolls under the pointer
// (ui/storage/drop-point.ts, #303).
function dragStarted(_event: DragStartEvent, manager: DragDropManager) {
  followScroll(manager);
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
  <EditBar
    v-if="page.editing"
    label="Editing the layout"
    toggle="[data-toggle-layout]"
    :done="toggleLayout"
  />
  <div class="toolbar">
    <!-- A tab's count is part of its name as words ("Ground floor, 41 of 64 done", which starts
         with the label drawn); the figures drawn beside the label are hidden from a screen reader
         (SP-23, #258). A floor without a container shows none. The floor on screen is the pressed
         one, so a screen reader hears which it is (#348); they stay buttons, not a tablist, so the
         Tab order is unchanged. -->
    <div class="tabs">
      <button
        v-for="f in page.floors"
        :key="f.id"
        :class="['tab', f.active ? 'active' : '']"
        :data-floor="f.id"
        :aria-pressed="f.active ? 'true' : 'false'"
        :aria-label="f.named ? `${f.label}, ${f.done} of ${f.named} done` : undefined"
        @click="showFloor(f.id)"
      >
        {{ f.label }}
        <span v-if="f.named" class="count" aria-hidden="true">{{ f.done }}/{{ f.named }}</span>
      </button>
    </div>
    <input
      id="storage-search"
      class="search"
      aria-label="Find storage on every floor"
      placeholder="Find an item or address on any floor…"
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
  <p class="visually-hidden" role="status" data-search-status>{{ page.status }}</p>
  <section
    v-if="page.query"
    class="storage-results"
    aria-label="Containers found"
    data-search-results
  >
    <ul v-if="page.matches" class="storage-results-list">
      <li v-for="m in page.results" :key="m.id">
        <button type="button" class="storage-result" :data-find-slot="m.id" @click="showMatch(m)">
          <ItemIcon :name="m.name" /><span
            ><b>{{ m.name }}</b> · {{ m.floorLabel }} · {{ m.id }}</span
          >
        </button>
      </li>
    </ul>
    <div v-else class="empty-state" data-search-empty>No container holds {{ page.query }}</div>
    <p v-if="page.matches > page.results.length" class="small muted">
      Showing the first {{ page.results.length }} of {{ page.matches }}. Type more of the name or
      address to narrow the search.
    </p>
  </section>
  <div v-if="page.unplaced.length" class="notice warn" data-unplaced>
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
  <div v-if="page.notice === 'template'" class="notice info">
    Optional storage template. Each position has its own checklist; nothing is assumed built.
  </div>
  <!-- The built room's moves are a to-do (SP-25, #260): Done ticks their storage step and the
       notice goes; the bays moved in this plan are still named on their own when there are any. -->
  <div
    v-else-if="page.notice === 'built' && (page.groundMoves || page.movedOff.length)"
    class="notice info"
    data-ground-floor
  >
    <template v-if="page.groundMoves"
      ><span data-ground-moves
        ><b>Ground floor is built.</b> The shell is marked complete. Still to do: move Gas Filters
        G08 → H02 and Nobelisks H02 → H08; assign Medicinal Inhalers to G08. H01 stays
        Iodine-Infused Filter.</span
      ><br /><button type="button" class="btn" data-ground-moves-done @click="groundMovesDone">
        Done<span class="visually-hidden"> with the ground-floor moves</span>
      </button></template
    ><template v-if="page.movedOff.length"
      ><br v-if="page.groundMoves" /><span data-moved-off
        >Moved in this plan: bay {{ page.movedOff.join(', ') }}. The built room still has
        {{ page.movedOff.length === 1 ? 'it' : 'them' }} here.</span
      ></template
    >
  </div>
  <p v-if="page.query && page.matches" class="small muted">
    Filtered view: showing this floor's bays with a match only. Clear search to see the full floor
    arrangement.
  </p>
  <!-- The key to the grid, above it (SP-24, #259). Each swatch is drawn with the colours of the
       state it stands for and is hidden from a screen reader, which reads the words beside it. A
       phone's single column of bays keeps only the added positions' entry (style.css). -->
  <ul v-if="page.bays.length" class="storage-key" aria-label="Storage key" data-storage-key>
    <li class="key-banks">01–04 rear bank, 05–08 front bank, each read left to right</li>
    <li class="key-done"><span class="key-swatch done" aria-hidden="true"></span>Done</li>
    <li class="key-reserved">
      <span class="key-swatch empty" aria-hidden="true"></span>Reserved (unassigned)
    </li>
    <li class="key-added">
      <span class="key-swatch added" aria-hidden="true"></span>09+ added past the printed bay
    </li>
  </ul>
  <p v-if="page.bays.length" class="eyebrow floor-marker">REAR OF HALL ↑</p>
  <DragDropProvider @drag-start="dragStarted" @drag-end="dropped"
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
      <div v-else-if="!page.floorBays && !page.workshop" class="empty-state">
        No bays on this floor yet. Use Edit layout to add one.
      </div>
      <div v-else-if="page.elsewhere" class="empty-state">
        Nothing on this floor matches. The results above are on other floors.
      </div>
    </div></DragDropProvider
  >
  <div v-if="page.bays.length" class="entry floor-marker">↓ ENTRANCE / STAIRS</div>
  <section style="margin-top: 28px">
    <h2>Storage build checklist</h2>
    <StorageChecklist :steps="page.tasks" />
  </section>
</template>
