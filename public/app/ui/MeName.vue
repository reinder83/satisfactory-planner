<!--
  "Your name" (#1199, app/mine.ts): the name this device's player goes by, a view preference
  remembered in this browser, never saved with the profile. "Mine only" compares it with the
  factories' owners, and every tick saved from here records it (#1206). The field sits in the
  "Mine only" bar (ui/factories/MineOnly.vue) and in the Backup page's "Co-op progress"
  (ui/backup/ProgressMerge.vue, #1214), so it can be set before any factory has an owner. It is
  committed on change (Enter or leaving the field), trimmed; a blank one forgets the name.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { render } from '../shell.ts';
import { meName, setMeName } from '../mine.ts';
import { OWNER_MAX } from '../../state.ts';

defineProps<{ describedBy?: string }>();

// What is typed in the name field until it is committed.
const typed = ref(meName());

function commitName(event: Event) {
  setMeName((event.target as HTMLInputElement).value);
  typed.value = meName();
  render();
}
</script>

<template>
  <label class="mine-name small"
    >Your name<input
      data-me-name
      :maxlength="OWNER_MAX"
      placeholder="e.g. Anna"
      autocomplete="nickname"
      :aria-describedby="describedBy"
      :value="typed"
      @input="typed = ($event.target as HTMLInputElement).value"
      @change="commitName"
  /></label>
</template>
