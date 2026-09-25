<!-- "Edit groups" / "Done editing" on the factories pages: shows or hides the group editor.
     View state only: nothing is saved. -->
<script setup lang="ts">
import { computed } from 'vue';
import { factoryEditing, setFactoryEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';

const editing = computed(() => legacy(() => factoryEditing));

function toggle() {
  setFactoryEditing(!factoryEditing);
  render();
}
</script>

<template>
  <button :class="['btn', editing ? 'primary' : '']" data-toggle-factory-edit @click="toggle">
    {{ editing ? 'Done editing' : 'Edit groups' }}
  </button>
</template>
