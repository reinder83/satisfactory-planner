<!--
  The status filter of both factories pages (SP-16, #251): a row of chips styled like the storage
  floor tabs (.tabs), each with its count, from statusFilter() in views/factories.ts. It is a
  radio group: one chip is in the Tab order (the chosen one), and the arrow keys, Home and End
  move to another chip and choose it, as radio buttons do. A chip with no matches can still be
  chosen; the page then says so. `pick` reports the value; the page stores it in `factoryFilter`.
-->
<script setup lang="ts">
import type { FilterChip, StatusFilter } from '../../views/factories.ts';

const props = defineProps<{ chips: FilterChip[]; active: StatusFilter }>();
const emit = defineEmits<{ pick: [value: StatusFilter] }>();

// The chip a key moves to from chip `index`, or -1 for a key the group leaves alone.
function target(key: string, index: number, count: number) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

// The chips are keyed by value, so the one focused here is still there after the redraw.
function move(event: KeyboardEvent, index: number) {
  const to = target(event.key, index, props.chips.length);
  if (to < 0) return;
  event.preventDefault();
  const group = (event.currentTarget as HTMLButtonElement).parentElement;
  group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  // to is an index into chips (target() keeps it in range).
  emit('pick', props.chips[to]!.value);
}
</script>

<template>
  <div
    id="factory-filter"
    class="tabs filter-chips"
    role="radiogroup"
    aria-label="Production line status"
  >
    <button
      v-for="(chip, i) in chips"
      :key="chip.value"
      type="button"
      role="radio"
      :class="['tab', chip.value === active ? 'active' : '']"
      :aria-checked="chip.value === active"
      :tabindex="chip.value === active ? 0 : -1"
      :data-filter="chip.value"
      @click="emit('pick', chip.value)"
      @keydown="move($event, i)"
    >
      {{ chip.label }} <span class="count">{{ chip.count }}</span>
    </button>
  </div>
</template>
