<!--
  #notes (SP-08, #243): every note of the open profile on one page. The save-wide note (key
  `global`) comes first, then one box per phase (key `phase-<phase>`): the working phase first
  and open, then the profile's other phases in order, folded. A phase before the profile's
  start phase is listed too when it holds a note (a profile carried from a sibling copies its
  notes as they are), so no saved note is out of sight. Every box is NoteBox.vue and saves
  itself as you type; all of them stay mounted while folded, so allowSwitch() still sends or
  asks about each one before the page goes away. The keys are saved progress and do not change.
  Last, on a profile moved from the original plan, what that move could not place (#499).
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
import UnplacedRecords from '../notes/UnplacedRecords.vue';

const ALL: Phase[] = ['1', '2', '3', '4', '5', 'post'];

const page = computed(() =>
  legacy(() => {
    const current = phase();
    const offered = phaseOptions();
    const notes = state.notes || {};
    const has = (listedPhase: Phase) => !!notes['phase-' + listedPhase]?.trim();
    const listed = ALL.filter(p => offered.includes(p) || has(p));
    return {
      saveName: currentSave.name,
      profileName: currentProfile.name,
      phases: [current, ...listed.filter(p => p !== current)].map(listedPhase => ({
        phase: listedPhase,
        label: phaseLabel(listedPhase),
        current: listedPhase === current,
        tag:
          listedPhase === current
            ? 'Working on'
            : !offered.includes(listedPhase)
              ? 'Before this profile'
              : has(listedPhase)
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
      v-for="entry in page.phases"
      :key="entry.phase"
      class="panel phase-notes"
      :open="entry.current || undefined"
      :data-phase-notes="entry.phase"
    >
      <summary>
        {{ entry.label }} <span class="small muted">· {{ entry.tag }}</span>
      </summary>
      <NoteBox
        :id="'phase-note-' + entry.phase"
        :note-key="'phase-' + entry.phase"
        :aria-label="entry.label + ' notes'"
      />
    </details>
  </section>
  <UnplacedRecords />
</template>
