<!--
  One tab per phase (#1317), above a factory's build order page (ui/pages/GroupFlowPage.vue) and
  its flow graph dialog: look at another phase's lines, flows and build order without switching
  the profile's phase. A WAI-ARIA tab list like the build plan's and Logistics' (#1243, #1295):
  the arrow keys, Home and End move to a tab and open it, only the open tab is in the Tab order,
  and each tab names the panel it controls (`panel`, an id the page gives its panel, which it
  labels with the open tab's id, tabId()). The phase on screen is marked "Phase 4 · current".
  A phase where the factory has no lines is dimmed and unavailable (aria-disabled, "no lines in
  Phase 2" in its title and for a screen reader): the keys skip it and a press does nothing. The
  open tab and the current one are never unavailable, so a factory with no lines in the phase on
  screen still opens on it and the way back to it stays. Nothing here is stored: the page holds the open tab. The row scrolls sideways inside its
  own box when the tabs do not fit, never the page.
-->
<script setup lang="ts">
import { nextTick } from 'vue';
import type { PhaseTab } from '../phase-tabs.ts';
import { tabId } from '../phase-tabs.ts';
import type { StageKey } from '../../types/index.ts';
import { tabKeyTarget } from './plan/plan-tabs.ts';

const props = defineProps<{
  tabs: readonly PhaseTab[];
  open: StageKey;
  // Prefix of the tab ids and the value of data-phase-tabs.
  prefix: string;
  // The id of the panel the tabs control.
  panel: string;
  label: string;
}>();
const emit = defineEmits<{ pick: [key: StageKey] }>();

// A tab is unavailable while it is empty, unless it is the open one or the current phase's (the
// way back to the phase on screen, whose page says what it lacks).
const unavailable = (tab: PhaseTab) => tab.empty && tab.key !== props.open && !tab.current;

// The tab an arrow key, Home or End reaches from the open one, skipping unavailable ones.
function target(key: string): number | null {
  const at = props.tabs.findIndex(tab => tab.key === props.open);
  const count = props.tabs.length;
  const first = tabKeyTarget(key, at, count);
  if (first === null) return null;
  const step = key === 'ArrowLeft' || key === 'ArrowUp' || key === 'End' ? -1 : 1;
  // Home and End start from outside the list, so the first or last available tab is the answer.
  let next = first;
  for (let tried = 0; tried < count; tried++) {
    if (!unavailable(props.tabs[next]!)) return next; // tabKeyTarget stays inside the list
    next = (next + step + count) % count;
  }
  return null;
}
function onKey(event: KeyboardEvent) {
  const next = target(event.key);
  if (next === null) return;
  event.preventDefault();
  const tab = props.tabs[next]!;
  if (tab.key === props.open) return;
  emit('pick', tab.key);
  void nextTick(() =>
    document
      .querySelector<HTMLButtonElement>(
        `[data-phase-tabs="${props.prefix}"] [data-phase-tab="${tab.key}"]`,
      )
      ?.focus(),
  );
}
const pick = (tab: PhaseTab) => {
  if (!unavailable(tab) && tab.key !== props.open) emit('pick', tab.key);
};
</script>

<template>
  <div
    class="tabs phase-tabs"
    role="tablist"
    :aria-label="label"
    :data-phase-tabs="prefix"
    @keydown="onKey"
  >
    <button
      v-for="tab in tabs"
      :id="tabId(prefix, tab.key)"
      :key="tab.key"
      type="button"
      role="tab"
      :class="['tab', tab.key === open ? 'active' : '', unavailable(tab) ? 'empty' : '']"
      :aria-selected="tab.key === open ? 'true' : 'false'"
      :aria-controls="panel"
      :aria-disabled="unavailable(tab) ? 'true' : undefined"
      :tabindex="tab.key === open ? 0 : -1"
      :title="unavailable(tab) ? `No lines in ${tab.label}` : undefined"
      :data-phase-tab="tab.key"
      :data-current="tab.current ? 'true' : undefined"
      @click="pick(tab)"
    >
      {{ tab.label }}<template v-if="tab.current"> · current</template
      ><span v-if="unavailable(tab)" class="visually-hidden">, no lines in {{ tab.label }}</span>
    </button>
  </div>
</template>
