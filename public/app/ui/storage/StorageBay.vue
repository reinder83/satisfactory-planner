<!--
  One bay of the storage room. `position` is its index in hall order and sets the CSS grid
  row and column (two bays per row, aisle between). A container opens its dialog, and its
  Done box writes all four of its saved `slot-<address>-<step>` checks in one save; "Complete
  room" does that for every named container of the bay. While editing the layout, the bay
  can be renamed, a container cleared (its checkmarks stay with the address), an item added
  (a free position first, then the next address), a container dragged to another position
  (SlotCell.vue, #208) and an added bay removed. Move left / Move right set the order of the bays
  on the floor (#191): `order` is every bay on it, in its current order.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { bayCapacity } from '../../../state.ts';
import { save, toast } from '../../api.ts';
import { knownItem, slug } from '../../format.ts';
import { layoutEditing, query, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  bayProgress,
  openSlot,
  slotDone,
  slotKeys,
  slotMatches,
  storageBays,
  storageFloors,
} from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { confirmAction } from '../confirm.ts';
import ItemSearch from '../form/ItemSearch.vue';
import { refocusAfterRemoval } from '../refocus.ts';
import SlotCell from './SlotCell.vue';
import type { StorageBayView } from '../../views/storage.ts';
import type { UpdateOp } from '../../../types/index.ts';

const props = withDefaults(
  defineProps<{ bay: StorageBayView; position?: number; order?: string[] }>(),
  { position: 0, order: () => [] },
);

const view = computed(() =>
  legacy(() => {
    const b = props.bay,
      items = b.items.filter(x => x.name),
      progress = bayProgress(b);
    return {
      editing: layoutEditing,
      // A handbook bay sharing its letter with an added bay (stored before #91) cannot be
      // hidden until that bay is removed (storageBayHide in state.ts).
      canHide: !b.custom && !storageBays().some(x => x.custom && x.id === b.id),
      // The floors this bay can move to (#190): every other floor in the tabs.
      moveTo: storageFloors().filter(f => f.id !== b.floor),
      // Its place in the floor's order (#191), for Move left / Move right.
      at: props.order.indexOf(b.id),
      bays: props.order.length,
      done: progress.done,
      named: progress.named,
      // The bar under the title (SP-23, #258), in whole percent.
      pct: progress.named ? Math.round((progress.done / progress.named) * 100) : 0,
      slots: b.items.map(x => ({
        ...x,
        done: x.name ? slotDone(x.id) : false,
        match: slotMatches(x, query),
        icon: x.name ? `./icons/${slug(x.name)}.png` : '',
      })),
      // A full bay still takes another container: it gets the next address, up to the
      // addressable limit.
      canAdd: b.items.length < bayCapacity,
      // What the add field suggests (#295).
      items: workspace.catalog.containerItems || [],
      // The address a container dropped past the last position gets (#208).
      next:
        b.items.length < bayCapacity ? b.id + String(b.items.length + 1).padStart(2, '0') : null,
      addPrompt:
        items.length < b.items.length
          ? 'Add container: item name…'
          : // Every bay has at least its eight printed positions.
            'Add a position beyond ' + b.items.at(-1)!.id + '…',
    };
  }),
);

// Runs one save for a control, busy meanwhile (app/busy.ts: it keeps focus, #299), then redraws;
// a failed save leaves the control as it was.
async function saving(el: HTMLButtonElement, op: UpdateOp, done?: () => void) {
  await whileBusy(el, async () => {
    try {
      await save(op);
      render();
      done?.();
    } catch {}
  });
}

// "Complete room X": tick every check of every named container in the bay in one write. The
// button is busy while saving (app/busy.ts), and disabled afterwards while every container is
// done (marked .unavailable, so it shows no wait cursor, and relabelled). Focus then goes to the
// next bay's Complete room that can still be pressed, else the previous one's, else this bay's
// first container (#299).
async function completeRoom(e: Event) {
  const button = e.currentTarget as HTMLButtonElement,
    bay = storageBays().find(b => b.id === props.bay.id);
  if (!bay || isBusy(button)) return;
  const first = bay.items.find(x => x.name)?.id ?? '';
  const refocus = refocusAfterRemoval(button, {
    row: '#main .floor-grid .bay',
    control: '[data-complete-bay]:not(:disabled)',
    fallback: [`#main [data-slot="${CSS.escape(first)}"]`],
  });
  await whileBusy(button, async () => {
    try {
      await save({
        type: 'checks',
        keys: bay.items.filter(x => x.name).flatMap(x => slotKeys(x.id)),
        value: true,
      });
      render();
      toast('Room ' + bay.id + ' completed. You can uncheck individual containers if needed.');
    } catch {}
  });
  await nextTick();
  if (button.disabled) await refocus();
}

// A container's Done box, busy while it saves (app/busy.ts). A failed write unticks it again.
function completeSlot(e: Event, id: string) {
  const el = e.target as HTMLInputElement,
    value = el.checked;
  return whileBusy(el, async () => {
    try {
      await save({ type: 'checks', keys: slotKeys(id), value });
      render();
    } catch {
      el.checked = !value;
    }
  });
}

// The bay's name field, read-only while it saves (app/busy.ts). Redrawn whether or not the save
// worked, so a failed rename shows the saved name again.
function rename(e: Event) {
  const el = e.target as HTMLInputElement;
  return whileBusy(el, async () => {
    try {
      await save({ type: 'storageBayRename', id: props.bay.id, name: el.value });
    } catch {
    } finally {
      render();
    }
  });
}

// ✕: clear a container. Its ✕ goes with it, so focus goes to the next container's ✕ in this bay,
// else the previous one's, else the bay's add field or name (ui/refocus.ts, #290).
function clearSlot(e: Event, id: string) {
  const button = e.currentTarget as HTMLButtonElement;
  const refocus = refocusAfterRemoval(button, {
    scope: button.closest('.bay'),
    row: '.bay-items > [data-drop]',
    control: '[data-clear-slot]',
    fallback: ['.add-container [name=name]', '.bay-rename'],
  });
  return saving(button, { type: 'storageSlotClear', key: id }, () => {
    toast('Container cleared. Its saved checkmarks are kept with the address.');
    void refocus();
  });
}

// Where focus goes once a bay is hidden or removed (ui/refocus.ts, #286): the next bay's Remove
// or Hide, else the previous bay's, else the new bay's letter field.
const bayList = {
  row: '#main .floor-grid .bay',
  control: '[data-remove-bay], [data-hide-bay]',
  fallback: ['#new-bay-letter'],
};

// A handbook bay is hidden rather than removed (#166): everything saved for it stays, and
// "Hidden bays" on the storage page brings it back.
async function hideBay(e: Event) {
  // Read before the question: currentTarget is only set while the click is dispatched.
  const button = e.currentTarget as HTMLButtonElement;
  if (isBusy(button)) return;
  const refocus = refocusAfterRemoval(button, bayList);
  if (
    !(await confirmAction({
      title: `Hide bay ${props.bay.id}?`,
      body: `Hide bay ${props.bay.id}? Its containers, checkmarks and notes are kept, and you can restore it under Hidden bays and floors.`,
      confirmLabel: 'Hide bay',
    }))
  )
    return;
  saving(button, { type: 'storageBayHide', id: props.bay.id }, refocus);
}

// "Move to…": the bay goes to another floor with its letter, so its containers, checkmarks
// and notes go with it (#190). The menu is reset either way, and is busy while it saves
// (app/busy.ts): a key pressed on it meanwhile changes nothing. The bay leaves this floor on
// success, so focus goes to the next bay's menu, else the previous one's, else the new bay's
// letter field.
function moveBay(e: Event) {
  const el = e.target as HTMLSelectElement,
    floor = el.value,
    label = storageFloors().find(f => f.id === floor)?.label;
  el.value = '';
  if (!floor || isBusy(el)) return;
  const refocus = refocusAfterRemoval(el, { ...bayList, control: '[data-move-bay]' });
  return whileBusy(el, async () => {
    try {
      await save({ type: 'storageBayMove', id: props.bay.id, floor });
      render();
      toast(`Bay ${props.bay.id} moved to ${label}, with its containers and checkmarks.`);
      void refocus();
    } catch {}
  });
}

// "Move left" / "Move right": swap the bay with its neighbour in the floor's order and save the
// whole order (#191). Its containers and progress are untouched: only its place changes.
// Both buttons are busy while it saves (a bound flag, app/busy.ts). Focus stays on the pressed
// button, or goes to the other one once the bay has reached the end of the row (#299); moving the
// bay's section in the page can take focus off it too.
const shifting = ref(false);
async function shiftBay(e: Event, by: -1 | 1) {
  const order = [...props.order],
    at = order.indexOf(props.bay.id),
    to = at + by;
  if (shifting.value || at < 0 || to < 0 || to >= order.length) return;
  [order[at], order[to]] = [order[to]!, order[at]!];
  const id = CSS.escape(props.bay.id),
    [same, other] = by < 0 ? ['left', 'right'] : ['right', 'left'];
  const refocus = refocusAfterRemoval(e.currentTarget, {
    fallback: [
      `#main [data-bay-${same}="${id}"]:not(:disabled)`,
      `#main [data-bay-${other}="${id}"]`,
    ],
  });
  shifting.value = true;
  try {
    await save({ type: 'storageBayOrder', floor: props.bay.floor, order });
    render();
  } catch {
  } finally {
    shifting.value = false;
  }
  await refocus();
}

async function removeBay(e: Event) {
  // Read before the question: currentTarget is only set while the click is dispatched.
  const button = e.currentTarget as HTMLButtonElement;
  if (isBusy(button)) return;
  const refocus = refocusAfterRemoval(button, bayList);
  if (
    !(await confirmAction({
      title: `Remove bay ${props.bay.id}?`,
      body: 'Remove this added bay? Its containers, checkmarks and notes are removed with it.',
      confirmLabel: 'Remove bay',
      danger: true,
    }))
  )
    return;
  saving(button, { type: 'storageBayRemove', id: props.bay.id }, refocus);
}

// "+ Add": put an item in this bay, in a free position first; a bay with none gets the next
// address after its last. A success empties the form. The name must be one of the game's items
// (#295), matched without regard to case and saved as the list spells it, so a typo cannot make
// an unknown item; otherwise the field says so and nothing is saved. Containers saved earlier
// under another name keep it. A catalog without the list (none should lack it) takes any name,
// as before.
const unknown = ref('');
async function addContainer(e: Event) {
  const form = e.target as HTMLFormElement,
    typed = String(new FormData(form).get('name') || '').trim(),
    items = view.value.items;
  if (!typed) return;
  const name = items.length ? knownItem(items, typed) : typed;
  if (!name) {
    unknown.value = typed;
    form.querySelector<HTMLInputElement>('[name=name]')?.focus();
    return;
  }
  unknown.value = '';
  const bay = storageBays().find(b => b.id === props.bay.id);
  if (!bay) return;
  const free =
    bay.items.find(x => !x.name)?.id ||
    (bay.items.length < bayCapacity
      ? bay.id + String(bay.items.length + 1).padStart(2, '0')
      : null);
  if (!free) {
    toast('This bay holds the most addresses it can. Add another bay.', true);
    return;
  }
  try {
    await save({ type: 'storageSlotAssign', key: free, name });
    form.reset();
    render();
  } catch {}
}
</script>

<template>
  <section
    class="bay"
    :style="`--bay-row:${Math.floor(position / 2) + 1};--bay-col:${position % 2 ? 3 : 1}`"
  >
    <header class="bay-head">
      <span class="bay-letter">{{ bay.id }}</span
      ><input
        v-if="view.editing"
        :id="'bay-name-' + bay.id"
        class="bay-rename"
        :data-bay-rename="bay.id"
        :value="bay.name"
        maxlength="80"
        :aria-label="'Rename bay ' + bay.id"
        @change="rename"
      />
      <h3 v-else>{{ bay.name }}</h3>
    </header>
    <!-- The bar draws the count beside it ("3/8 containers done"), which is what a screen reader
         reads, so the bar itself is hidden from one (SP-23, #258). -->
    <div v-if="view.named" class="progress-track" aria-hidden="true" :data-bay-progress="bay.id">
      <span :style="{ width: view.pct + '%' }"></span>
    </div>
    <div class="bay-actions">
      <span class="small muted">{{ view.done }}/{{ view.named }} containers done</span
      ><span
        ><button
          v-if="view.editing && bay.custom"
          class="btn danger"
          :data-remove-bay="bay.id"
          @click="removeBay"
        >
          Remove bay
        </button>
        <template v-if="view.editing && view.bays > 1 && view.at >= 0"
          ><button
            class="btn quiet"
            :data-bay-left="bay.id"
            :aria-label="'Move bay ' + bay.id + ' left'"
            title="Move left"
            :class="{ unavailable: !shifting }"
            :aria-disabled="shifting || undefined"
            :disabled="!shifting && view.at === 0"
            @click="shiftBay($event, -1)"
          >
            ←</button
          ><button
            class="btn quiet"
            :data-bay-right="bay.id"
            :aria-label="'Move bay ' + bay.id + ' right'"
            title="Move right"
            :class="{ unavailable: !shifting }"
            :aria-disabled="shifting || undefined"
            :disabled="!shifting && view.at === view.bays - 1"
            @click="shiftBay($event, 1)"
          >
            →
          </button></template
        >
        <select
          v-if="view.editing && view.moveTo.length"
          class="move-bay"
          :data-move-bay="bay.id"
          :aria-label="'Move bay ' + bay.id + ' to another floor'"
          @change="moveBay"
        >
          <option value="">Move to…</option>
          <option v-for="f in view.moveTo" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>
        <button
          v-if="view.editing && view.canHide"
          class="btn quiet"
          :data-hide-bay="bay.id"
          @click="hideBay"
        >
          Hide bay
        </button>
        <button
          class="btn quiet unavailable"
          :data-complete-bay="bay.id"
          :disabled="!view.named || view.done === view.named"
          @click="completeRoom"
        >
          {{
            view.named && view.done === view.named
              ? `Room ${bay.id} completed ✓`
              : `Complete room ${bay.id}`
          }}
        </button></span
      >
    </div>
    <div class="bay-items">
      <template v-for="(x, i) in view.slots" :key="x.id"
        ><div v-if="i === 4" class="walkway">BAY WALKWAY</div>
        <div v-if="i === 8" class="walkway added">ADDED POSITIONS</div>
        <SlotCell
          v-if="x.name"
          :id="x.id"
          :editing="view.editing"
          :label="`${x.id}: ${x.name}`"
          :class="['slot', x.done ? 'done' : '', x.match ? 'match' : '']"
        >
          <button
            v-if="view.editing"
            class="slot-remove"
            :data-clear-slot="x.id"
            :aria-label="`Clear container ${x.id}: ${x.name}`"
            @click="clearSlot($event, x.id)"
          >
            ✕</button
          ><button
            class="slot-details"
            :data-slot="x.id"
            :aria-label="`${x.id}: ${x.name}`"
            @click="openSlot(x.id)"
          >
            <strong>{{ x.id }}</strong
            ><img
              class="item-icon"
              :src="x.icon"
              width="48"
              height="48"
              loading="lazy"
              alt=""
            /><span>{{ x.name }}</span></button
          ><label class="slot-complete"
            ><input
              type="checkbox"
              :data-complete-slot="x.id"
              :aria-label="`Complete ${x.id}: ${x.name}`"
              :checked="x.done"
              @change="completeSlot($event, x.id)"
            />Done</label
          >
        </SlotCell>
        <!-- A reserved position keeps a filled card's shape: invisible stand-ins for the icon and
             the Done box hold the same space, so a row of reserved positions is as tall as any
             other (#200). -->
        <SlotCell v-else :id="x.id" :editing="view.editing" class="slot empty">
          <strong>{{ x.id }}</strong
          ><span class="slot-icon-space" aria-hidden="true"></span
          ><span class="slot-reserved">Reserved</span
          ><span class="slot-complete slot-space" aria-hidden="true"
            ><input type="checkbox" tabindex="-1" disabled /></span></SlotCell
      ></template>
      <!-- While editing, a drop past the last position makes a new one there (#208). Keyed by its
           address: once that address is filled, the filled position registers it with dnd-kit, and
           a live drop target renamed to the next address then never registered that one, so a drop
           on it went to the nearest other position, often the container just placed (#292). A new
           cell for each address registers cleanly. -->
      <SlotCell
        v-if="view.editing && view.next"
        :key="view.next"
        :id="view.next"
        :editing="true"
        class="slot empty drop-new"
      >
        <strong>{{ view.next }}</strong
        ><span class="slot-reserved">Drop here for a new position</span>
      </SlotCell>
    </div>
    <form
      v-if="view.editing && view.canAdd"
      class="inline-form add-container"
      :data-bay="bay.id"
      @submit.prevent="addContainer"
    >
      <ItemSearch
        :items="view.items"
        name="name"
        :input-id="'bay-draft-' + bay.id"
        :list-id="'bay-draft-' + bay.id + '-options'"
        :maxlength="120"
        required
        :placeholder="view.addPrompt"
        :aria-label="'Add container to bay ' + bay.id"
        :invalid="!!unknown"
        :describedby="unknown ? 'bay-draft-' + bay.id + '-hint' : undefined"
        @typing="unknown = ''"
        @pick="unknown = ''"
      /><button class="btn" type="submit">+ Add</button
      ><span
        v-if="unknown"
        :id="'bay-draft-' + bay.id + '-hint'"
        class="supply-hint warn"
        role="status"
        >No item of that name — pick one from the list.</span
      >
    </form>
  </section>
</template>
