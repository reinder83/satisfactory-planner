<!-- The ⓘ for a setting: ui/HelpPopover.vue with the setting's help text (`helpText[name]`,
     preferences/help.ts), or nothing when there is none. It is the same popup as a glossary term's
     and a "?" button's (X-3, #1333); this only names the topic from the setting's key. -->
<script setup lang="ts">
import { computed } from 'vue';
import HelpPopover from '../HelpPopover.vue';

// `topic` is the visible text the ⓘ belongs to (the field's label, the heading), so the button's
// name is "Help: Phase caps", the words on screen (#1355). Without one it is made from the key.
const props = defineProps<{ name: string; topic?: string }>();
// "phaseCaps" -> "phase caps".
const topic = computed(() => props.topic || props.name.replace(/([A-Z])/g, ' $1').toLowerCase());
</script>

<template>
  <HelpPopover :name="name" :topic="topic" glyph="ⓘ" />
</template>
