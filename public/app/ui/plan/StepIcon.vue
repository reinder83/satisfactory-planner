<!-- A build-plan step's icon: the bundled icon of the part it makes, otherwise the glyph for
     its kind of work (taskIcon() in tasks.js), on the build plan and the storage page. The
     glyphs are fixed markup from TASK_GLYPHS, never user text. -->
<script setup>
import { TASK_GLYPHS } from '../../tasks.js';
import ItemIcon from '../ItemIcon.vue';

defineProps({ icon: { type: Object, required: true } });
</script>

<template>
  <span v-if="icon.item" class="task-icon" data-kind="item" aria-hidden="true"
    ><ItemIcon :name="icon.item"
  /></span>
  <span v-else class="task-icon" :data-kind="icon.kind" aria-hidden="true"
    ><svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      v-html="TASK_GLYPHS[icon.kind]"
    ></svg
  ></span>
</template>
