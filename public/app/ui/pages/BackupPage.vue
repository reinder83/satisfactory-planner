<!--
  #backup, in three versions: the browser edition (saves live in this browser, so there is no
  progress download), a calculated profile on the server, and the original handbook on the
  server with its plan assumptions and sources. The save-wide note is stored under the key
  `global` and saves itself as you type (NoteBox.vue), as the plan page's and the dialogs'
  notes do.
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
  plan,
  setWorkspace,
  workspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { invalidate, legacy } from '../bridge.ts';
import NoteBox from '../NoteBox.vue';
import BrowserNotice from '../BrowserNotice.vue';
import PageHeader from '../PageHeader.vue';

const page = computed(() =>
  legacy(() => ({
    kind: browserMode ? 'browser' : calculated ? 'calculated' : 'handbook',
    saveName: currentSave.name,
    profileName: currentProfile.name,
    exportUrl: `/api/export?save=${currentSave.id}&profile=${currentProfile.id}`,
    warnings: calculated?.warnings || [],
    sources: plan?.sources || [],
    // For "Choose saves to export": every save of this user with its profile count.
    saves: workspace.saves.map(s => ({
      id: s.id,
      name: s.name,
      profiles: s.profiles.length,
    })),
    lastBackup: workspace.lastBackup
      ? 'Last export: ' + new Date(workspace.lastBackup).toLocaleString()
      : 'No full backup has been exported from this browser yet.',
  })),
);
const exporting = ref(false);
// The saves ticked under "Choose saves to export" (#160), by id.
const chosen = ref<string[]>([]);

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
  } catch (err) {
    toast((err as Error).message, true);
  } finally {
    exporting.value = false;
  }
}

// "Import saves": import every save in the file as new copies with new ids, after a
// confirmation, so existing saves are never replaced. It waits for queued saves, then
// reloads the whole workspace with boot() and shows the profiles page. The success toast
// only follows a successful import; any failure (too large, not JSON, refused by the
// server) is a toast.
async function importSaves(e: Event) {
  const input = e.target as HTMLInputElement;
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
  } catch (err) {
    toast((err as Error).message, true);
  } finally {
    // Clear the picker either way so choosing the same file again fires change again.
    input.value = '';
  }
}

// "Choose backup file": replace this profile's progress with a progress-only backup. Only the
// two server versions of the page bind it (calculated and handbook); the browser edition's page
// has no progress download or restore, and moves saves with Export/Import saves instead, though
// browser-api.ts answers /api/import the same way for parity.
// After a confirmation it goes through queuedWrite, like save(): after
// the saves already queued, before any made meanwhile, shown as "Saving…", and its reply only
// shown if this profile is still open. It toasts its own errors; "Backup restored." only
// follows a successful response.
async function restoreProgress(e: Event) {
  const el = e.target as HTMLInputElement,
    file = el.files?.[0];
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
    await queuedWrite('/api/import', data);
    render();
    toast('Backup restored.');
  } catch (err) {
    toast((err as Error).message || 'Could not restore backup.', true);
  } finally {
    // Cleared every time, so choosing the same file again fires another change.
    el.value = '';
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
  } catch (err) {
    toast((err as Error).message, true);
  }
}
</script>

<template>
  <!-- Full-save export and import (the satisfactory-planner-saves format), in both editions.
       Import always adds copies; it never replaces a save. -->
  <template v-if="page.kind === 'browser'">
    <PageHeader
      eyebrow="SAVED ON THIS DEVICE"
      title="Backups & transfer"
      subtitle="No account or server is needed. Saves do not sync automatically between browsers."
    />
    <BrowserNotice />
  </template>
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
    <label class="btn"
      >Import saves<input
        id="import-saves"
        type="file"
        accept="application/json,.json"
        hidden
        @change="importSaves"
    /></label>
    <details v-if="page.saves.length > 1" class="choose-saves">
      <summary>Choose saves to export</summary>
      <p class="small muted">
        Export some saves on their own, for example to move them or to keep a file under the import
        limit. This is not recorded as a full backup.
      </p>
      <label v-for="s in page.saves" :key="s.id" class="check-row"
        ><input type="checkbox" :value="s.id" v-model="chosen" data-choose-save />{{ s.name }}
        <span class="small muted"
          >· {{ s.profiles }} profile{{ s.profiles === 1 ? '' : 's' }}</span
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
    <p>
      {{ page.lastBackup }}
      Export after major changes and before clearing browser data.
    </p>
    <button class="btn" data-persist-storage @click="persistStorage">
      Request persistent browser storage
    </button>
    <p class="small">
      This reduces automatic eviction when supported. It cannot protect against manually clearing
      site data.
    </p>
    <p>
      To move from Docker, update the Docker app and use Backup & notes → Export all saves, then
      import that file here. A legacy progress-only export is not a full save.
    </p>
    <h2>Self-hosted edition</h2>
    <p>
      The Docker edition keeps server storage and user accounts for access across devices. Browser
      storage remains local to each visitor.
    </p>
  </section>

  <template v-else-if="page.kind === 'calculated'">
    <PageHeader
      eyebrow="THIS PROFILE"
      title="Backup & notes"
      :subtitle="
        'Checkmarks, deliveries and notes belong to ' + page.saveName + ' / ' + page.profileName
      "
    />
    <div class="backup-grid">
      <section class="panel">
        <h2>Download progress</h2>
        <a class="btn primary" :href="page.exportUrl" download>Download progress JSON</a>
        <p class="small muted">
          For all accounts, profiles and calculation snapshots, back up the Docker data volume. This
          download contains only this profile’s progress.
        </p>
      </section>
      <section class="panel">
        <h2>Restore this profile</h2>
        <p>Restore replaces only this profile’s progress, after confirmation.</p>
        <label class="btn"
          >Choose backup<input
            id="import-file"
            type="file"
            accept="application/json,.json"
            hidden
            @change="restoreProgress"
        /></label>
      </section>
    </div>
    <section class="panel">
      <h2>Save-wide notes for this profile</h2>
      <NoteBox id="global-note" note-key="global" aria-label="Save-wide notes" />
    </section>
    <section class="panel">
      <h2>Calculation assumptions</h2>
      <p v-for="(w, i) in page.warnings" :key="i">{{ w }}</p>
      <a href="https://github.com/greeny/SatisfactoryTools" target="_blank" rel="noreferrer"
        >Recipe data source</a
      >
    </section>
  </template>

  <template v-else>
    <PageHeader
      eyebrow="YOUR PROGRESS"
      title="Backup & notes"
      subtitle="Progress is stored on the server, so the same Docker instance works across your devices."
    />
    <div class="backup-grid">
      <section class="panel">
        <h2>Download a backup</h2>
        <p>Save a copy of your checkmarks, delivery counts, personal tasks and notes.</p>
        <a class="btn primary" :href="page.exportUrl" download>Download progress JSON ↓</a>
        <p class="small muted">
          The Docker volume keeps progress through container updates. This download gives you a
          separate copy.
        </p>
      </section>
      <section class="panel">
        <h2>Restore a backup</h2>
        <p>
          Import a backup from this planner. It replaces current progress after confirmation;
          factory-plan data stays unchanged.
        </p>
        <label class="btn"
          >Choose backup file<input
            id="import-file"
            type="file"
            accept="application/json,.json"
            hidden
            @change="restoreProgress"
        /></label>
        <p class="small muted">
          Up to 2 MB. The previous state is also retained as workspace.json.bak on the server. The
          original progress file is kept during migration.
        </p>
      </section>
    </div>
    <section class="panel" style="margin-top: 24px">
      <h2>Save-wide notes</h2>
      <NoteBox
        id="global-note"
        note-key="global"
        label="Seed, locations, routes and decisions."
        aria-label="Save-wide notes"
      />
    </section>
    <section class="panel">
      <h2>Plan assumptions</h2>
      <p class="small">
        All tiers through 6 unlocked. Phase 3 Versatile Frameworks delivered. Pure nodes, 50×
        elevator costs, half consumption. Retire coal and temporary fuel; retain turbofuel. Phase 5
        resource conversion and extra Reanimated SAM are included. Ground-floor storage shell is
        already built; individual containers are not assumed connected.
      </p>
      <p class="small">
        The final extra storage modules need additional input allocations. After Phase 5, storage
        takes priority over maintaining full elevator-export rates for sinking. Gathered items
        require collection; equipment and inhalers are manually crafted.
      </p>
      <div class="list-links">
        <a v-for="s in page.sources" :key="s.url" :href="s.url" target="_blank" rel="noreferrer"
          >{{ s.title }} ↗</a
        >
      </div>
    </section>
  </template>
</template>
