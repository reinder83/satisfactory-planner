<!--
  #profiles: every save in the workspace with its profile cards. A card is marked
  "PRESERVED HANDBOOK" for the original profile and "CALCULATED PROFILE" otherwise; only
  calculated ones have `settings` to summarise. The browser edition links to backups
  instead of accounts. Actions that leave the open profile call allowSwitch() first, which
  asks before dropping unsaved notes. "Create a save" is also offered by the wizard, so both
  use newSave in ui/actions.ts. Opening the page asks for the workspace summary again (#418), once
  the queued writes have landed, so each card's tick count, phase and phase bar are current,
  including changes made in another tab; until the reply the last summary is shown.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
  loadContext,
  phaseLabel,
  setWorkspace,
  workspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { startWizard } from '../../wizard/wizard.ts';
import { invalidate, legacy } from '../bridge.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import ActionMenu from '../ActionMenu.vue';
import BrowserNotice from '../BrowserNotice.vue';
import InlineName from '../InlineName.vue';
import PageHeader from '../PageHeader.vue';
import { newSave, openProfile } from '../actions.ts';
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
        // "1 check complete", not "1 checks" (#421), and none yet for a fresh profile.
        progress: `${p.completed ? plural(p.completed, 'check') + ' complete' : 'No checks complete yet'} · ${phaseLabel(p.phase)}`,
        bar: phaseBar(p),
      })),
    })),
  })),
);
// A calculated profile's progress bar (SP-32): a segment per phase it plans. Phases before the
// one worked on read as done, that one fills with its share of production lines ticked Running,
// later ones are empty; Post Phase 5 works on Phase 5's lines. The label says it without colour:
// "Phase 3 of 5, 22%". None without per-phase counts (a handbook profile).
function phaseBar(p: ProfileSummary) {
  if (!p.phases?.length) return null;
  const at = p.phase === 'post' ? 5 : Number(p.phase);
  const current = p.phases.find(x => Number(x.phase) === at);
  const pct = current?.total ? Math.round((current.done / current.total) * 100) : 0;
  return {
    label: `${p.phase === 'post' ? phaseLabel('post') : `Phase ${at} of 5`}, ${pct}%`,
    segments: p.phases.map(x => {
      const n = Number(x.phase);
      const state = n < at ? 'done' : n === at ? 'current' : 'later';
      return {
        phase: x.phase,
        state,
        fill: state === 'done' ? 100 : state === 'current' ? pct : 0,
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
const key = (action: string, s: SaveCard, p: ProfileCard) => `${action}:${s.id}:${p.id}`;
// A card's ⋯ menu (ui/ActionMenu.vue) holds Duplicate, Share and Remove (#238). It is busy while
// one of them runs, and says "Copying…" for Duplicate, since the menu has closed by then.
const menuId = (s: SaveCard, p: ProfileCard) => `profile-menu-${s.id}-${p.id}`;
const menuBusy = (s: SaveCard, p: ProfileCard) =>
  ['duplicate', 'share', 'remove'].some(a => busy.value === key(a, s, p));

// "Duplicate": copy the profile with its progress and open the copy.
async function duplicate(s: SaveCard, p: ProfileCard) {
  if (busy.value === key('duplicate', s, p)) return;
  if (!(await allowSwitch())) return;
  busy.value = key('duplicate', s, p);
  try {
    await writeQueue;
    const r = await post<{ workspace: WorkspaceSummary; saveId: string; profileId: string }>(
      '/api/duplicate-profile',
      { saveId: s.id, profileId: p.id },
    );
    setWorkspace(r.workspace);
    await loadContext(r.saveId, r.profileId);
    navigate('plan');
    toast('Copy created and opened. Changes here leave the original profile untouched.');
  } catch (err) {
    toast((err as Error).message, true);
  } finally {
    busy.value = '';
  }
}

// "Share": download that profile as a full-save file with its progress stripped (share=1),
// for someone else to import.
async function share(s: SaveCard, p: ProfileCard) {
  if (busy.value === key('share', s, p)) return;
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
    toast((err as Error).message, true);
  } finally {
    busy.value = '';
  }
}

// "Remove profile": after the unsaved-notes check, confirm by name (and say when its save
// goes too, as its last profile), then remove it and reload everything with boot(). Other
// profiles keep their progress. Remove is in the card's ⋯ menu, which has closed and given focus
// to ⋯ by now, so ⋯ is the control that asked: focus then goes to the next profile's ⋯, else the
// previous one's, else "Create a save" (ui/refocus.ts, #286).
async function remove(e: Event, s: SaveCard, p: ProfileCard) {
  if (busy.value === key('remove', s, p)) return;
  const item = e.currentTarget instanceof Element ? e.currentTarget : null;
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
        p.name +
        '" and its progress and notes?' +
        (s.profiles.length === 1
          ? ' This also removes the empty save.'
          : ' Other profiles keep their progress.'),
      confirmLabel: 'Remove profile',
      danger: true,
    }))
  )
    return;
  busy.value = key('remove', s, p);
  try {
    await writeQueue;
    await post('/api/remove-profile', { saveId: s.id, profileId: p.id, confirmed: true });
    await boot();
    if (workspace.saves.length) navigate('profiles');
    toast('Profile removed.');
    await refocus();
  } catch (err) {
    toast((err as Error).message, true);
  } finally {
    busy.value = '';
  }
}

// "Open profile" / "Continue current profile": make it the active profile on the server,
// load it and show its plan (openProfile in ui/actions.ts, which the sidebar's profile switcher
// uses too).
function openCard(s: SaveCard, p: ProfileCard) {
  if (busy.value === key('open', s, p)) return;
  return openProfile(s.id, p.id, on => (busy.value = on ? key('open', s, p) : ''));
}

// Renames any save or profile in place (SP-31, ui/InlineName.vue), naming it in the request's
// scope headers; a save is scoped with any one of its profiles. The new names are copied into
// the session's currentSave and currentProfile, so the sidebar footer and the breadcrumb follow.
// A failure is toasted and rethrown, so the input stays open.
async function rename(target: 'save' | 'profile', s: SaveCard, p: { id: string }, name: string) {
  try {
    setWorkspace(
      await post<WorkspaceSummary>('/api/rename', { target, name }, { save: s.id, profile: p.id }),
    );
    const open = workspace.saves.find(x => x.id === currentSave.id);
    if (open) {
      currentSave.name = open.name;
      currentProfile.name =
        open.profiles.find(x => x.id === currentProfile.id)?.name ?? currentProfile.name;
    }
    render();
  } catch (err) {
    toast((err as Error).message, true);
    throw err;
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
  <section v-for="s in page.saves" :key="s.id" class="panel save-panel">
    <div class="section-head">
      <InlineName
        :name="s.name"
        what="save"
        tag="h2"
        :hook="{ 'data-rename-save': s.id }"
        :save="n => rename('save', s, s.profiles[0]!, n)"
      />
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
        <InlineName
          :name="p.name"
          what="profile"
          tag="h3"
          :hook="{ 'data-rename-profile': p.id, 'data-rename-profile-save': s.id }"
          :save="n => rename('profile', s, p, n)"
        />
        <p>{{ p.summary }}</p>
        <p class="small">{{ p.progress }}</p>
        <div
          v-if="p.bar"
          class="phase-bar"
          role="img"
          :aria-label="p.bar.label"
          :data-phase-bar="p.id"
        >
          <span
            v-for="seg in p.bar.segments"
            :key="seg.phase"
            :class="['phase-seg', seg.state]"
            :data-phase-seg="seg.phase"
            ><span :style="{ width: seg.fill + '%' }"></span
          ></span>
        </div>
        <div class="profile-actions">
          <button
            :class="['btn', p.open ? '' : 'primary']"
            :data-open-save="s.id"
            :data-open-profile="p.id"
            :aria-disabled="busy === key('open', s, p) || undefined"
            @click="openCard(s, p)"
          >
            {{ p.open ? 'Continue current profile' : 'Open profile' }}
          </button>
          <ActionMenu
            :id="menuId(s, p)"
            :label="'More actions for ' + p.name"
            :busy="menuBusy(s, p)"
            :busy-text="busy === key('duplicate', s, p) ? 'Copying…' : undefined"
            :data-profile-menu="p.id"
            :data-profile-menu-save="s.id"
          >
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              :data-duplicate-profile="p.id"
              :data-duplicate-save="s.id"
              :aria-disabled="busy === key('duplicate', s, p) || undefined"
              @click="duplicate(s, p)"
            >
              {{ busy === key('duplicate', s, p) ? 'Copying…' : 'Duplicate' }}
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              :data-share-profile="p.id"
              :data-share-save="s.id"
              :aria-disabled="busy === key('share', s, p) || undefined"
              @click="share(s, p)"
            >
              Share (without progress)
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn danger"
              :data-remove-profile="p.id"
              :data-remove-save="s.id"
              :aria-disabled="busy === key('remove', s, p) || undefined"
              @click="remove($event, s, p)"
            >
              Remove profile…
            </button>
          </ActionMenu>
        </div>
      </article>
    </div>
  </section>
  <p class="small muted">
    Duplicate copies a profile with its progress so you can try changes without touching the
    original. Share downloads a file with the plan, storage layout, factory groups and step edits —
    without your checkmarks or notes — that anyone can import under Backup → Import saves. Rename a
    save or profile with ✎ beside its name; renaming does not change progress. Profiles keep a
    frozen calculation so later planner updates cannot silently change your targets.
  </p>
</template>
