<!--
  Grouped unlocks on the build plan in expert mode (#1197, app/expert.ts, app/unlock-groups.ts):
  the phase's HUB milestones by tier and its MAM research, one fieldset per group. The group's own
  checkbox ("Tier 3 done", mixed while some are done) ticks every unlock of the group in the phase
  that is not ticked yet, the ones the search or Hide completed hide included, in one `checks`
  update through save(); once all are done it unticks them, and only them. That is exactly what
  ticking or unticking each item stores (runningChange in app/group-running.ts), so nothing new is
  stored and nothing is recalculated. The toast says what changed and offers Undo (Ctrl+Z or ⌘Z
  too), which puts each item back as it was. Each item keeps its own checkbox (the same `check`
  update as a step's, ui/actions.ts toggleCheck, with the step's toast and Undo) and its details:
  what it costs. Items stay in their group when ticked, so nothing moves under the pointer. All of
  it is native checkboxes and <details>, so Tab, Space and Enter work; focus stays on the control
  pressed, or goes to the next group's tick when Hide completed takes its group away.
-->
<script setup lang="ts">
import { save, toast } from '../../api.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { runningChange, undoUpdates, type RunningChange } from '../../group-running.ts';
import { currentProfile, currentSave, state } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  groupDoneLabel,
  groupTickNews,
  groupUndoNews,
  type UnlockGroupView,
} from '../../unlock-groups.ts';
import { toggleCheck } from '../actions.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import TermText from '../TermText.vue';
import StepTable from './StepTable.vue';
import { announceTick, tickNews } from './tick-hold.ts';

defineProps<{ groups: UnlockGroupView[] }>();

const groupRows = {
  row: '#main [data-unlock-group]',
  control: '[data-unlock-group-tick]',
  fallback: ['#plan-search'],
};

async function tickGroup(event: Event, group: UnlockGroupView) {
  const box = event.target as HTMLInputElement;
  const change = runningChange(group.keys, state.checks);
  if (!change || isBusy(box)) return;
  const profile = { save: currentSave.id, profile: currentProfile.id };
  const refocus = refocusAfterRemoval(box, groupRows);
  const saved = await whileBusy(box, async () => {
    try {
      await save({ type: 'checks', keys: change.keys, value: change.value });
      return true;
    } catch {
      return false;
    }
  });
  if (!saved) {
    // The box shows what is stored again.
    box.checked = group.done === group.keys.length;
    box.indeterminate = group.done > 0 && group.done < group.keys.length;
    return;
  }
  render();
  toast(groupTickNews(change, group.label), false, {
    label: 'Undo',
    run: () => void undo(change, group, profile),
  });
  await refocus();
}

// Undo, from the toast: only on the profile the tick changed, and only for the items that still
// have the value it gave them. Focus lost with the toast goes back to the group's tick.
async function undo(
  change: RunningChange,
  group: UnlockGroupView,
  profile: { save: string; profile: string },
) {
  if (currentSave.id !== profile.save || currentProfile.id !== profile.profile) return;
  const updates = undoUpdates(change, state.checks);
  try {
    for (const update of updates) await save(update);
  } catch {
    render();
    return;
  }
  render();
  const restored = updates.reduce((count, update) => count + update.keys.length, 0);
  toast(groupUndoNews(change, restored, group.label));
  const current = document.activeElement;
  if (current && current !== document.body && current.isConnected && !current.closest('#toast'))
    return;
  document
    .querySelector<HTMLElement>(`#main [data-unlock-group-tick="${CSS.escape(group.key)}"]`)
    ?.focus();
}

// One item's own checkbox: the step's checklist key, as on any step.
async function tickItem(event: Event, id: string, title: string) {
  const value = (event.target as HTMLInputElement).checked;
  if (!(await toggleCheck(event))) return;
  if (value) announceTick(id, title);
  else toast(tickNews(id, title, false));
}
</script>

<template>
  <section class="unlock-groups" data-unlock-groups aria-labelledby="unlock-groups-title">
    <h3 id="unlock-groups-title" class="unlock-groups-title">Unlocks by tier</h3>
    <fieldset
      v-for="group in groups"
      :key="group.key"
      class="unlock-group"
      :data-unlock-group="group.key"
    >
      <legend>
        <label class="check-row unlock-group-tick"
          ><input
            type="checkbox"
            :data-unlock-group-tick="group.key"
            :checked="group.done === group.keys.length"
            :indeterminate="group.done > 0 && group.done < group.keys.length"
            :aria-describedby="'unlock-group-count-' + group.key"
            @change="tickGroup($event, group)"
          />{{ groupDoneLabel(group.label) }}</label
        ><span
          :id="'unlock-group-count-' + group.key"
          class="small muted unlock-group-count"
          data-unlock-group-count
          >{{ group.done }} of {{ group.keys.length }} done</span
        >
      </legend>
      <ul class="unlock-items">
        <li
          v-for="item in group.items"
          :key="item.id"
          :class="['unlock-item', item.done ? 'is-done' : '']"
          :data-unlock-item="item.id"
        >
          <input
            type="checkbox"
            :data-check="item.id"
            :aria-label="'Complete: ' + item.title"
            :checked="item.done"
            @change="tickItem($event, item.id, item.title)"
          />
          <details>
            <summary>{{ item.title }}</summary>
            <StepTable v-if="item.table" :table="item.table" :terms="item.terms ?? []" />
            <p v-else-if="item.body"><TermText :text="item.body" :terms="item.terms ?? []" /></p>
          </details>
        </li>
      </ul>
    </fieldset>
  </section>
</template>
