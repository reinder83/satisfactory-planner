<!--
  The notes left on steps and factories (BAK-3, #1355: ui/notes/ItemNote.vue, keys `step-<id>` and
  `group-<id>`), listed on the Notes page so a note is never out of sight, each with the step's
  title and phase or the factory's name, and a link to where it was left. A note whose step or
  factory is no longer in the profile (a recalculation or Remove) says so and stays editable, so
  its text can be copied or cleared; nothing is dropped. A box stays listed while its text is
  cleared, until the page is left, so emptying it does not take it from under the cursor.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Phase } from '../../../types/index.ts';
import { flowRoute, phaseLabel, state } from '../../session.ts';
import { planTasks } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import NoteBox from '../NoteBox.vue';

const ALL: Phase[] = ['1', '2', '3', '4', '5', 'post'];

// The keys that hold a note now, in a stable order.
const keys = computed(() =>
  legacy(() =>
    Object.entries(state.notes ?? {})
      .filter(([key, text]) => /^(step|group)-/.test(key) && text.trim())
      .map(([key]) => key)
      .sort(),
  ),
);
const known = ref<string[]>([...keys.value]);
watch(keys, now => {
  for (const key of now) if (!known.value.includes(key)) known.value = [...known.value, key].sort();
});

const items = computed(() =>
  legacy(() => {
    const groups = state.factoryGroups?.groups ?? [];
    const steps = new Map<string, { title: string; phase: Phase }>();
    if (known.value.some(key => key.startsWith('step-')))
      for (const phase of ALL) {
        try {
          for (const step of planTasks(phase))
            if (!steps.has(step.id)) steps.set(step.id, { title: step.title, phase });
        } catch {}
      }
    return known.value.map(key => {
      if (key.startsWith('group-')) {
        const group = groups.find(entry => 'group-' + entry.id === key);
        return {
          key,
          title: group ? group.name : 'A factory no longer in this profile',
          where: group ? 'Factory' : 'Removed',
          href: group ? '#' + flowRoute(group.id) : '',
        };
      }
      const step = steps.get(key.slice(5));
      return {
        key,
        title: step ? step.title : 'A step no longer in this plan',
        where: step ? phaseLabel(step.phase) : 'Removed',
        href: '',
      };
    });
  }),
);
</script>

<template>
  <section v-if="items.length" class="notes-items" data-item-notes>
    <div class="section-head">
      <h2>Step and factory notes</h2>
    </div>
    <p class="small muted">
      Notes left on a step in the build plan, or on a factory's build order page.
    </p>
    <details
      v-for="item in items"
      :key="item.key"
      class="panel phase-notes"
      :data-item-note-for="item.key"
    >
      <summary>
        {{ item.title }} <span class="small muted">· {{ item.where }}</span>
      </summary>
      <NoteBox :id="'notes-' + item.key" :note-key="item.key" :aria-label="'Note: ' + item.title" />
      <p v-if="item.href" class="small">
        <a :href="item.href">Open this factory →</a>
      </p>
    </details>
  </section>
</template>
