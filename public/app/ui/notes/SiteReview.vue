<!--
  Ticks a recalculation kept for review because of lines made on site (#876): a new profile's
  `onSiteReview` (newProfileState in public/state/carry.ts) holds the ticks of a central line the
  new plan split into factory groups' own lines, and of a group's own line the new plan no longer
  has, since neither has one line to land on. This lists each one on the Notes page, with where
  its machines are in the plan now (siteReviewEntries in app/on-site.ts). It only reads: the
  section is kept for good and nothing here changes or deletes it. It draws nothing when there is
  none. It shares the layout of UnplacedRecords.vue.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { siteReviewEntries } from '../../on-site.ts';
import { calculated, state } from '../../session.ts';
import { legacy } from '../bridge.ts';

const entries = computed(() =>
  legacy(() => siteReviewEntries(state.onSiteReview?.checks, calculated, state.factoryGroups)),
);
</script>

<template>
  <section
    v-if="entries.length"
    class="panel unplaced"
    data-site-review
    aria-labelledby="site-review-title"
  >
    <h2 id="site-review-title">Ticks kept for review</h2>
    <p class="small muted">
      When this plan was calculated, these lines were ticked in the profile it came from. Their
      machines are now split differently between the factory groups' own lines and the central
      lines, so the ticks were not moved to any one line. Tick the lines that stand in your world;
      nothing on this list is deleted.
    </p>
    <ul class="unplaced-list">
      <li v-for="entry in entries" :key="entry.key" :data-site-review-check="entry.key">
        <span class="unplaced-what">{{ entry.what }}</span>
        <span class="small muted">
          · {{ entry.ticked ? 'Ticked' : 'Not ticked'
          }}{{ entry.now ? ' · ' + entry.now : '' }}</span
        >
      </li>
    </ul>
  </section>
</template>
