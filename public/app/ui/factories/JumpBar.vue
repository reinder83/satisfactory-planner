<!--
  The jump bar of both factories pages (SP-17, #252), under the toolbar: a button per group or
  shared site the page draws, with how many of its factories are marked running ("Iron campus
  2/5", groupJumps() and jumpEntry() in views/factories.ts). They are buttons rather than links
  because a hash link here would be a route. Pressing one brings that section to the top and
  focuses its heading (focusSection in ui/refocus.ts); a folded section is unfolded first, and
  stays unfolded, since going there is asking to see it (showSection in ui/factories/reveal.ts).
  While factories are edited only one is open (FAC-3, #1342) and this row is how to change it:
  the button of the open factory has aria-current, and another one switches to its factory.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { factoryEditing } from '../../session.ts';
import { openFactoryId, type JumpEntry } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { showSection } from './reveal.ts';

defineProps<{ entries: JumpEntry[] }>();

// The factory open while editing, '' outside edit mode.
const current = computed(() => legacy(() => (factoryEditing ? openFactoryId() : '')));

const jump = (key: string) => showSection(key);
</script>

<template>
  <nav v-if="entries.length" class="jump-bar" aria-label="Factories on this page">
    <button
      v-for="entry in entries"
      :key="entry.key"
      type="button"
      class="btn"
      :data-jump="entry.key"
      :aria-current="current && current === entry.key ? 'true' : undefined"
      @click="jump(entry.key)"
    >
      {{ entry.label }}
      <span class="count" aria-hidden="true">{{ entry.running }}/{{ entry.total }}</span
      ><span class="visually-hidden">, {{ entry.running }} of {{ entry.total }} running</span>
    </button>
  </nav>
</template>
