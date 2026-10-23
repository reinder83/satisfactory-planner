<!--
  "Mine only" (#1199, app/mine.ts) on the Factories page (under the toolbar) and in the build plan
  (under the checklist's tools): a switch that shows only the factories owned by "me" and their
  production lines, or their steps, and the name "me" goes by on this device. Both are view
  preferences remembered in this browser, never saved with the profile. It is drawn only while a
  factory of the open profile has an owner; without a name the switch is disabled and the line says
  to enter one. The note under it says what the switch hides, factories without an owner included,
  and on the Factories page that every factory shows while the factories are edited.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { factoryEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { anyOwner, meName, mineOnlyOn, setMineOnly } from '../../mine.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import MeName from '../MeName.vue';

const props = defineProps<{ where: 'factories' | 'plan' }>();

const view = computed(() =>
  legacy(() => {
    const me = meName(),
      on = mineOnlyOn(),
      editing = props.where === 'factories' && factoryEditing;
    return {
      shown: anyOwner(factoryGroupsState()),
      me,
      on,
      note: !me
        ? 'Enter your name as it is written in the factories’ Owner field to show only yours.'
        : !on
          ? ''
          : editing
            ? 'Every factory shows while you edit, so you can set its owner.'
            : props.where === 'factories'
              ? `Only the factories owned by ${me} show. Factories without an owner are hidden too.`
              : `Only the steps of production lines in factories owned by ${me} show. Steps in no factory, and in factories without an owner, are hidden too.`,
    };
  }),
);

function toggle(event: Event) {
  setMineOnly((event.target as HTMLInputElement).checked);
  render();
}
</script>

<template>
  <div v-if="view.shown" class="mine-bar" data-mine-bar>
    <label class="check-row small"
      ><input
        type="checkbox"
        data-mine-only
        :checked="view.on && !!view.me"
        :disabled="!view.me"
        :aria-describedby="view.note ? 'mine-note-' + where : undefined"
        @change="toggle"
      />Mine only</label
    ><MeName />
    <span v-if="view.note" :id="'mine-note-' + where" class="small muted" data-mine-note>{{
      view.note
    }}</span>
  </div>
</template>
