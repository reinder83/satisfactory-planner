<!--
  #notes (SP-08, #243): every note of the open profile on one page. The save-wide note (key
  `global`) comes first, then one box per phase (key `phase-<phase>`): the working phase first
  and open, then the profile's other phases in order, folded. A phase before the profile's
  start phase is listed too when it holds a note (a profile carried from a sibling copies its
  notes as they are), so no saved note is out of sight. Every box is NoteBox.vue and saves
  itself as you type; all of them stay mounted while folded, so allowSwitch() still sends or
  asks about each one before the page goes away. The keys are saved progress and do not change.
-->
<script setup lang="ts">
import { computed } from 'vue';
import {
  currentProfile,
  currentSave,
  phase,
  phaseLabel,
  phaseOptions,
  state,
} from '../../session.ts';
import type { Phase } from '../../../types/index.ts';
import { legacy } from '../bridge.ts';
import NoteBox from '../NoteBox.vue';
import PageHeader from '../PageHeader.vue';

const ALL: Phase[] = ['1', '2', '3', '4', '5', 'post'];

const page = computed(() =>
  legacy(() => {
    const current = phase();
    const offered = phaseOptions();
    const notes = state.notes || {};
    const has = (p: Phase) => !!notes['phase-' + p]?.trim();
    const listed = ALL.filter(p => offered.includes(p) || has(p));
    return {
      saveName: currentSave.name,
      profileName: currentProfile.name,
      phases: [current, ...listed.filter(p => p !== current)].map(p => ({
        phase: p,
        label: phaseLabel(p),
        current: p === current,
        tag:
          p === current
            ? 'Working on'
            : !offered.includes(p)
              ? 'Before this profile'
              : has(p)
                ? 'Has notes'
                : 'Empty',
      })),
    };
  }),
);
</script>

<template>
  <PageHeader
    eyebrow="THIS PROFILE"
    title="Notes"
    :subtitle="'Notes save as you type. They belong to ' + page.saveName + ' / ' + page.profileName"
  />
  <section class="panel">
    <h2>Save-wide notes</h2>
    <NoteBox
      id="global-note"
      note-key="global"
      label="Seed, locations, routes and decisions."
      aria-label="Save-wide notes"
    />
  </section>
  <section class="notes-phases">
    <div class="section-head">
      <h2>Phase notes</h2>
    </div>
    <p class="small muted">Locations, train routes, things to check on your next session.</p>
    <details
      v-for="p in page.phases"
      :key="p.phase"
      class="panel phase-notes"
      :open="p.current || undefined"
      :data-phase-notes="p.phase"
    >
      <summary>
        {{ p.label }} <span class="small muted">· {{ p.tag }}</span>
      </summary>
      <NoteBox
        :id="'phase-note-' + p.phase"
        :note-key="'phase-' + p.phase"
        :aria-label="p.label + ' notes'"
      />
    </details>
  </section>
</template>
