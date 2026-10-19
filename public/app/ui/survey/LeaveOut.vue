<!--
  "Leave nodes out of this plan" (#1183) under a counting screen of the node survey: folded
  unless the survey already leaves some of these resources' nodes out when the screen opens, and
  inside, a CountTable in its leaveOut mode per table, the counted resources only. readExtraction
  in wizard/extraction.ts reads the counts into the survey's excludedNodes and excludedWells,
  within the counts beside them.
-->
<script setup lang="ts">
import { wizard } from '../../session.ts';
import { extractionOf } from '../../wizard/extraction.ts';
import HelpTip from '../form/HelpTip.vue';
import CountTable from './CountTable.vue';

const props = defineProps<{
  tables: { kind: 'node' | 'well'; names: string[]; heading?: string }[];
}>();

// Open when the screen opens with some of its nodes left out, so they are never out of sight;
// after that the user folds and unfolds it.
const survey = wizard ? extractionOf(wizard) : null;
const startOpen = props.tables.some(table =>
  table.names.some(
    name => !!(table.kind === 'well' ? survey?.excludedWells : survey?.excludedNodes)?.[name],
  ),
);
</script>

<template>
  <details class="leave-out" data-leave-out :open="startOpen">
    <summary>Leave nodes out of this plan</summary>
    <p class="small">
      For a node too far from where you build, or one already feeding a factory this plan does not
      include. The plan never taps a node you leave out: its budgets and the build plan's "Tap the
      resource nodes" use only the others.
      <HelpTip name="extractionLeftOut" />
    </p>
    <template v-for="table in tables" :key="table.kind + table.names.join()">
      <h4 v-if="table.heading" class="leave-out-heading">{{ table.heading }}</h4>
      <CountTable :kind="table.kind" :names="table.names" leave-out />
    </template>
  </details>
</template>
