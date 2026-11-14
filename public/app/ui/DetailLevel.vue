<!--
  The detail level control (ONB-2, #1337, app/detail-level.ts): "Detail level" with Beginner,
  Standard and Expert as one segmented row, the same on the guided start's first screen, above All
  settings' steps and on the build plan's tools (BP-12: a setting, apart from the plan's filters).
  It is a radio group of native radio buttons, so Tab reaches the chosen level, the arrow keys
  move to another and pick it, and a screen reader reads the group's name and "1 of 3". `name`
  keeps each page's group apart; `describedby` names the note under it that says what the level
  does. `pick` reports a new level with the form it is in and `restore`, which shows the level the
  page has again: a page whose save is refused calls it, since the props have not changed.
-->
<script setup lang="ts">
import { DETAIL_LABELS } from '../detail-level.ts';
import type { DetailLevel } from '../../types/index.ts';

const props = defineProps<{ level: DetailLevel; name: string; describedby?: string }>();
const emit = defineEmits<{
  pick: [level: DetailLevel, form: HTMLFormElement | null, restore: () => void];
}>();
const labelId = `${props.name}-label`;

function changed(event: Event) {
  const input = event.target as HTMLInputElement;
  const group = input.closest('[data-detail-level]');
  const restore = () =>
    group
      ?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
      .forEach(radio => (radio.checked = radio.value === props.level));
  const level = DETAIL_LABELS.find(([value]) => value === input.value)?.[0];
  if (input.checked && level && level !== props.level) emit('pick', level, input.form, restore);
}
</script>

<template>
  <div
    class="detail-level"
    role="radiogroup"
    :aria-labelledby="labelId"
    :aria-describedby="describedby"
    data-detail-level
  >
    <span :id="labelId" class="detail-level-label">Detail level</span
    ><label v-for="[value, text] in DETAIL_LABELS" :key="value" class="detail-level-option"
      ><input
        type="radio"
        :name="name"
        :value="value"
        :checked="value === level"
        :data-detail-option="value"
        @change="changed"
      /><span>{{ text }}</span></label
    >
  </div>
</template>
