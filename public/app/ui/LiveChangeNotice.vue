<!--
  Above every page on the Docker edition (#1210): another tab or device saved a change to the
  profile this tab shows while the player was busy here (a dialog, a text field, an edit, a write
  on its way), so the page was not redrawn under them (app/live-refresh.ts). A quiet notice says
  so, with Refresh, which loads the progress as saved now; a later poll takes the change by
  itself once the page is quiet. The live region is always there, so the notice is announced when
  it appears.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { liveChangeHeld, refreshHeldChange } from '../live-refresh.ts';
import { legacy } from './bridge.ts';
import { refocusOnOpenedPage } from './refocus.ts';

const held = computed(() => legacy(() => liveChangeHeld()));
// Refresh is busy (aria-disabled, app/busy.ts) while the progress loads.
const refreshing = ref(false);
// The notice goes with its button, so focus goes to the page's heading.
async function refresh(event: Event) {
  if (refreshing.value) return;
  const refocus = refocusOnOpenedPage(event.currentTarget);
  refreshing.value = true;
  try {
    await refreshHeldChange();
  } finally {
    refreshing.value = false;
  }
  await refocus();
}
</script>

<template>
  <div class="live-change-live" role="status" aria-live="polite">
    <div v-if="held" class="live-change-wrap">
      <div class="notice info live-change" data-live-change>
        <p>Progress changed on another device.</p>
        <button
          type="button"
          class="btn"
          data-live-refresh
          :aria-disabled="refreshing || undefined"
          @click="refresh"
        >
          Refresh
        </button>
      </div>
    </div>
  </div>
</template>
