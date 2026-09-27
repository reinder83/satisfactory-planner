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

// The chip a key moves to from chip i, or -1 for a key the group leaves alone.
function target(key: string, i: number, n: number) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return -1;
}

// The chips are keyed by value, so the one focused here is still there after the redraw.
function move(e: KeyboardEvent, i: number) {
  const to = target(e.key, i, props.chips.length);
  if (to < 0) return;
  e.preventDefault();
  const group = (e.currentTarget as HTMLButtonElement).parentElement;
  group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  // to is an index into chips (target() keeps it in range).
  emit('pick', props.chips[to]!.value);
}
</script>

<template>
  <div id="factory-filter" class="tabs status-chips" role="radiogroup" aria-label="Factory status">
    <button
      v-for="(c, i) in chips"
      :key="c.value"
      type="button"
      role="radio"
      :class="['tab', c.value === active ? 'active' : '']"
      :aria-checked="c.value === active"
      :tabindex="c.value === active ? 0 : -1"
      :data-filter="c.value"
      @click="emit('pick', c.value)"
      @keydown="move($event, i)"
    >
      {{ c.label }} <span class="count">{{ c.count }}</span>
    </button>
  </div>
</template>
