<!--
  One bay of the storage room. `position` is its index in hall order and sets the CSS grid
  row and column (two bays per row, aisle between). A container opens its dialog, and its
  Done box writes all four of its saved `slot-<address>-<step>` checks in one save; "Complete
  room" does that for every named container of the bay. While editing the layout, the bay
  can be renamed, a container cleared (its checkmarks stay with the address), an item added
  (a free position first, then the next address) and an added bay removed.
-->
<script setup>
import { computed } from 'vue';
import { bayCapacity } from '../../../state.js';
import { save, toast } from '../../api.js';
import { slug } from '../../format.js';
import { layoutEditing, query } from '../../session.js';
import { render } from '../../shell.js';
import { openSlot, slotDone, slotKeys, storageBays } from '../../views/storage.js';
import { legacy } from '../bridge.js';

const props = defineProps({
  bay: { type: Object, required: true },
  position: { type: Number, default: 0 },
});

const view = computed(() =>
  legacy(() => {
    const b = props.bay,
      items = b.items.filter(x => x.name);
    const q = query.toLowerCase();
    return {
      editing: layoutEditing,
      done: items.filter(x => slotDone(x.id)).length,
      named: items.length,
      slots: b.items.map(x => ({
        ...x,
        done: x.name ? slotDone(x.id) : false,
        match: !!(query && x.name && (x.id + ' ' + x.name).toLowerCase().includes(q)),
        icon: x.name ? `./icons/${slug(x.name)}.png` : '',
      })),
      // A full bay still takes another container: it gets the next address, up to the
      // addressable limit.
      canAdd: b.items.length < bayCapacity,
      addPrompt:
        items.length < b.items.length
          ? 'Add container: item name…'
          : 'Add a position beyond ' + b.items.at(-1).id + '…',
    };
  }),
);

// Runs one save for a control, disabled meanwhile, then redraws; a failed save leaves the
// control as it was.
async function saving(el, op, done) {
  el.disabled = true;
  try {
    await save(op);
    render();
    done?.();
  } catch {
  } finally {
    el.disabled = false;
  }
}

// "Complete room X": tick every check of every named container in the bay in one write.
function completeRoom(e) {
  const bay = storageBays().find(b => b.id === props.bay.id);
  if (!bay) return;
  saving(
    e.currentTarget,
    {
      type: 'checks',
      keys: bay.items.filter(x => x.name).flatMap(x => slotKeys(x.id)),
      value: true,
    },
    () => toast('Room ' + bay.id + ' completed. You can uncheck individual containers if needed.'),
  );
}

// A container's Done box. A failed write unticks it again.
async function completeSlot(e, id) {
  const el = e.target,
    value = el.checked;
  el.disabled = true;
  try {
    await save({ type: 'checks', keys: slotKeys(id), value });
    render();
  } catch {
    el.checked = !value;
  } finally {
    el.disabled = false;
  }
}

// The bay's name field. Redrawn whether or not the save worked, so a failed rename shows the
// saved name again.
async function rename(e) {
  const el = e.target;
  el.disabled = true;
  try {
    await save({ type: 'storageBayRename', id: props.bay.id, name: el.value });
  } catch {
  } finally {
    el.disabled = false;
    render();
  }
}

const clearSlot = (e, id) =>
  saving(e.currentTarget, { type: 'storageSlotClear', key: id }, () =>
    toast('Container cleared. Its saved checkmarks are kept with the address.'),
  );

function removeBay(e) {
  if (!confirm('Remove this added bay? Saved checkmarks for its addresses are kept.')) return;
  saving(e.currentTarget, { type: 'storageBayRemove', id: props.bay.id });
}

// "+ Add": put an item in this bay, in a free position first; a bay with none gets the next
// address after its last. A success empties the form.
async function addContainer(e) {
  const form = e.target,
    name = String(new FormData(form).get('name') || '').trim();
  if (!name) return;
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
        <button
          class="btn quiet"
          :data-complete-bay="bay.id"
          :disabled="!view.named || view.done === view.named"
          @click="completeRoom"
        >
          Complete room {{ bay.id }}
        </button></span
      >
    </div>
    <div class="bay-items">
      <template v-for="(x, i) in view.slots" :key="x.id"
        ><div v-if="i === 4" class="walkway">BAY WALKWAY</div>
        <div v-if="i === 8" class="walkway added">ADDED POSITIONS</div>
        <div v-if="x.name" :class="['slot', x.done ? 'done' : '', x.match ? 'match' : '']">
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
        </div>
        <div v-else class="slot empty">
          <strong>{{ x.id }}</strong
          ><span>Reserved</span>
        </div></template
      >
    </div>
    <form
      v-if="view.editing && view.canAdd"
      class="inline-form add-container"
      :data-bay="bay.id"
      @submit.prevent="addContainer"
    >
      <input
        :id="'bay-draft-' + bay.id"
        name="name"
        maxlength="120"
        required
        :placeholder="view.addPrompt"
        :aria-label="'Add container to bay ' + bay.id"
      /><button class="btn" type="submit">+ Add</button>
    </form>
  </section>
</template>
