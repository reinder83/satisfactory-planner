<!--
  The status chip at the top of a factory card (SP-15, #250): ● Running, ○ Not built, or
  ◐ Held back for a calculated row marked running that a missing supplier holds back (the card
  shows the reason above its footer), or ◑ From Phase N for a line not ticked in this phase that
  runs from the phase before (#1069; the card says how many machines run). It only shows state:
  the card's Running box stays the one control, and the chip follows it. The glyph and the word
  both say the state, so it reads without colour. The chip is hidden from screen readers, which
  already hear the Running box ("Running, checkbox, checked"), the held-back reason and the
  carried machines as text, so the state is not said twice.
-->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: 'running' | 'idle' | 'held' | 'carried'; from?: string }>();

const CHIPS = {
  running: { glyph: '●', text: 'Running', tone: 'green' },
  idle: { glyph: '○', text: 'Not built', tone: '' },
  held: { glyph: '◐', text: 'Held back', tone: 'orange held' },
  carried: { glyph: '◑', text: 'From Phase', tone: 'carried' },
} as const;

const chip = computed(() => {
  const { glyph, text, tone } = CHIPS[props.status];
  return { glyph, tone, text: props.status === 'carried' ? `${text} ${props.from}` : text };
});
</script>
<template>
  <span
    :class="['badge', 'status-chip', chip.tone]"
    :data-running-status="status"
    aria-hidden="true"
    ><span class="status-glyph">{{ chip.glyph }}</span> {{ chip.text }}</span
  >
</template>
