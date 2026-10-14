<!--
  "Mark all running" in a factory's header on the Factories page (#1163): one press marks every
  production line of the factory running in the phase shown, the lines the search or the status
  chips hide included, and once all of them run the same button offers the reverse, "Mark all not
  running". It writes the Running boxes' own `calc-<phase>-<row id>` checks in one `checks` update
  through save(), leaves a line already marked as it is, and recalculates nothing
  (app/group-running.ts). The toast says how many lines changed, with Undo (Ctrl+Z or ⌘Z too,
  toastShortcut in api.ts), which puts those lines back as they were. The button is one element
  whatever it says, busy while it saves (app/busy.ts), so focus stays on it; when the chips then
  hide the factory, focus goes to the next factory's button (ui/refocus.ts).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { save, toast } from '../../api.ts';
import { calcStage, currentProfile, currentSave, stage, state } from '../../session.ts';
import { render } from '../../shell.ts';
import { membershipsOf } from '../../views/factories.ts';
import {
  groupRunningKeys,
  runningAction,
  runningChange,
  runningNews,
  undoNews,
  undoUpdates,
  type RunningChange,
} from '../../group-running.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { legacy } from '../bridge.ts';
import { refocusAfterRemoval } from '../refocus.ts';

const props = defineProps<{ groupId: string; groupName: string }>();

const view = computed(() =>
  legacy(() => {
    const keys = groupRunningKeys(calcStage()?.rows || [], props.groupId, membershipsOf, stage());
    const change = runningChange(keys, state.checks);
    return change && { change, ...runningAction(change, props.groupName) };
  }),
);

async function apply(event: Event) {
  const trigger = event.currentTarget as HTMLButtonElement;
  const shown = view.value;
  if (!shown || isBusy(trigger)) return;
  const { change } = shown,
    name = props.groupName,
    groupId = props.groupId,
    profile = { save: currentSave.id, profile: currentProfile.id };
  const refocus = refocusAfterRemoval(trigger, {
    row: '#main .user-group',
    control: '[data-group-running]',
    fallback: ['#factory-search'],
  });
  const saved = await whileBusy(trigger, async () => {
    try {
      await save({ type: 'checks', keys: change.keys, value: change.value });
      return true;
    } catch {
      return false;
    }
  });
  if (!saved) return;
  render();
  toast(runningNews(change, name), false, {
    label: 'Undo',
    run: () => void undo(change, name, groupId, profile),
  });
  await refocus();
}

// Undo, from the toast: only on the profile the press changed, and only for the lines that still
// have the value it gave them. Focus lost with the toast goes back to the factory's button.
async function undo(
  change: RunningChange,
  name: string,
  groupId: string,
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
  toast(undoNews(change, restored, name));
  const current = document.activeElement;
  if (current && current !== document.body && current.isConnected && !current.closest('#toast'))
    return;
  document
    .querySelector<HTMLElement>(`#main [data-group-running="${CSS.escape(groupId)}"]`)
    ?.focus();
}
</script>

<template>
  <button
    v-if="view"
    type="button"
    class="btn"
    :data-group-running="groupId"
    :data-running-value="String(view.change.value)"
    :aria-label="view.aria"
    @click="apply"
  >
    {{ view.label }}
  </button>
</template>
