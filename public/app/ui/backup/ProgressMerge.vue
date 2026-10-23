<!--
  "Co-op progress" on the Backup page, in both editions (#1160, the first slice of #1077):
  "Export ticks" downloads the open profile's ticked step ids as a small file, and "Merge progress
  from file…" reads such a file (or a progress backup, or a save export holding one profile),
  shows what merging it would tick, per phase, with the steps ticked already and the ids this plan
  does not list, and ticks those steps only after Merge, with the file's records of who ticked
  them and when (#1206). A merge never unticks anything and never recalculates: the rules are in app/progress-merge.ts; this component hands it the open profile's
  ticks and step ids and sends the merge through save(), as every tick is saved.
-->
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { transferImportLimit } from '../../../transfer.ts';
import { downloadJson, save, toast, writeQueue } from '../../api.ts';
import { generatedStepIds } from '../../opening-phase.ts';
import {
  mergeChunks,
  mergedMessage,
  mergePreview,
  mergeUpdate,
  mergeQuestion,
  NOT_PROGRESS,
  nothingToMerge,
  readProgressFile,
  ticksExport,
  ticksFileName,
  type MergeGroup,
} from '../../progress-merge.ts';
import {
  calculated,
  currentProfile,
  currentSave,
  phaseLabel,
  phaseOptions,
  setMergedProgress,
  state,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { slotKeys, storageBays } from '../../views/storage.ts';
import { confirmAction } from '../confirm.ts';

const exporting = ref(false);
const merging = ref(false);
// "Merge progress from file…" opens this input, kept out of sight and out of the tab order, as
// "Import saves…" does (#307).
const mergeInput = ref<HTMLInputElement>();

// The ADA line about a merge belongs to this visit of the page.
onBeforeUnmount(() => setMergedProgress(null));

// "Export ticks": after the queued saves, the open profile's ticked steps as a file.
async function exportTicks() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await writeQueue;
    const data = ticksExport(
      state.checks,
      currentSave.name,
      currentProfile.name,
      new Date(),
      state.tickedBy,
    );
    downloadJson(data, ticksFileName(currentProfile.name));
    toast(`Ticks exported: ${data.ticks.length} ticked step${data.ticks.length === 1 ? '' : 's'}.`);
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    exporting.value = false;
  }
}

// What a merge may tick in the open profile: each phase's build-plan steps as the phase picker
// offers them (generated steps, removed ones included, since a removed step keeps its tick, and
// the personal tasks), then the storage room's container steps, then a plan guide's own checklists
// (a profile moved from the original plan, #470: its power, storage tasks and completion).
function mergeGroups(): MergeGroup[] {
  const phases = phaseOptions().map(phase => ({
    label: phaseLabel(phase),
    unit: 'step',
    ids: [
      ...generatedStepIds(phase),
      ...state.customTasks.filter(task => task.phase === phase).map(task => task.id),
    ],
  }));
  const containers = storageBays().flatMap(bay =>
    bay.items.filter(position => position.name).flatMap(position => slotKeys(position.id)),
  );
  const guide = calculated?.guide;
  const guideIds = guide
    ? [
        ...(guide.power?.checks || []).map(check => check.id),
        ...(guide.storageTasks || []).map(task => task.id),
        ...(guide.completion || []).map(module => 'completion-' + module.id),
      ]
    : [];
  return [
    ...phases,
    { label: 'Storage room', unit: 'container step', ids: containers },
    ...(guideIds.length ? [{ label: 'Plan guide', unit: 'step', ids: guideIds }] : []),
  ];
}

// Reads the chosen file; nothing changes until the preview's Merge is pressed.
async function readFile(file: File): Promise<unknown> {
  if (file.size > transferImportLimit) throw Error('Choose a file smaller than 50 MB.');
  try {
    return JSON.parse(await file.text());
  } catch {
    throw Error(NOT_PROGRESS);
  }
}

// "Merge progress from file…": read the file, wait for the queued saves so the preview counts
// what is saved, show the preview, and on Merge tick the new steps in updates of at most a
// thousand. A failed write reports through save()'s error toast; the steps saved before it stay
// ticked, and merging the same file again ticks the rest.
async function mergeFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || merging.value) return;
  merging.value = true;
  try {
    const source = readProgressFile(await readFile(file));
    await writeQueue;
    const profileId = currentProfile.id;
    const preview = mergePreview(source.ticks, state.checks, mergeGroups());
    const nothing = nothingToMerge(source, preview);
    if (nothing) {
      toast(nothing);
      return;
    }
    if (!(await confirmAction(mergeQuestion(file.name, source, preview)))) return;
    // Another profile opened meanwhile: its steps were not the ones previewed.
    if (currentProfile.id !== profileId) return;
    const chunks = mergeChunks(preview.newIds, state.checks);
    let count = 0;
    try {
      for (const keys of chunks) {
        await save(mergeUpdate(keys, source));
        count += keys.length;
      }
    } catch {
      // save() showed the error; what was saved before it stays ticked.
      return;
    }
    setMergedProgress({ count, fileName: file.name, profileId });
    render();
    toast(mergedMessage(count, file.name));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    merging.value = false;
    // Cleared every time, so choosing the same file again fires another change.
    input.value = '';
  }
}
</script>

<template>
  <section class="panel" data-coop-progress>
    <h2>Co-op progress</h2>
    <p>
      Playing one plan together, each on your own copy? Export your ticks as a small file for your
      friends, and merge their file into this profile. A merge only adds ticks: nothing is unticked,
      and the plan stays as it is.
    </p>
    <button
      type="button"
      class="btn"
      data-export-ticks
      :aria-disabled="exporting || undefined"
      @click="exportTicks"
    >
      Export ticks
    </button>
    <button
      type="button"
      class="btn"
      data-merge-progress
      :aria-disabled="merging || undefined"
      @click="merging || mergeInput?.click()"
    >
      Merge progress from file…</button
    ><input
      id="merge-progress"
      ref="mergeInput"
      class="visually-hidden"
      type="file"
      accept="application/json,.json"
      tabindex="-1"
      aria-hidden="true"
      @change="mergeFile"
    />
    <p class="small muted">
      You see what the file would tick, per phase, before anything changes. A progress backup or a
      save export with one profile works too: only its ticks are merged.
    </p>
  </section>
</template>
