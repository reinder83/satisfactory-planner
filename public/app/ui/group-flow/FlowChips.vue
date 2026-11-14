<!--
  The ends of a row's links as chips (BO-2, #1346): "from 01" and "to 02" are buttons that take
  the page to that step (the page opens and focuses it), another factory's name is a link to its
  build order page, and the rest ("Raw resource", "AWESOME Sink", "from itself") is plain text.
  The words come from linkChips in views/group-flow-page.ts; a screen reader gets the full name
  of the step or factory. Chips are real buttons and links, 24px or taller, and wrap with the row.
-->
<script setup lang="ts">
import { flowRoute } from '../../session.ts';
import type { LinkChip } from '../../views/group-flow-page.ts';

defineProps<{ chips: LinkChip[]; view: string | null }>();
defineEmits<{ go: [line: string] }>();
</script>

<template>
  <span v-if="chips.length" class="gf-chips">
    <template v-for="chip in chips" :key="chip.key"
      >{{ ' '
      }}<button
        v-if="chip.kind === 'line'"
        type="button"
        class="gf-chip"
        :aria-label="chip.label"
        :data-chip-line="chip.target"
        @click="$emit('go', chip.target!)"
      >
        {{ chip.text }}</button
      ><a
        v-else-if="chip.kind === 'group'"
        class="gf-chip"
        :aria-label="chip.label"
        :href="'#' + flowRoute(chip.target!, undefined, view)"
        :data-chip-group="chip.target"
        >{{ chip.text }}</a
      ><span v-else class="gf-chip plain">{{ chip.text }}</span></template
    >
  </span>
</template>
