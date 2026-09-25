<!--
  #profiles: every save in the workspace with its profile cards. A card is marked
  "PRESERVED HANDBOOK" for the original profile and "CALCULATED PROFILE" otherwise; only
  calculated ones have `settings` to summarise. The browser edition links to backups
  instead of accounts. Actions that leave the open profile call allowSwitch() first, which
  asks before dropping unsaved notes. "Create a save" is also offered by the wizard, so both
  use newSave in ui/actions.ts.
-->
<script setup>
import { computed, ref } from 'vue';
import { browserMode } from '../../../browser-api.js';
import {
  allowSwitch,
  downloadJson,
  navigate,
  post,
  request,
  toast,
  writeQueue,
} from '../../api.ts';
import { num, slug } from '../../format.ts';
import {
  boot,
  currentProfile,
  currentSave,
  loadContext,
  phaseLabel,
  setWorkspace,
  workspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { startWizard } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import PageHeader from '../PageHeader.vue';
import { newSave } from '../actions.ts';

const page = computed(() =>
  legacy(() => ({
    accountsEnabled: workspace.accountsEnabled,
    saves: workspace.saves.map(s => ({
      id: s.id,
      name: s.name,
      profiles: s.profiles.map(p => ({
        id: p.id,
        name: p.name,
        open: s.id === currentSave.id && p.id === currentProfile.id,
        kind: p.kind === 'original' ? 'PRESERVED HANDBOOK' : 'CALCULATED PROFILE',
        summary: p.settings
          ? `${p.settings.purity} purity · ${num(p.settings.multiplier)}× elevator · ${num(p.settings.powerFactor)}× power`
          : '50× elevator · pure ingots · nuclear recycling',
        progress: `${p.completed} checks complete · ${phaseLabel(p.phase)}`,
      })),
    })),
  })),
);
// The card action in progress, as "<action>:<save id>:<profile id>", so its button can say so.
const busy = ref('');
const key = (action, s, p) => `${action}:${s.id}:${p.id}`;
const renaming = ref(false);

// "Duplicate": copy the profile with its progress and open the copy.
async function duplicate(s, p) {
  if (!allowSwitch()) return;
  busy.value = key('duplicate', s, p);
  try {
    await writeQueue;
    const r = await post('/api/duplicate-profile', { saveId: s.id, profileId: p.id });
    setWorkspace(r.workspace);
    await loadContext(r.saveId, r.profileId);
    navigate('plan');
    toast('Copy created and opened. Changes here leave the original profile untouched.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy.value = '';
  }
}

// "Share": download that profile as a full-save file with its progress stripped (share=1),
// for someone else to import.
async function share(s, p) {
  busy.value = key('share', s, p);
  try {
    await writeQueue;
    const data = await request(
      '/api/export-saves?save=' +
        encodeURIComponent(s.id) +
        '&profile=' +
        encodeURIComponent(p.id) +
        '&share=1',
    );
    downloadJson(data, (slug(p.name || 'profile') || 'profile') + '-share.json');
    toast(
      'Share file downloaded: the plan without your progress. Others import it under Backup → Import saves.',
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy.value = '';
  }
}

// "Remove profile": after the unsaved-notes check, confirm by name (and say when its save
// goes too, as its last profile), then remove it and reload everything with boot(). Other
// profiles keep their progress.
async function remove(s, p) {
  if (!allowSwitch()) return;
  if (
    !confirm(
      'Are you sure? Remove "' +
        p.name +
        '" and its progress and notes?' +
        (s.profiles.length === 1
          ? ' This also removes the empty save.'
          : ' Other profiles keep their progress.'),
    )
  )
    return;
  busy.value = key('remove', s, p);
  try {
    await writeQueue;
    await post('/api/remove-profile', { saveId: s.id, profileId: p.id, confirmed: true });
    await boot();
    if (workspace.saves.length) navigate('profiles');
    toast('Profile removed.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy.value = '';
  }
}

// "Open profile" / "Continue current profile": make it the active profile on the server,
// load it and show its plan.
async function openProfile(s, p) {
  if (!allowSwitch()) return;
  busy.value = key('open', s, p);
  try {
    await writeQueue;
    setWorkspace(await post('/api/select', { saveId: s.id, profileId: p.id }));
    await loadContext(s.id, p.id);
    navigate('plan');
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy.value = '';
  }
}

// #rename-form renames the open save or the open profile (its "target" select), then copies
// the new names into the session's currentSave and currentProfile and redraws.
async function rename(e) {
  renaming.value = true;
  try {
    setWorkspace(await post('/api/rename', Object.fromEntries(new FormData(e.target))));
    const s = workspace.saves.find(s => s.id === currentSave.id);
    currentSave.name = s.name;
    currentProfile.name = s.profiles.find(p => p.id === currentProfile.id).name;
    render();
  } catch (err) {
    toast(err.message, true);
  } finally {
    renaming.value = false;
  }
}
</script>

<template>
  <BrowserNotice v-if="browserMode" />
  <PageHeader
    eyebrow="YOUR FACTORY WORLDS"
    title="Saves & profiles"
    subtitle="Each save keeps separate progress for every profile. Switching back restores its checklist, deliveries and notes."
  />
  <div class="toolbar">
    <button class="btn primary" data-new-save @click="newSave">Create a save</button>
    <a v-if="browserMode" class="btn" href="#backup">Backups & transfer</a>
    <a v-else class="btn" href="#account">{{
      page.accountsEnabled ? 'Your account' : 'Set up user accounts'
    }}</a>
  </div>
  <section v-for="s in page.saves" :key="s.id" class="panel save-panel">
    <div class="section-head">
      <h2>{{ s.name }}</h2>
      <button class="btn" :data-new-profile="s.id" @click="startWizard(s.id)">
        Try another profile
      </button>
    </div>
    <div class="profile-cards">
      <article
        v-for="p in s.profiles"
        :key="p.id"
        :class="['profile-card', p.open ? 'selected' : '']"
      >
        <div class="eyebrow">{{ p.kind }}</div>
        <h3>{{ p.name }}</h3>
        <p>{{ p.summary }}</p>
        <p class="small">{{ p.progress }}</p>
        <button
          :class="['btn', p.open ? '' : 'primary']"
          :data-open-save="s.id"
          :data-open-profile="p.id"
          :disabled="busy === key('open', s, p)"
          @click="openProfile(s, p)"
        >
          {{ p.open ? 'Continue current profile' : 'Open profile' }}
        </button>
        <button
          class="btn"
          :data-duplicate-profile="p.id"
          :data-duplicate-save="s.id"
          :disabled="busy === key('duplicate', s, p)"
          @click="duplicate(s, p)"
        >
          {{ busy === key('duplicate', s, p) ? 'Copying…' : 'Duplicate' }}
        </button>
        <button
          class="btn"
          :data-share-profile="p.id"
          :data-share-save="s.id"
          :disabled="busy === key('share', s, p)"
          @click="share(s, p)"
        >
          Share
        </button>
        <button
          class="btn"
          :data-remove-profile="p.id"
          :data-remove-save="s.id"
          :disabled="busy === key('remove', s, p)"
          @click="remove(s, p)"
        >
          Remove profile
        </button>
      </article>
    </div>
  </section>
  <p class="small muted">
    Duplicate copies a profile with its progress so you can try changes without touching the
    original. Share downloads a file with the plan, storage layout, factory groups and step edits —
    without your checkmarks or notes — that anyone can import under Backup → Import saves.
  </p>
  <section class="panel">
    <h2>Rename the current save or profile</h2>
    <form id="rename-form" class="inline-form" @submit.prevent="rename">
      <select name="target" aria-label="What to rename">
        <option value="save">Save</option>
        <option value="profile">Profile</option></select
      ><input
        name="name"
        required
        maxlength="80"
        aria-label="New name"
        placeholder="New name"
      /><button class="btn" :disabled="renaming">Rename</button>
    </form>
    <p class="small muted">
      Renaming does not change progress. Profiles keep a frozen calculation so later planner updates
      cannot silently change your targets.
    </p>
  </section>
</template>
