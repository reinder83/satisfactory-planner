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
import { factoryGroupsState, groupFolded, setGroupFolded } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { revealSection } from './reveal.ts';

const props = defineProps<{ sectionKey: string; label: string }>();

// A factory folds by groupFolded (not started ones, one open while editing); a shared site by its
// remembered choice alone.
const isFactory = () => factoryGroupsState().groups.some(group => group.id === props.sectionKey);
const open = computed(() =>
  legacy(() => !(isFactory() ? groupFolded(props.sectionKey) : sectionCollapsed(props.sectionKey))),
);

async function toggle(event: Event) {
  const section = (event.currentTarget as HTMLElement).closest('.site-group');
  if (!open.value) {
    // Unfolding while editing switches the open factory (reveal.ts holds an unsaved choice).
    if (isFactory()) await revealSection(props.sectionKey);
    else {
      setSectionCollapsed(props.sectionKey, false);
      render();
    }
    return;
  }
  if (section && holdUnsavedChoices(section)) return;
  if (isFactory()) setGroupFolded(props.sectionKey, true);
  else setSectionCollapsed(props.sectionKey, true);
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
