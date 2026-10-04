<!--
  What the move from the original plan could not place (#499, part 4e of #395): a profile
  migrated from it carries `handbookOrigin.unmapped` (public/handbook-migration.ts) with the
  ticks, notes and group assignments that have no place in its calculated plan, such as the
  Plastic and Rubber campus ticks (decision 6B). This lists each one as text, for review, on the
  Notes page. It only reads: the section is kept for good and nothing here changes or deletes it.
  It draws nothing when the section is empty or absent. The copy says the entries came from the
  original plan and never says "handbook" (decision 8).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { state } from '../../session.ts';
import type { GroupAssignment } from '../../../types/index.ts';
import { legacy } from '../bridge.ts';

interface Entry {
  key: string;
  what: string;
  value: string;
}

// A factory's Running tick on the original plan is `factory-<phase>-<factory id>`. One the
// migration moved onto a line that already held a tick is kept as `moved-calc-<phase>-<row>`.
function checkLabel(key: string): string {
  const factory = /^factory-([345])-(.+)$/.exec(key);
  if (factory) return `${factory[2]}, Phase ${factory[1]}`;
  const moved = /^moved-calc-([345])-(.+)$/.exec(key);
  if (moved) return `${moved[2]}, Phase ${moved[1]} (this line already had its own tick)`;
  return key;
}

// A factory's note is `factory-<factory id>`.
const noteLabel = (key: string) => (key.startsWith('factory-') ? key.slice(8) : key);

// "Oil campus · 30/min, Rubber" from a factory's group shares; a group removed since keeps its id.
function groupsText(list: GroupAssignment[]): string {
  const groups = state.factoryGroups?.groups || [];
  return list
    .map(share => {
      const name = groups.find(g => g.id === share.group)?.name ?? share.group;
      return share.rate == null ? name : `${name} · ${num(share.rate)}/min`;
    })
    .join(', ');
}

const records = computed(() =>
  legacy(() => {
    const unmapped = state.handbookOrigin?.unmapped;
    const checks: Entry[] = Object.entries(unmapped?.checks || {}).map(([key, ticked]) => ({
      key,
      what: checkLabel(key),
      value: ticked ? 'Ticked' : 'Not ticked',
    }));
    const notes: Entry[] = Object.entries(unmapped?.notes || {}).map(([key, text]) => ({
      key,
      what: noteLabel(key),
      value: text,
    }));
    const assignments: Entry[] = Object.entries(unmapped?.assignments || {}).map(([key, list]) => ({
      key,
      what: key,
      value: groupsText(list) || 'No factory',
    }));
    const count = checks.length + notes.length + assignments.length;
    return count ? { checks, notes, assignments } : null;
  }),
);
</script>

<template>
  <section v-if="records" class="panel unplaced" data-unplaced aria-labelledby="unplaced-title">
    <h2 id="unplaced-title">From the original plan</h2>
    <p class="small muted">
      These records came from the original plan and have no place in this one. They are kept here as
      they were, for you to review; nothing on this list is deleted.
    </p>
    <template v-if="records.checks.length">
      <h3>Ticks</h3>
      <ul class="unplaced-list">
        <li v-for="entry in records.checks" :key="entry.key" :data-unplaced-check="entry.key">
          <span class="unplaced-what">{{ entry.what }}</span>
          <span class="small muted">· {{ entry.value }}</span>
        </li>
      </ul>
    </template>
    <template v-if="records.notes.length">
      <h3>Notes</h3>
      <ul class="unplaced-list">
        <li v-for="entry in records.notes" :key="entry.key" :data-unplaced-note="entry.key">
          <span class="unplaced-what">{{ entry.what }}</span>
          <span class="unplaced-note">{{ entry.value }}</span>
        </li>
      </ul>
    </template>
    <template v-if="records.assignments.length">
      <h3>Factories</h3>
      <ul class="unplaced-list">
        <li
          v-for="entry in records.assignments"
          :key="entry.key"
          :data-unplaced-assignment="entry.key"
        >
          <span class="unplaced-what">{{ entry.what }}</span>
          <span class="small muted">· {{ entry.value }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
