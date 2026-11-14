<!--
  The contents of #jump, the quick-jump search (#1351, X-5 and BAK-4, ui/jump.ts): a search box
  and the results under it, grouped (production lines, factories, build plan steps, storage
  containers, notes: jump-index.ts). The box is an ARIA combobox over a listbox: ArrowDown and
  ArrowUp move the highlighted option (aria-activedescendant, focus stays in the box), Enter opens
  it, Escape closes the dialog. The first result is highlighted as soon as there is one, so typing
  and Enter is the whole gesture. A line under the box says how many results there are, for a
  screen reader.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { JUMP_GROUPS, jumpResults, type JumpResult } from '../jump-index.ts';

const props = defineProps<{ close: () => void; choose: (result: JumpResult) => void }>();

const query = ref('');
const active = ref(0);
const results = computed(() => jumpResults(query.value));
// The results with a heading before each group's first.
const rows = computed(() =>
  results.value.map((result, index) => ({
    result,
    index,
    heading: index === 0 || results.value[index - 1]!.kind !== result.kind,
  })),
);
const status = computed(() =>
  !query.value.trim()
    ? ''
    : results.value.length
      ? `${results.value.length} ${results.value.length === 1 ? 'result' : 'results'}`
      : 'No results',
);
watch(results, () => (active.value = 0));

const optionId = (index: number) => `jump-option-${index}`;

function key(event: KeyboardEvent) {
  const count = results.value.length;
  if (event.key === 'ArrowDown' && count) active.value = (active.value + 1) % count;
  else if (event.key === 'ArrowUp' && count) active.value = (active.value - 1 + count) % count;
  else if (event.key === 'Home' && count) active.value = 0;
  else if (event.key === 'End' && count) active.value = count - 1;
  else if (event.key === 'Enter') {
    const result = results.value[active.value];
    if (result) props.choose(result);
  } else return;
  event.preventDefault();
  document.getElementById(optionId(active.value))?.scrollIntoView?.({ block: 'nearest' });
}
</script>

<template>
  <header class="dialog-head">
    <div class="dialog-title">
      <div>
        <div class="eyebrow">Quick jump</div>
        <h2 id="jump-title">Go to…</h2>
      </div>
    </div>
    <button class="close" type="button" aria-label="Close" data-jump-close @click="close()">
      ×
    </button>
  </header>
  <div class="dialog-body">
    <input
      v-model="query"
      type="text"
      class="jump-input"
      role="combobox"
      aria-label="Search production lines, factories, steps, containers and notes"
      aria-autocomplete="list"
      aria-controls="jump-list"
      :aria-expanded="results.length ? 'true' : 'false'"
      :aria-activedescendant="results.length ? optionId(active) : undefined"
      placeholder="Search lines, factories, steps, containers, notes"
      autocomplete="off"
      spellcheck="false"
      data-jump-input
      @keydown="key"
    />
    <p class="small muted jump-status" role="status" data-jump-status>{{ status }}</p>
    <ul id="jump-list" class="jump-list" role="listbox" aria-label="Results">
      <template v-for="row in rows" :key="row.result.kind + row.result.id">
        <li v-if="row.heading" role="presentation" class="jump-group">
          {{ JUMP_GROUPS[row.result.kind] }}
        </li>
        <li
          :id="optionId(row.index)"
          role="option"
          :aria-selected="row.index === active ? 'true' : 'false'"
          :class="['jump-option', row.index === active ? 'active' : '']"
          :data-jump-kind="row.result.kind"
          @mousemove="active = row.index"
          @click="choose(row.result)"
        >
          <span class="jump-label">{{ row.result.label }}</span>
          <span class="small muted jump-hint">{{ row.result.hint }}</span>
        </li>
      </template>
    </ul>
    <p class="small muted jump-keys">↑ ↓ to move · Enter to open · Esc to close</p>
  </div>
</template>
