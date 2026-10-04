<!-- "Edit groups" / "Done editing" on the factories pages: shows or hides the group editor.
     View state only: nothing is saved. Done waits while a "Made on site" choice is not saved
     (finishGroupEditing in ui/actions.ts, #930). -->
<script setup lang="ts">
import { computed } from 'vue';
import { factoryEditing, setFactoryEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import { finishGroupEditing } from '../actions.ts';

const editing = computed(() => legacy(() => factoryEditing));

function toggle() {
  if (factoryEditing) {
    finishGroupEditing();
    return;
  }
  setFactoryEditing(true);
  render();
}
</script>

<template>
  <button :class="['btn', editing ? 'primary' : '']" data-toggle-factory-edit @click="toggle">
    {{ editing ? 'Done editing' : 'Edit groups' }}
  </button>
</template>
