<!-- The sticky "Editing groups · Done editing" bar (ui/EditBar.vue, SP-13) while the factories
     pages' groups are edited; Done does what EditGroupsToggle's Done does. -->
<script setup lang="ts">
import { computed } from 'vue';
import { factoryEditing, setFactoryEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import EditBar from '../EditBar.vue';

const editing = computed(() => legacy(() => factoryEditing));

function done() {
  setFactoryEditing(false);
  render();
}
</script>

<template>
  <EditBar v-if="editing" label="Editing groups" toggle="[data-toggle-factory-edit]" :done="done" />
</template>
