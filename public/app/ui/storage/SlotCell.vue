<!--
  One container position of a bay (StorageBay.vue) as a drag-and-drop target (#208), with
  @dnd-kit/vue under the storage page's DragDropProvider. While the layout is being edited every
  position takes a drop, and a filled one (`label` set) can be picked up by its ⠿ handle, with the
  mouse, a finger or the keyboard (Space or Enter, the arrow keys, then Space or Enter; Escape
  cancels). Outside edit mode nothing drags, so ticking a Done box never starts a drag. The drop
  itself is handled once, by the page (moveContainer in StoragePage.vue).
-->
<script setup lang="ts">
import { ref } from 'vue';
import { useDraggable, useDroppable } from '@dnd-kit/vue';
import { pointerOnly } from './drop-point.ts';

const props = defineProps<{
  // The address, which is also the drag and drop id. It must stay the same for the cell's
  // lifetime: key the cell by it. When another cell registers this cell's id and this one moves on
  // to a new id, @dnd-kit/vue 0.5 never registers the new one, so the cell takes no drops (#292).
  id: string;
  editing: boolean;
  // "C05: Iron Plate" for a filled position; none for a reserved one.
  label?: string;
}>();

const el = ref<HTMLElement | null>(null),
  handle = ref<HTMLElement | null>(null);
// A position is the drop target only while the pointer is over it (./drop-point.ts, #298). The
// detector goes in as a getter: @dnd-kit/vue reads every input through Vue's toValue(), which
// would call the detector itself, with no arguments, and throw.
const { isDropTarget } = useDroppable({
  id: () => props.id,
  element: el,
  disabled: () => !props.editing,
  collisionDetector: () => pointerOnly,
});
// Only a position that can be picked up is given to dnd-kit as a draggable: with no handle it would
// make the whole card a focusable role="button" with aria-disabled, and the card's own controls
// would then read as disabled too.
const movable = () => props.editing && !!props.label;
const { isDragging } = useDraggable({
  id: () => props.id,
  element: () => (movable() ? el.value : undefined),
  handle,
  disabled: () => !movable(),
});
</script>

<template>
  <div ref="el" :class="{ 'drop-over': isDropTarget, dragging: isDragging }" :data-drop="id">
    <button
      v-if="editing && label"
      ref="handle"
      type="button"
      class="slot-drag"
      :data-drag-slot="id"
      :aria-label="`Move container ${label}. Space to pick it up, arrow keys to move, Space to drop.`"
      title="Drag to another position"
    >
      ⠿
    </button>
    <slot />
  </div>
</template>
