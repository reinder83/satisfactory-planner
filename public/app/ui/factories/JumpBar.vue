<!--
  The jump bar of both factories pages (SP-17, #252), under the toolbar: a button per group or
  shared site the page draws, with how many of its factories are marked running ("Iron campus
  2/5", groupJumps() and jumpEntry() in views/factories.ts). They are buttons rather than links
  because a hash link here would be a route. Pressing one brings that section to the top and
  focuses its heading (focusSection in ui/refocus.ts); a folded section is unfolded first, and
  stays unfolded, since going there is asking to see it.
-->
<script setup lang="ts">
import { nextTick } from 'vue';
import { sectionCollapsed, setSectionCollapsed } from '../../session.ts';
import { render } from '../../shell.ts';
import { focusSection } from '../refocus.ts';
import type { JumpEntry } from '../../views/factories.ts';

defineProps<{ entries: JumpEntry[] }>();

async function jump(key: string) {
  if (sectionCollapsed(key)) {
    setSectionCollapsed(key, false);
    render();
    await nextTick();
  }
  const section = document.getElementById('section-' + key);
  if (section) focusSection(section);
}
</script>

<template>
  <nav v-if="entries.length" class="jump-bar" aria-label="Groups on this page">
    <button
      v-for="e in entries"
      :key="e.key"
      type="button"
      class="btn"
      :data-jump="e.key"
      @click="jump(e.key)"
    >
      {{ e.label }}
      <span class="count" aria-hidden="true">{{ e.running }}/{{ e.total }}</span
      ><span class="visually-hidden">, {{ e.running }} of {{ e.total }} running</span>
    </button>
  </nav>
</template>
