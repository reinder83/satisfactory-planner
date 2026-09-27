<!--
  #logistics (#229): what moves between a calculated profile's factory groups in the current
  phase, and by which belt, pipe or vehicle (GroupLinks.vue, which used to sit at the foot of the
  calculated factories page). The handbook profile has no calculated plan to work from, and a
  calculated one without groups has nothing between them yet: each gets a short explanation with
  the way forward instead of an empty page.
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
    eyebrow="BETWEEN FACTORY GROUPS"
    title="Logistics"
    :subtitle="
      page.calculated
        ? `What each factory group sends the others in ${page.phase}, and the belts, pipes or vehicles it takes.`
        : ''
    "
  />
  <div v-if="!page.calculated" class="notice info" data-logistics-empty="handbook">
    Logistics works from a calculated plan's factory groups: what each group sends the others, by
    belt, pipe or vehicle. The handbook profile has no calculated plan.
    <a href="#profiles">Create or open a calculated profile</a> under Saves &amp; profiles.
  </div>
  <div v-else-if="!page.rows" class="notice info" data-logistics-empty="phase">
    This phase has no production lines, so nothing moves between groups yet.
  </div>
  <div v-else-if="!page.groups" class="notice info" data-logistics-empty="groups">
    Nothing to show until the factories are in groups.
    <a href="#factories">Group them on the Factories page</a>, and what each group sends the others
    appears here.
  </div>
  <GroupLinks v-else />
</template>
