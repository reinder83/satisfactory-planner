<!--
  Above every page (#1052): when the user opened another save or profile in another tab or on
  another device (the workspace's active save and profile, groupMoved in app/session.ts) while
  this tab shows another, a warning says where the others went and that this tab stays where it
  is, with everything changed here saved to the profile it shows. "Open …" follows them (the
  usual open path, openProfile in ui/actions.ts); "Stay on …" keeps this tab where it is and is
  not asked about that move again. The live region is always there, so the notice is announced
  when it appears.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { currentProfile, groupMoved, stayOnTabProfile } from '../session.ts';
import { openProfile } from './actions.ts';
import { invalidate, legacy } from './bridge.ts';
import { refocusOnOpenedPage } from './refocus.ts';

const moved = computed(() =>
  legacy(() => {
    const where = groupMoved();
    if (!where) return null;
    const place = `“${where.profileName}”` + (where.otherSave ? ` in “${where.saveName}”` : '');
    return {
      ...where,
      title: `Another tab or player moved to ${place}.`,
      here: currentProfile.name,
    };
  }),
);
// "Open …" is busy (aria-disabled, app/busy.ts) while the profile opens.
const opening = ref(false);
function follow() {
  const where = moved.value;
  if (!where || opening.value) return;
  return openProfile(where.saveId, where.profileId, on => (opening.value = on));
}
// The notice goes with its buttons, so focus goes to the page's heading.
async function stay(event: Event) {
  const refocus = refocusOnOpenedPage(event.currentTarget);
  stayOnTabProfile();
  invalidate();
  await refocus();
}
</script>

<template>
  <div class="group-moved-live" role="status" aria-live="polite">
    <div v-if="moved" class="group-moved-wrap">
      <div class="notice warn group-moved" data-group-moved>
        <p>
          <strong>{{ moved.title }}</strong>
          This tab stays on “{{ moved.here }}”, and what you change here is saved to “{{
            moved.here
          }}”.
        </p>
        <div class="group-moved-actions">
          <button
            type="button"
            class="btn primary"
            data-group-follow
            :aria-disabled="opening || undefined"
            @click="follow"
          >
            Open “{{ moved.profileName }}”
          </button>
          <button type="button" class="btn" data-group-stay @click="stay">
            Stay on “{{ moved.here }}”
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
