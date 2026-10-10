<!--
  #profiles: every save in the workspace with its profile cards, each marked "CALCULATED
  PROFILE" and summarising the settings its plan was made with. The browser edition links to backups
  instead of accounts. Actions that leave the open profile call allowSwitch() first, which
  asks before dropping unsaved notes. "Create a save" is also offered by the wizard, so both
  use newSave in ui/actions.ts. Opening the page asks for the workspace summary again (#418), once
  the queued writes have landed, so each card's tick count, phase and phase bar are current,
  including changes made in another tab; until the reply the last summary is shown. Each card's
  "Edit settings" (#1071) opens All settings on that profile's settings, to recalculate it in
  place (startEdit in wizard/wizard.ts); "Try another profile" still adds a new one. The card of
  a version such a recalculation kept says which profile it was kept for, and its ⋯ menu offers
  "Restore this version…" (restore below, app/restore-version.ts).
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import {
  allowSwitch,
  downloadJson,
  navigate,
  post,
  request,
  toast,
  writeQueue,
} from '../../api.ts';
import { num, plural, slug } from '../../format.ts';
import {
  boot,
  currentProfile,
  currentSave,
  importedSaves,
  loadContext,
  phaseLabel,
  setImportedSaves,
  setWorkspace,
  workspace,
} from '../../session.ts';
import { listNames } from '../../../wording.ts';
import { render } from '../../shell.ts';
import { startEdit, startWizard } from '../../wizard/wizard.ts';
import { invalidate, legacy } from '../bridge.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import ActionMenu from '../ActionMenu.vue';
import BrowserNotice from '../BrowserNotice.vue';
import InlineName from '../InlineName.vue';
import PageHeader from '../PageHeader.vue';
import { newSave, openProfile } from '../actions.ts';
import {
  postRestore,
  restoreKeptName,
  restoreQuestion,
  restoredText,
} from '../../restore-version.ts';
import type { ProfileSummary, WorkspaceSummary } from '../../../types/index.ts';

onMounted(async () => {
  try {
    await writeQueue;
    setWorkspace(await request<WorkspaceSummary>('/api/workspace'));
    invalidate();
  } catch {
    // The summary on screen stays; a failed request says nothing more here.
  }
});
// The notice about the last import is said once: leaving the page ends it.
onBeforeUnmount(() => setImportedSaves([]));

const page = computed(() =>
  legacy(() => ({
    accountsEnabled: workspace.accountsEnabled,
    // The copies the last import added (#1052), with the profile each opens on, and the profile
    // that stayed open.
    imported: workspace.saves
      .filter(save => importedSaves.includes(save.id))
      .map(save => ({ id: save.id, name: save.name, profile: save.activeProfile })),
    openSave: currentSave.name,
    openProfile: currentProfile.name,
    saves: workspace.saves.map(save => ({
      id: save.id,
      name: save.name,
      profiles: save.profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        // A version a recalculation in place (or a restore) kept (#1071): the profile it was kept
        // for, which "Restore this version" swaps it back into, with the plans both show.
        keptFor: save.profiles.find(p => p.id === profile.backupOf),
        planCreatedAt: profile.planCreatedAt,
        open: save.id === currentSave.id && profile.id === currentProfile.id,
        editable: !!profile.settings,
        summary: profile.settings
          ? `${profile.settings.purity} purity · ${num(profile.settings.multiplier)}× elevator · ${num(profile.settings.powerFactor)}× power`
          : '',
        // "1 check complete", not "1 checks" (#421), and none yet for a fresh profile.
        progress: `${profile.completed ? plural(profile.completed, 'check') + ' complete' : 'No checks complete yet'} · ${phaseLabel(profile.phase)}`,
        bar: phaseBar(profile),
      })),
    })),
  })),
);
// A calculated profile's progress bar (SP-32): a segment per phase it offers, as the top bar's
// phase track, the milestone-only phases before its start phase included (#759, #783), each
// filled with its share of build-plan steps ticked (`steps`, #746; production lines ticked Running from a summary
// without them). Phases before the one worked on fill green (`done`), that one in the accent
// (`current`), later ones are empty; Post Phase 5 works on Phase 5's steps. An earlier phase is
// not drawn as finished while it has an open step (#667, #746): opening the profile lands on the
// first earlier phase with open checks (phaseToOpen, #570), and the steps counted are the ones
// it looks at. A phase with an open step reads at most 99%, so it never says "100% done". The
// label says it without colour: "Phase 3 of 5, 22%", plus any earlier phase still open, "Phase 3
// of 5, 0%; Phase 2 is 40% done". None without per-phase counts.
function phaseBar(profile: ProfileSummary) {
  if (!profile.phases?.length) return null;
  const at = profile.phase === 'post' ? 5 : Number(profile.phase);
  const counts = profile.phases.map(entry => ({ phase: entry.phase, ...(entry.steps ?? entry) }));
  const share = (entry: { done: number; total: number }) =>
    !entry.total
      ? 0
      : entry.done >= entry.total
        ? 100
        : Math.min(99, Math.round((entry.done / entry.total) * 100));
  const current = counts.find(entry => Number(entry.phase) === at);
  const percent = current ? share(current) : 0;
  const open = counts.filter(entry => Number(entry.phase) < at && entry.done < entry.total);
  return {
    label:
      `${profile.phase === 'post' ? phaseLabel('post') : `Phase ${at} of 5`}, ${percent}%` +
      open.map(entry => `; Phase ${entry.phase} is ${share(entry)}% done`).join(''),
    segments: counts.map(entry => {
      const phaseNumber = Number(entry.phase);
      const state = phaseNumber < at ? 'done' : phaseNumber === at ? 'current' : 'later';
      return {
        phase: entry.phase,
        state,
        // An earlier phase without steps to count has nothing open, so it reads as done.
        fill: state === 'later' ? 0 : state === 'done' && !entry.total ? 100 : share(entry),
      };
    }),
  };
}
// A save card and a profile card of the page.
type SaveCard = (typeof page.value)['saves'][number];
type ProfileCard = SaveCard['profiles'][number];

// The card action in progress, as "<action>:<save id>:<profile id>", so its button can say so.
// That button is busy meanwhile (bound aria-disabled, app/busy.ts: it keeps focus, #299) and its
// handler does nothing more.
const busy = ref('');
const key = (action: string, save: SaveCard, profile: ProfileCard) =>
  `${action}:${save.id}:${profile.id}`;
// A card's ⋯ menu (ui/ActionMenu.vue) holds Duplicate, Share and Remove (#238). It is busy while
// one of them runs, and says "Copying…" for Duplicate, since the menu has closed by then.
const menuId = (save: SaveCard, profile: ProfileCard) => `profile-menu-${save.id}-${profile.id}`;
const menuBusy = (save: SaveCard, profile: ProfileCard) =>
  ['restore', 'duplicate', 'share', 'remove'].some(
    action => busy.value === key(action, save, profile),
  );

// "Restore this version…" (#1071), on the card of a version a recalculation in place kept: asks
// first, naming both profiles and the name the replaced version is kept under; then, when this
// tab has one of the two open, runs the unsaved-notes check. The kept version's plan and progress
// go back into the profile it was kept for, and the version they replace takes its card. The tab
// reloads the open profile when it was one of them. A refusal is a toast; a 409 (a profile
// changed meanwhile) also brings the list up to date.
async function restore(save: SaveCard, profile: ProfileCard) {
  const into = profile.keptFor;
  if (!into || busy.value === key('restore', save, profile)) return;
  const keptName = restoreKeptName(save.id, into.name);
  if (!(await confirmAction(restoreQuestion(profile.name, into.name, keptName)))) return;
  const involved = save.id === currentSave.id && [into.id, profile.id].includes(currentProfile.id);
  if (involved && !(await allowSwitch())) return;
  busy.value = key('restore', save, profile);
  try {
    await writeQueue;
    const reply = await postRestore({
      saveId: save.id,
      backupId: profile.id,
      into: into.id,
      planCreatedAt: into.planCreatedAt ?? '',
      backupPlanCreatedAt: profile.planCreatedAt ?? '',
      backupName: keptName,
    });
    setWorkspace(reply.workspace);
    if (involved) await loadContext(currentSave.id, currentProfile.id);
    invalidate();
    toast(restoredText(into.name, keptName));
  } catch (error) {
    toast((error as Error).message, true);
    if ((error as { status?: number }).status === 409)
      try {
        setWorkspace(await request<WorkspaceSummary>('/api/workspace'));
        invalidate();
      } catch {
        // The list on screen stays; the toast has said why nothing was restored.
      }
  } finally {
    busy.value = '';
  }
}

// "Duplicate": copy the profile with its progress and open the copy.
async function duplicate(save: SaveCard, profile: ProfileCard) {
  if (busy.value === key('duplicate', save, profile)) return;
  if (!(await allowSwitch())) return;
  busy.value = key('duplicate', save, profile);
  try {
    await writeQueue;
    const reply = await post<{ workspace: WorkspaceSummary; saveId: string; profileId: string }>(
      '/api/duplicate-profile',
      { saveId: save.id, profileId: profile.id },
    );
    setWorkspace(reply.workspace);
    await loadContext(reply.saveId, reply.profileId);
    navigate('plan');
    toast('Copy created and opened. Changes here leave the original profile untouched.');
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = '';
  }
}

// "Share": download that profile as a full-save file with its progress stripped (share=1),
// for someone else to import.
async function share(save: SaveCard, profile: ProfileCard) {
  if (busy.value === key('share', save, profile)) return;
  busy.value = key('share', save, profile);
  try {
    await writeQueue;
    const data = await request(
      '/api/export-saves?save=' +
        encodeURIComponent(save.id) +
        '&profile=' +
        encodeURIComponent(profile.id) +
        '&share=1',
    );
    downloadJson(data, (slug(profile.name || 'profile') || 'profile') + '-share.json');
    toast(
      'Share file downloaded: the plan without your progress. Others import it under Backup → Import saves.',
    );
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = '';
  }
}

// "Remove profile": after the unsaved-notes check, confirm by name (and say when its save
// goes too, as its last profile), then remove it and reload everything with boot(). Other
// profiles keep their progress. Remove is in the card's ⋯ menu, which has closed and given focus
// to ⋯ by now, so ⋯ is the control that asked: focus then goes to the next profile's ⋯, else the
// previous one's, else "Create a save" (ui/refocus.ts, #286).
async function remove(event: Event, save: SaveCard, profile: ProfileCard) {
  if (busy.value === key('remove', save, profile)) return;
  const item = event.currentTarget instanceof Element ? event.currentTarget : null;
  const menu = item?.closest('.profile-card')?.querySelector('[data-profile-menu]') ?? item;
  const refocus = refocusAfterRemoval(menu, {
    row: '#main .profile-card',
    control: '[data-profile-menu]',
    fallback: ['#main [data-new-save]'],
  });
  if (!(await allowSwitch())) return;
  if (
    !(await confirmAction({
      title: 'Remove this profile?',
      body:
        'Are you sure? Remove "' +
        profile.name +
        '" and its progress and notes?' +
        (save.profiles.length === 1
          ? ' This also removes the empty save.'
          : ' Other profiles keep their progress.'),
      confirmLabel: 'Remove profile',
      danger: true,
    }))
  )
    return;
  busy.value = key('remove', save, profile);
  try {
    await writeQueue;
    await post('/api/remove-profile', { saveId: save.id, profileId: profile.id, confirmed: true });
    await boot();
    if (workspace.saves.length) navigate('profiles');
    toast('Profile removed.');
    await refocus();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = '';
  }
}

// "Open profile" / "Continue current profile": make it the active profile on the server,
// load it and show its plan (openProfile in ui/actions.ts, which the sidebar's profile switcher
// uses too).
// "Edit settings": busy while the profile's plan is read (startEdit), and a failed read says so.
async function editCard(save: SaveCard, profile: ProfileCard) {
  if (busy.value) return;
  busy.value = key('edit', save, profile);
  try {
    await startEdit(save.id, profile.id);
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = '';
  }
}
function openCard(save: SaveCard, profile: ProfileCard) {
  if (busy.value === key('open', save, profile)) return;
  return openProfile(
    save.id,
    profile.id,
    on => (busy.value = on ? key('open', save, profile) : ''),
  );
}

// "Open" on the import notice (#1052): opens the copy at the profile it was exported on.
function openImported(save: { id: string; profile: string }) {
  const action = 'open-imported:' + save.id;
  if (busy.value === action) return;
  return openProfile(save.id, save.profile, on => (busy.value = on ? action : ''));
}

// Renames any save or profile in place (SP-31, ui/InlineName.vue), naming it in the request's
// scope headers; a save is scoped with any one of its profiles. The new names are copied into
// the session's currentSave and currentProfile, so the sidebar footer and the breadcrumb follow.
// A failure is toasted and rethrown, so the input stays open.
async function rename(
  target: 'save' | 'profile',
  save: SaveCard,
  profile: { id: string },
  name: string,
) {
  try {
    setWorkspace(
      await post<WorkspaceSummary>(
        '/api/rename',
        { target, name },
        { save: save.id, profile: profile.id },
      ),
    );
    const open = workspace.saves.find(entry => entry.id === currentSave.id);
    if (open) {
      currentSave.name = open.name;
      currentProfile.name =
        open.profiles.find(entry => entry.id === currentProfile.id)?.name ?? currentProfile.name;
    }
    render();
  } catch (error) {
    toast((error as Error).message, true);
    throw error;
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
    <a v-if="browserMode" class="btn" href="#backup">Backup</a>
    <a v-else class="btn" href="#account">{{
      page.accountsEnabled ? 'Your account' : 'Set up user accounts'
    }}</a>
  </div>
  <div v-if="page.imported.length" class="notice info import-notice" data-import-notice>
    <p>
      <strong>{{
        page.imported.length === 1
          ? 'Imported 1 save as a new copy:'
          : `Imported ${page.imported.length} saves as new copies:`
      }}</strong>
      {{ listNames(page.imported.map(save => '“' + save.name + '”')) }}. You are still on “{{
        page.openProfile
      }}” in “{{ page.openSave }}”, and nothing in it changed. Open a copy when you want to work in
      it.
    </p>
    <div class="import-actions">
      <button
        v-for="save in page.imported"
        :key="save.id"
        type="button"
        class="btn"
        :data-open-imported="save.id"
        :aria-disabled="busy === 'open-imported:' + save.id || undefined"
        @click="openImported(save)"
      >
        Open “{{ save.name }}”
      </button>
    </div>
  </div>
  <section v-for="save in page.saves" :key="save.id" class="panel save-panel">
    <div class="section-head">
      <InlineName
        :name="save.name"
        what="save"
        tag="h2"
        :hook="{ 'data-rename-save': save.id }"
        :save="name => rename('save', save, save.profiles[0]!, name)"
      />
      <button class="btn" :data-new-profile="save.id" @click="startWizard(save.id)">
        Try another profile
      </button>
    </div>
    <div class="profile-cards">
      <article
        v-for="profile in save.profiles"
        :key="profile.id"
        :class="['profile-card', profile.open ? 'selected' : '']"
      >
        <div class="eyebrow">CALCULATED PROFILE</div>
        <InlineName
          :name="profile.name"
          what="profile"
          tag="h3"
          :hook="{ 'data-rename-profile': profile.id, 'data-rename-profile-save': save.id }"
          :save="name => rename('profile', save, profile, name)"
        />
        <p v-if="profile.keptFor" class="small muted" :data-kept-for="profile.id">
          Kept version of “{{ profile.keptFor.name }}”
        </p>
        <p v-if="profile.summary">{{ profile.summary }}</p>
        <p class="small">{{ profile.progress }}</p>
        <div
          v-if="profile.bar"
          class="phase-bar"
          role="img"
          :aria-label="profile.bar.label"
          :data-phase-bar="profile.id"
        >
          <span
            v-for="segment in profile.bar.segments"
            :key="segment.phase"
            :class="['phase-seg', segment.state]"
            :data-phase-seg="segment.phase"
            ><span :style="{ width: segment.fill + '%' }"></span
          ></span>
        </div>
        <div class="profile-actions">
          <button
            :class="['btn', profile.open ? '' : 'primary']"
            :data-open-save="save.id"
            :data-open-profile="profile.id"
            :aria-disabled="busy === key('open', save, profile) || undefined"
            @click="openCard(save, profile)"
          >
            {{ profile.open ? 'Continue current profile' : 'Open profile' }}
          </button>
          <button
            v-if="profile.editable"
            type="button"
            class="btn"
            :data-edit-profile="profile.id"
            :data-edit-save="save.id"
            :aria-disabled="busy === key('edit', save, profile) || undefined"
            @click="editCard(save, profile)"
          >
            Edit settings
          </button>
          <ActionMenu
            :id="menuId(save, profile)"
            :label="'More actions for ' + profile.name"
            :busy="menuBusy(save, profile)"
            :busy-text="busy === key('duplicate', save, profile) ? 'Copying…' : undefined"
            :data-profile-menu="profile.id"
            :data-profile-menu-save="save.id"
          >
            <button
              v-if="profile.keptFor"
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              :data-restore-version="profile.id"
              :data-restore-save="save.id"
              :aria-disabled="busy === key('restore', save, profile) || undefined"
              @click="restore(save, profile)"
            >
              Restore this version…
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              :data-duplicate-profile="profile.id"
              :data-duplicate-save="save.id"
              :aria-disabled="busy === key('duplicate', save, profile) || undefined"
              @click="duplicate(save, profile)"
            >
              {{ busy === key('duplicate', save, profile) ? 'Copying…' : 'Duplicate' }}
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              :data-share-profile="profile.id"
              :data-share-save="save.id"
              :aria-disabled="busy === key('share', save, profile) || undefined"
              @click="share(save, profile)"
            >
              Share (without progress)
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn danger"
              :data-remove-profile="profile.id"
              :data-remove-save="save.id"
              :aria-disabled="busy === key('remove', save, profile) || undefined"
              @click="remove($event, save, profile)"
            >
              Remove profile…
            </button>
          </ActionMenu>
        </div>
      </article>
    </div>
  </section>
  <p class="small muted">
    Edit settings recalculates a profile in place, keeps its progress and keeps the current version
    as a separate profile; that version's ⋯ menu has Restore this version, which swaps it back.
    Duplicate copies a profile with its progress so you can try changes without touching the
    original. Share downloads a file with the plan, storage layout, factories and step edits —
    without your checkmarks or notes — that anyone can import under Backup → Import saves. Rename a
    save or profile with ✎ beside its name; renaming does not change progress. Profiles keep a
    frozen calculation so later planner updates cannot silently change your targets.
  </p>
</template>
