<!--
  "What the restore changed" on the Backup page (X-6, #1352): after "Restore this profile…" it
  lists what is different from just before, as restore-changes.ts counted it (lines now running,
  parts delivered, steps done, the phase, notes). Nothing is stored; Dismiss or leaving the page
  clears it. The heading takes focus when the summary appears, so a screen reader reads it and
  the list under it, and a keyboard user is already there; Dismiss puts focus back on the button
  that restored. ADA says the same in her words (ada.ts `progress-restored`).
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import HelpPopover from '../HelpPopover.vue';

defineProps<{
  // The summary's lines, one per change; none when the restore changed nothing.
  lines: string[];
}>();
defineEmits<{ dismiss: [] }>();
const heading = ref<HTMLElement>();
onMounted(() => heading.value?.focus());
</script>

<template>
  <section
    class="panel restore-changes"
    data-restore-changes
    aria-labelledby="restore-changes-title"
  >
    <h2 id="restore-changes-title" ref="heading" tabindex="-1">
      What the restore changed
      <HelpPopover name="restoreChangesHelp" topic="the restore summary" />
    </h2>
    <ul v-if="lines.length" class="restore-changes-list" data-restore-changes-list>
      <li v-for="line in lines" :key="line">{{ line }}</li>
    </ul>
    <p v-else data-restore-changes-none>
      Nothing changed: the backup holds the same progress as this profile.
    </p>
    <button type="button" class="btn" data-restore-changes-dismiss @click="$emit('dismiss')">
      Dismiss
    </button>
  </section>
</template>
