<!--
  #backup, in two versions: the browser edition (saves live in this browser, so there is no
  progress download) and the server edition, with this profile's progress download and restore.
  The save-wide note (key `global`) moved to the Notes page with the phase notes (NotesPage.vue,
  #243); the server version points there where it used to be.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { transferFileSize, transferImportLimit } from '../../../transfer.ts';
import { confirmAction } from '../confirm.ts';
import {
  downloadJson,
  navigate,
  post,
  queuedWrite,
  request,
  toast,
  writeQueue,
} from '../../api.ts';
import {
  boot,
  calculated,
  currentProfile,
  currentSave,
  setWorkspace,
  state,
  workspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { backupAge, restoreMessage } from '../../views/backup.ts';
import { invalidate, legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import PageHeader from '../PageHeader.vue';

const page = computed(() =>
  legacy(() => ({
    kind: browserMode ? 'browser' : 'server',
    saveName: currentSave.name,
    profileName: currentProfile.name,
    exportUrl: `/api/export?save=${currentSave.id}&profile=${currentProfile.id}`,
    warnings: calculated?.warnings || [],
    // For "Choose saves to export": every save of this user with its profile count.
    saves: workspace.saves.map(save => ({
      id: save.id,
      name: save.name,
      profiles: save.profiles.length,
    })),
    // The browser edition's backup status (SP-40): its age, worked out on every render, and
    // when it was. Warn-toned after a week, or when there has been no full backup.
    backup: backupAge(workspace.lastBackup),
    backupAt: workspace.lastBackup ? new Date(workspace.lastBackup).toLocaleString() : '',
  })),
);
const exporting = ref(false);
// The saves ticked under "Choose saves to export" (#160), by id.
const chosen = ref<string[]>([]);
// "Import saves…" and "Restore this profile…" are real buttons that open a file input kept out of
// sight (.visually-hidden) and out of the tab order, so they can be reached with Tab and
// pressed with Enter or Space (#307): a label around a `hidden` input could only be clicked.
// The input keeps its id and change handler, so what happens after a file is chosen is
// unchanged. Only the server version of the page has the restore input.
const importSavesInput = ref<HTMLInputElement>();
const restoreInput = ref<HTMLInputElement>();

// "Export all saves" (no `selection`) or "Export selected" (the ticked save ids): wait for
// queued saves, download them as one full-save file, then refetch the workspace, which
// carries lastBackup (when a full export last ran in the browser edition; a selection is not
// a full backup and does not count).
// Both buttons are busy meanwhile (bound aria-disabled, app/busy.ts: they keep focus, #299).
async function exportSaves(selection?: string[]) {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await writeQueue;
    const data = await request(
      '/api/export-saves' +
        (selection ? '?saves=' + selection.map(encodeURIComponent).join(',') : ''),
    );
    // Past the import limit the file could not be imported back, so it is refused rather than
    // downloaded (the owner's choice on #118). The browser edition does not record such an
    // export as a backup either (browser-api.ts).
    const size = transferFileSize(data);
    if (size > transferImportLimit)
      throw Error(
        `This export would be ${Math.ceil(size / 1024 / 1024)} MB, more than the ` +
          `${transferImportLimit / 1024 / 1024} MB an import accepts, so nothing was downloaded. ` +
          (selection
            ? 'Tick fewer saves and export them in smaller groups.'
            : 'Use “Choose saves to export” to export them in smaller groups.'),
      );
    downloadJson(data, selection ? 'satisfactory-saves.json' : 'satisfactory-full-saves.json');
    setWorkspace(await request('/api/workspace'));
    invalidate();
    toast(
      selection
        ? `${selection.length} save${selection.length === 1 ? '' : 's'} downloaded.`
        : 'Full save backup downloaded.',
    );
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    exporting.value = false;
  }
}

// "Import saves": import every save in the file as new copies with new ids, after a
// confirmation, so existing saves are never replaced. It waits for queued saves, then
// reloads the whole workspace with boot() and shows the profiles page. The success toast
// only follows a successful import; any failure (too large, not JSON, refused by the
// server) is a toast.
async function importSaves(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    // Checked before reading, so a huge file is never parsed.
    if (file.size > transferImportLimit) throw Error('Choose a save export smaller than 50 MB.');
    const data = JSON.parse(await file.text());
    if (
      !(await confirmAction({
        title: 'Import these saves?',
        body: 'Import these saves as new copies? Existing saves will be kept.',
        confirmLabel: 'Import saves',
      }))
    )
      return;
    await writeQueue;
    await post('/api/import-saves', data, false);
    await boot();
    navigate('profiles');
    toast('Imported saves. Existing progress was kept.');
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    // Clear the picker either way so choosing the same file again fires change again.
    input.value = '';
  }
}

// "Restore this profile…": replace this profile's progress with a progress-only backup. Only the
// server version of the page binds it; the browser edition's page has no progress download or
// restore, and moves saves with Export/Import saves instead, though
// browser-api.ts answers /api/import the same way for parity.
// After a confirmation it goes through queuedWrite, like save(): after
// the saves already queued, before any made meanwhile, shown as "Saving…", and its reply only
// shown if this profile is still open. It toasts its own errors; "Backup restored." only
// follows a successful response, with how many records the restore newly kept for review in
// Notes (restoreMessage, #760).
async function restoreProgress(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a backup smaller than 2 MB.');
    const data = JSON.parse(await file.text());
    if (
      !(await confirmAction({
        title: 'Restore this backup?',
        body: 'Replace current progress with this backup?',
        confirmLabel: 'Replace progress',
        danger: true,
      }))
    )
      return;
    // The review list as it is before the restore, which replaces the state.
    const before = { handbookOrigin: structuredClone(state.handbookOrigin) };
    const restored = await queuedWrite('/api/import', data);
    render();
    toast(restoreMessage(before, restored));
  } catch (error) {
    toast((error as Error).message || 'Could not restore backup.', true);
  } finally {
    // Cleared every time, so choosing the same file again fires another change.
    input.value = '';
  }
}

// "Request persistent browser storage" (browser edition): ask the browser not to evict this
// site's storage, and say whether it agreed. Nothing is saved.
async function persistStorage() {
  try {
    const granted = await navigator.storage?.persist?.();
    toast(
      granted
        ? 'Persistent browser storage enabled.'
        : 'Browser did not grant persistence. Keep downloaded backups.',
    );
  } catch (error) {
    toast((error as Error).message, true);
  }
}
</script>

<template>
  <!-- The page header comes first in both versions, before the full-saves panel they share
       (#309). -->
  <template v-if="page.kind === 'browser'">
    <PageHeader
      eyebrow="SAVED ON THIS DEVICE"
      title="Backup"
      subtitle="No account or server is needed. Saves do not sync automatically between browsers."
    />
    <BrowserNotice />
  </template>
  <PageHeader
    v-else
    eyebrow="THIS PROFILE"
    title="Backup"
    :subtitle="
      'Checkmarks, deliveries and notes belong to ' + page.saveName + ' / ' + page.profileName
    "
  />
  <!-- Full-save export and import (the satisfactory-planner-saves format), in both editions.
       Import always adds copies; it never replaces a save. -->
  <section class="panel">
    <h2>Full saves & transfer</h2>
    <p>
      Export all your saves, profile calculations, checkmarks and notes. Account passwords and
      sessions are excluded. Import adds copies without replacing existing saves.
    </p>
    <button
      class="btn primary"
      data-export-saves
      :aria-disabled="exporting || undefined"
      @click="exportSaves()"
    >
      Export all saves
    </button>
    <button type="button" class="btn" data-import-saves @click="importSavesInput?.click()">
      Import saves…</button
    ><input
      id="import-saves"
      ref="importSavesInput"
      class="visually-hidden"
      type="file"
      accept="application/json,.json"
      tabindex="-1"
      aria-hidden="true"
      @change="importSaves"
    />
    <details v-if="page.saves.length > 1" class="choose-saves">
      <summary>Choose saves to export</summary>
      <p class="small muted">
        Export some saves on their own, for example to move them or to keep a file under the import
        limit. This is not recorded as a full backup.
      </p>
      <label v-for="save in page.saves" :key="save.id" class="check-row"
        ><input type="checkbox" :value="save.id" v-model="chosen" data-choose-save />{{
          save.name
        }}
        <span class="small muted"
          >· {{ save.profiles }} profile{{ save.profiles === 1 ? '' : 's' }}</span
        ></label
      >
      <button
        class="btn"
        data-export-selected
        :aria-disabled="exporting || undefined"
        :disabled="!exporting && !chosen.length"
        @click="exportSaves(chosen.filter(id => page.saves.some(s => s.id === id)))"
      >
        Export selected
      </button>
    </details>
  </section>

  <section v-if="page.kind === 'browser'" class="panel">
    <h2>Keep a backup</h2>
    <div
      class="notice backup-status"
      :class="page.backup.stale ? 'warn' : 'info'"
      data-backup-status
    >
      <b>{{ page.backup.text }}</b
      ><span v-if="page.backupAt" class="small"> · Last full export {{ page.backupAt }}</span>
    </div>
    <p>
      {{
        page.backup.days === null
          ? 'No full backup has been exported from this browser yet.'
          : 'Export all saves again after major changes.'
      }}
      Export before clearing browser data.
    </p>
    <button class="btn" data-persist-storage @click="persistStorage">
      Request persistent browser storage
    </button>
    <p class="small">
      This reduces automatic eviction when supported. It cannot protect against manually clearing
      site data.
    </p>
    <p>
      To move from Docker, update the Docker app and use Backup → Export all saves, then import that
      file here. A legacy progress-only export is not a full save.
    </p>
    <h2>Self-hosted edition</h2>
    <p>
      The Docker edition keeps server storage and user accounts for access across devices. Browser
      storage remains local to each visitor.
    </p>
  </section>

  <template v-else>
    <div class="backup-grid">
      <section class="panel">
        <h2>Download this profile</h2>
        <a class="btn primary" :href="page.exportUrl" download>Download this profile</a>
        <p class="small muted">
          For all accounts, profiles and calculation snapshots, back up the Docker data volume. This
          download contains only this profile’s progress.
        </p>
      </section>
      <section class="panel">
        <h2>Restore this profile</h2>
        <p>Restore replaces only this profile’s progress, after confirmation.</p>
        <button type="button" class="btn" data-restore-backup @click="restoreInput?.click()">
          Restore this profile…</button
        ><input
          id="import-file"
          ref="restoreInput"
          class="visually-hidden"
          type="file"
          accept="application/json,.json"
          tabindex="-1"
          aria-hidden="true"
          @change="restoreProgress"
        />
      </section>
    </div>
    <p class="small muted" data-notes-moved>
      Save-wide and phase notes are on the <a href="#notes">Notes</a> page.
    </p>
    <section class="panel">
      <h2>Calculation assumptions</h2>
      <p v-for="(warning, i) in page.warnings" :key="i">{{ warning }}</p>
      <a href="https://github.com/greeny/SatisfactoryTools" target="_blank" rel="noreferrer"
        >Recipe data source</a
      >
    </section>
  </template>
</template>
