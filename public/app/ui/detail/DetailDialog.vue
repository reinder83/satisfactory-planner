<!-- The contents of #detail for a component dialog (ui/detail.ts): `target` is { kind, id }. -->
<script setup lang="ts">
import AltRecipeDialog from './AltRecipeDialog.vue';
import CalcFactoryDialog from './CalcFactoryDialog.vue';
import GroupChainDialog from './GroupChainDialog.vue';
import SlotDialog from './SlotDialog.vue';
import type { DetailTarget } from '../detail.ts';

defineProps<{ target: DetailTarget }>();
</script>

<template>
  <CalcFactoryDialog v-if="target.kind === 'calc'" :id="target.id" />
  <GroupChainDialog v-else-if="target.kind === 'group'" :id="target.id" />
  <SlotDialog v-else-if="target.kind === 'slot'" :id="target.id" />
  <AltRecipeDialog v-else-if="target.kind === 'alt'" :id="target.id" />
</template>
