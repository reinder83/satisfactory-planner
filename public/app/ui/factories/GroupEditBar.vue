<!-- The sticky "Editing factories · Done editing" bar (ui/EditBar.vue, SP-13) while the factories
     pages' groups are edited; Done does what EditGroupsToggle's Done does, waiting while a
     "Made on site" choice is not saved (finishGroupEditing in ui/actions.ts, #930). -->
<script setup lang="ts">
import { computed } from 'vue';
import { factoryEditing } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { finishGroupEditing } from '../actions.ts';
import EditBar from '../EditBar.vue';

const editing = computed(() => legacy(() => factoryEditing));
</script>

<template>
  <EditBar
    v-if="editing"
    label="Editing factories"
    toggle="[data-toggle-factory-edit]"
    :done="finishGroupEditing"
  />
</template>
