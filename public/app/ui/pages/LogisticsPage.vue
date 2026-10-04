<!--
  #logistics (#229): what moves between a calculated profile's factory groups in the current
  phase, and by which belt, pipe or vehicle (GroupLinks.vue, which used to sit at the foot of the
  calculated factories page). A phase without production lines, or a profile without groups, has
  nothing between them yet: each gets a short explanation with the way forward instead of an
  empty page. With no calculated plan open (only while render() swaps the page after leaving a
  profile) it draws its header alone.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage, calculated, phaseLabel, phase } from '../../session.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import GroupLinks from '../factories/GroupLinks.vue';
import PageHeader from '../PageHeader.vue';

const page = computed(() =>
  legacy(() => ({
    calculated: !!calculated,
    rows: !!calcStage()?.rows?.length,
    groups: calculated ? factoryGroupsState().groups.length : 0,
    phase: phaseLabel(phase()),
  })),
);
</script>

<template>
  <PageHeader
    eyebrow="BETWEEN FACTORIES"
    title="Logistics"
    :subtitle="
      page.calculated
        ? `What each factory sends the others in ${page.phase}, and the belts, pipes or vehicles it takes.`
        : ''
    "
  />
  <template v-if="!page.calculated" />
  <div v-else-if="!page.rows" class="notice info" data-logistics-empty="phase">
    This phase has no production lines, so nothing moves between factories yet.
  </div>
  <div v-else-if="!page.groups" class="notice info" data-logistics-empty="groups">
    Nothing to show until the production lines are in factories.
    <a href="#factories">Sort them into factories on the Factories page</a>, and what each factory
    sends the others appears here.
  </div>
  <GroupLinks v-else />
</template>
