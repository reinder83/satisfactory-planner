<!-- The contents of #detail for a component dialog (ui/detail.js): `target` is { kind, id }. -->
<script setup>
import CalcFactoryDialog from './CalcFactoryDialog.vue';
import FactoryDialog from './FactoryDialog.vue';
import GroupChainDialog from './GroupChainDialog.vue';
import SlotDialog from './SlotDialog.vue';

defineProps({ target: { type: Object, required: true } });
</script>

<template>
  <FactoryDialog v-if="target.kind === 'factory'" :id="target.id" />
  <CalcFactoryDialog v-else-if="target.kind === 'calc'" :id="target.id" />
  <GroupChainDialog v-else-if="target.kind === 'group'" :id="target.id" />
  <SlotDialog v-else-if="target.kind === 'slot'" :id="target.id" />
</template>
