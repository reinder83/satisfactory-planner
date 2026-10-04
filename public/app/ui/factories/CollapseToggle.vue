<!--
  The fold button at the start of a group's or shared site's header on the factories pages
  (SP-17, #252). It shows or hides the section's cards (`cards-<key>`, aria-controls) and says
  which through aria-expanded; its name stays the same either way. The choice is remembered per
  section of this profile in this browser (sectionCollapsed in session.ts), never saved with the
  profile. A folded section still counts in the status chips, the jump bar and the page's total.
  Folding takes a group's "Made on site" picker away while groups are edited, so a group whose
  picker shows a choice not saved yet stays open, and the picker says so and offers Save and
  Discard (holdUnsavedChoices in api.ts, #930).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { holdUnsavedChoices } from '../../api.ts';
import { sectionCollapsed, setSectionCollapsed } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';

const props = defineProps<{ sectionKey: string; label: string }>();

const open = computed(() => legacy(() => !sectionCollapsed(props.sectionKey)));

function toggle(event: Event) {
  const section = (event.currentTarget as HTMLElement).closest('.site-group');
  if (open.value && section && holdUnsavedChoices(section)) return;
  setSectionCollapsed(props.sectionKey, open.value);
  render();
}
</script>

<template>
  <button
    type="button"
    class="btn collapse-toggle"
    :aria-expanded="open"
    :aria-controls="'cards-' + sectionKey"
    :aria-label="label"
    :data-collapse="sectionKey"
    @click="toggle"
  >
    <span aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
  </button>
</template>
