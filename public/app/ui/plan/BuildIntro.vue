<!--
  The build plan's intro, shown once per browser (BP-13, #1355): the first time a build plan with
  its steps is drawn, the paragraph that is otherwise only the "?" beside "Build sequence"
  (helpText.buildIntro, ui/HelpPopover.vue) is also drawn under the heading, with "Got it". The
  seen flag (app/sessions.ts, `planner-intro-seen` in localStorage, never in a saved profile) is
  set when it is first drawn, so a reload, another phase or another profile does not repeat it;
  it goes at "Got it" (focus moves to the "?"), when another phase is shown or when the page is
  left. The "?" keeps the
  whole text, so hiding it never loses it. The region is aria-live="polite", so a screen reader
  hears the paragraph when it appears. A browser without storage shows it once per page load.
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { helpText } from '../../../preferences.ts';
import { introSeen, markIntroSeen } from '../../sessions.ts';

const shown = ref(false);
onMounted(() => {
  if (introSeen()) return;
  shown.value = true;
  markIntroSeen();
});
onBeforeUnmount(() => (shown.value = false));
// "Got it" goes with the intro, which would drop focus on <body>: it moves to the "?" that brings
// the text back.
function dismiss() {
  shown.value = false;
  document.querySelector<HTMLElement>('#main [data-help=buildIntro]')?.focus();
}
</script>

<template>
  <div aria-live="polite" data-build-intro-region>
    <div v-if="shown" class="build-intro" data-build-intro>
      <p class="small muted">{{ helpText.buildIntro }}</p>
      <div class="build-intro-actions">
        <button type="button" class="btn quiet" data-build-intro-dismiss @click="dismiss">
          Got it
        </button>
        <span class="small muted">The “?” beside Build sequence brings this back.</span>
      </div>
    </div>
  </div>
</template>
