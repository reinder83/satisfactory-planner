<!-- The browser edition's notice that saves live in this browser, at the top of the wizard,
     guided-start, node-survey, saves and Backup pages. When the browser has not agreed to keep
     the saves (#1368) it says they may be cleared and how long ago the last full export was, in
     the same calm notice; with persistence kept or not yet known it is the plain reminder. -->
<script setup lang="ts">
import { computed } from 'vue';
import { workspace } from '../session.ts';
import { persistence } from '../storage-persistence.ts';
import { backupDays } from '../views/backup.ts';
import { legacy } from './bridge.ts';

const atRisk = computed(
  () => persistence.value === 'not-kept' || persistence.value === 'unsupported',
);
// "The last full export was 15 days ago", or that there is none, when the browser may clear.
const exported = computed(() =>
  legacy(() => {
    const days = backupDays(workspace.lastBackup);
    if (days === null) return 'You have not exported a backup yet.';
    return (
      'Your last full export was ' +
      (days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago') +
      '.'
    );
  }),
);
</script>

<template>
  <div v-if="atRisk" class="notice info" data-storage-risk>
    Your browser may clear these saves on its own, for example when it runs low on space.
    {{ exported }} Export a full backup to be safe.
    <a class="backup-link" href="#backup">Backup</a>
  </div>
  <div v-else class="notice info">
    Your saves stay in this browser on this device. Clearing site data or using private browsing can
    remove them. Export a full backup before switching devices or website addresses.
    <a class="backup-link" href="#backup">Backup</a>
  </div>
</template>
