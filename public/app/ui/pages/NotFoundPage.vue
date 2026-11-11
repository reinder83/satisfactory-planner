<!--
  The page an address that names no page opens (#1330): #nowhere, a mistyped link, an old
  bookmark. It used to open the build plan without a word, so a typo looked like the plan having
  lost its steps. This says so, in ADA's voice, and offers the two places to go: Build plan and
  Saves & profiles. viewOf() in session.ts picks it; the bare address still opens the plan.
-->
<script setup lang="ts">
import PageHeader from '../PageHeader.vue';
</script>

<template>
  <PageHeader
    eyebrow="NOT FOUND"
    title="Page not found"
    subtitle="This address does not lead to a page of the planner."
  />
  <section class="panel not-found" data-not-found>
    <p class="not-found-ada"><strong>ADA:</strong> “That sector is not on any FICSIT map.”</p>
    <p>Your saves and progress are untouched. Pick up where you were:</p>
    <p class="not-found-links">
      <a class="btn primary" href="#plan" data-not-found-plan>Build plan</a>
      <a class="btn" href="#profiles" data-not-found-profiles>Saves &amp; profiles</a>
    </p>
  </section>
</template>
