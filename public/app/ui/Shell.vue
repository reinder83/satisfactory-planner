<!--
  The page frame: sidebar navigation, ADA, save status, the profile switcher, and the top bar
  with the breadcrumb (the save and the open profile) and the phase picker. The current page is drawn into the empty
  <main> by render() in shell.ts.

  The phase picker is a phase track (SP-44, #279): one segment per phase, each with its
  checklist's progress (views/phase-track.ts). At 720px and below the track gives way to the
  select, which is always there. Either one only shows a phase in this tab (viewPhase in
  session.ts, #1053), guarded for unsaved notes as a page change is; nothing is saved. The track
  is a tab list (the WAI-ARIA tabs pattern with manual activation): one Tab stop, on the phase
  shown; the arrow keys, Home and End move focus between the phases, and Enter, Space or a click
  shows one. Both name the working phase (pickerWords), the track marks its segment, and while
  the tab shows another phase the label reads "Showing" rather than "Working on" (#992) and "Work
  on Phase N" beside it saves the phase shown as the working phase (`save({ type: 'phase' })`).

  The profile switcher (SP-07, #242) is the sidebar footer as a menu button (ui/ActionMenu.vue):
  the open profile's name and settings lines on the button, and in its menu the open save's
  profiles, "All saves & profiles", then "Account" and "Sign out" on the server or "Backups &
  transfer" in the browser edition. A profile opens through openProfile in ui/actions.ts, the
  profiles page's Open, so it asks about unsaved notes first; signing out is the account page's
  signOut. The pages go through the address, as a sidebar link does, so the hash route asks too.
  Focus stays on the switcher after its choice, as it does on a followed sidebar link (the frame
  stays). A long name shows one line, cut with an ellipsis (#792), so it never makes the sidebar
  scroll; the whole name stays in the button's text (its accessible name), in its title, in the
  menu and on the profiles page. The breadcrumb's save name is cut the same way (#817), so it
  never pushes the phase track off the window; its title and the profiles page show it in full.
  After it the breadcrumb names the open profile (#1071), the name the switcher, the plan page and
  the profiles page show, cut the same way, also a link to the profiles page; at 720px and below
  only the profile's name shows. The
  switcher's menu also offers "Edit settings" for the open calculated profile (startEdit).

  At 720px and below (SP-37, #272) the sidebar is a drawer: a compact top bar holds ☰, the brand
  mark, the breadcrumb, the phase picker and the save status, and ☰ opens the sidebar full
  height over the page, with its navigation (the open page marked), ADA and the profile
  switcher. The open drawer is a modal dialog: Tab stays inside it, and Esc, its × or the
  backdrop close it and return focus to ☰. A followed link closes it and lets the opened page
  take focus. Wider, the button is hidden and the sidebar is as before.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { browserMode } from '../../browser-api.ts';
import { purities } from '../../preferences.ts';
import { allowSwitch, notesNotSaved, pending, save, toast } from '../api.ts';
import { startEdit } from '../wizard/wizard.ts';
import { num } from '../format.ts';
import {
  calculated,
  currentProfile,
  currentSave,
  phase,
  phaseLabel,
  phaseOptions,
  setOpenedPhase,
  setQuery,
  view,
  viewPhase,
  workingPhase,
  workingPhaseNotShown,
  workspace,
} from '../session.ts';
import type { View } from '../session.ts';
import type { Phase } from '../../types/index.ts';
import { render } from '../shell.ts';
import { backupAge } from '../views/backup.ts';
import { factoryGroupsState } from '../views/factories.ts';
import { phaseTrack } from '../views/phase-track.ts';
import AdaPanel from './AdaPanel.vue';
import GroupMovedNotice from './GroupMovedNotice.vue';
import { legacy } from './bridge.ts';
import ActionMenu from './ActionMenu.vue';
import { openProfile, signOut } from './actions.ts';

// The sidebar's navigation: route, icon, label.
const NAV: [id: string, icon: string, label: string][] = [
  ['plan', '◫', 'Build plan'],
  ['factories', '▥', 'Factories'],
  ['logistics', '⇄', 'Logistics'],
  ['storage', '▦', 'Storage room'],
  ['resources', '↗', 'Power & resources'],
  ['notes', '✎', 'Notes'],
  ['backup', '⇅', 'Backup'],
];

// A notes box that says "Not saved" (a failed write, or a version to choose, #1052) is never
// outshone by "Saved": the status says a note is not saved until the box saves it or goes.
const unsavedNotes = (count: number) =>
  count === 1 ? 'Note not saved' : count + ' notes not saved';

const frame = computed(() =>
  legacy(() => ({
    view,
    // What Logistics still needs before it shows anything (SP-09): its link is dimmed with the
    // reason on a second line, and the page itself explains the same.
    needs: {
      logistics: !calculated
        ? 'needs a calculated plan'
        : !factoryGroupsState().groups.length
          ? 'needs factories'
          : '',
    } as Record<string, string>,
    // The empty workspace's placeholder save has no id; the breadcrumb says so as the status does.
    saveName: currentSave.id ? currentSave.name : 'No save yet',
    // The open profile, after the save in the breadcrumb (#1071): one name everywhere.
    profileName: currentSave.id ? currentProfile?.name || '' : '',
    editable: !!(currentSave.id && calculated),
    canPickPhase: !!currentSave.id,
    phase: phase(),
    phaseLabel: phaseLabel(phase()),
    phases: phaseOptions().map(p => [p, phaseLabel(p)]),
    track: phaseTrack(),
    picker: pickerWords(),
    // With no save open (an empty workspace, #281) nothing has been saved, so the status never
    // claims it, and its dot, which marks a save, is left out.
    hasSave: !!currentSave.id,
    notSaved: !pending && !!currentSave.id && notesNotSaved() > 0,
    saved: pending
      ? 'Saving…'
      : !currentSave.id
        ? 'Nothing saved yet'
        : notesNotSaved()
          ? unsavedNotes(notesNotSaved())
          : browserMode
            ? 'Saved in this browser'
            : 'Saved on server',
    savedShort: pending
      ? 'Saving…'
      : !currentSave.id
        ? 'No save yet'
        : notesNotSaved()
          ? 'Not saved'
          : browserMode
            ? 'Saved in browser'
            : 'Saved',
    // The browser edition's backup age under the save indicator (SP-40), worked out on every
    // render; the Backup page shows it in full. The Docker edition keeps its saves on the server.
    backup: browserMode && currentSave.id ? backupAge(workspace.lastBackup) : null,
    footer: profileFooter(),
    // The open save's profiles, for the switcher. A signed-out workspace has no saves, and the
    // frame may redraw once more before the sign-in screen replaces it.
    profiles: (workspace.saves?.find(s => s.id === currentSave.id)?.profiles ?? []).map(
      profile => ({
        id: profile.id,
        name: profile.name,
        open: profile.id === currentProfile?.id,
      }),
    ),
    accountsEnabled: !!workspace.accountsEnabled,
  })),
);

// The switcher is busy (aria-disabled, app/busy.ts) while a profile it chose opens.
const switching = ref(false);
function switchTo(id: string, open: boolean) {
  if (open || switching.value) return;
  closeMenu(false);
  return openProfile(currentSave.id, id, on => (switching.value = on));
}
// A page of the switcher's menu, through the address as a sidebar link would.
// "Edit settings" in the switcher (#1071): All settings on the open profile's settings.
function editOpen() {
  closeMenu(false);
  void startEdit(currentSave.id, currentProfile.id).catch(error =>
    toast((error as Error).message, true),
  );
}
const go = (page: View) => {
  closeMenu(false);
  location.hash = page;
};

// The phone drawer (SP-37): open or closed, the ☰ button that opens it, and the drawer itself.
const menuOpen = ref(false);
const toggle = ref<HTMLButtonElement | null>(null),
  drawer = ref<HTMLElement | null>(null);
const focusable = () =>
  [
    ...(drawer.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]',
    ) ?? []),
  ].filter(el => el.getClientRects().length > 0);
async function openMenu() {
  menuOpen.value = true;
  await nextTick();
  focusable()[0]?.focus();
}
// `refocus` returns focus to ☰; a followed link leaves it to the page that opens.
function closeMenu(refocus = true) {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (refocus) void nextTick(() => toggle.value?.focus());
}
// Inside the open drawer: Tab and Shift+Tab wrap around it, Esc closes it.
function drawerKey(event: KeyboardEvent) {
  if (!menuOpen.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu();
  } else if (event.key === 'Tab') {
    const all = focusable();
    if (!all.length) return;
    const first = all[0]!,
      last = all.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
// A navigation link followed from the drawer: close it. The link is then hidden, so it lets go
// of focus and the page it opens takes it (focusOpenedPage in ui/refocus.ts); the page already
// shown opens nothing, so focus goes back to ☰ instead.
function navFollowed(event: Event) {
  if (!menuOpen.value) return;
  const link = event.currentTarget as HTMLAnchorElement;
  const same = link.getAttribute('href') === location.hash;
  closeMenu(same);
  if (!same) link.blur();
}
// Widening past the phone layout shows the sidebar again, so the drawer closes.
let wide: MediaQueryList | undefined;
const widened = (event: MediaQueryListEvent) => {
  if (event.matches) closeMenu(false);
};
onMounted(() => {
  wide = globalThis.matchMedia?.('(min-width: 721px)');
  wide?.addEventListener?.('change', widened);
});
onBeforeUnmount(() => wide?.removeEventListener?.('change', widened));

// The top bar's short save status (shown at phone width, where the sidebar's is hidden)
// reserves the width of its longest label in this edition, so it never shifts the bar.
const savedShortWidest = browserMode ? 'Saved in browser' : 'No save yet';

// The sidebar footer: the open profile's name and the game settings it was planned for, as
// lines.
function profileFooter() {
  if (calculated) {
    const settings = calculated.settings;
    const date = new Date(calculated.createdAt);
    const purity = purities.find(([id]) => id === settings.purity)?.[1] || settings.purity;
    return [
      currentProfile.name,
      `${purity} purity · ${num(settings.multiplier)}× elevator parts`,
      `${num(settings.powerFactor)}× power consumption`,
      ...(Number.isNaN(date.getTime())
        ? []
        : [
            'Plan created ' +
              date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }),
          ]),
    ];
  }
  return ['Create or select a profile'];
}

// What the phase picker (the select and the track) is called (#992, #1053). It shows the phase on
// screen and names the working phase: "Showing phase, working on Phase 3". Its visible label is
// "Working on" while the working phase is on screen and "Showing" while the tab shows another (one
// picked to look at, #1053, the phase the profile opened on, #570, or a flow page's address
// names, #926), as the notices below the top bar say ("You are working on Phase 3"), so the two
// never call different phases the one being worked on. `working` is the working phase, which the
// track marks; `elsewhere` says the tab shows another, which offers "Work on Phase N".
function pickerWords(): { label: string; name: string; working: Phase; elsewhere: boolean } {
  const elsewhere = !!workingPhaseNotShown(),
    working = workingPhase();
  return {
    label: elsewhere ? 'Showing' : 'Working on',
    name: `Showing phase, working on ${phaseLabel(working)}`,
    working,
    elsewhere,
  };
}

// Shows phase `target` in this tab (#1053): never saved, so another tab, another device and a
// reload still go by the working phase. The redraw shows that phase's notes, so an unsaved note
// is asked about first, and the search is cleared as on a page change. True once it is shown;
// false when the note was kept or another switch is still asking.
const phaseSwitching = ref(false);
async function showPhase(target: Phase): Promise<boolean> {
  if (target === phase()) return true;
  if (phaseSwitching.value) return false;
  phaseSwitching.value = true;
  try {
    if (!(await allowSwitch())) return false;
    viewPhase(target);
    setQuery('');
    render();
    return true;
  } finally {
    phaseSwitching.value = false;
  }
}

// The select (phone widths): shows the phase chosen, or the phase on screen again when the switch
// is refused.
async function pickPhase(event: Event) {
  const el = event.target as HTMLSelectElement;
  // The options are phaseOptions(), so the value is a phase.
  if (!(await showPhase(el.value as Phase))) el.value = phase();
}

// The phase track's keys (WAI-ARIA tabs with manual activation, #1053): the arrow keys, Home and
// End move focus between the segments, wrapping around, and show nothing; Enter or Space presses
// the focused segment, which shows its phase. Only the segment of the phase shown is a Tab stop.
function trackKey(event: KeyboardEvent) {
  const tabs = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role="tab"]:not([disabled])',
    ),
  ];
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? (at + 1) % tabs.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? (at - 1 + tabs.length) % tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : null;
  if (next === null || !tabs.length) return;
  event.preventDefault();
  tabs[next]?.focus();
}

// "Work on Phase N" (#1053): saves the phase shown as the profile's working phase, the one other
// tabs, devices and a reload open. Busy while it saves (#299). The button goes once the phase
// shown is the working phase, so focus moves to the phase picker that now says "Working on": the
// track's segment, or the select at phone widths. A failed write reports through the error toast
// and leaves everything as it was.
const committing = ref(false);
async function workOnShown() {
  const target = phase();
  if (committing.value || !workingPhaseNotShown()) return;
  committing.value = true;
  try {
    await save({ type: 'phase', value: target });
    setOpenedPhase(null);
    render();
    toast(`You are now working on ${phaseLabel(target)}.`);
    await nextTick();
    const picker = wide?.matches
      ? document.querySelector<HTMLElement>('[data-phase-track] [aria-selected="true"]')
      : document.querySelector<HTMLElement>('#phase-picker');
    picker?.focus();
  } catch {
    // Reported by the error toast; the phase shown stays and so does the button.
  } finally {
    committing.value = false;
  }
}
</script>

<template>
  <div :class="['layout', menuOpen ? 'menu-open' : '']">
    <div v-if="menuOpen" class="drawer-backdrop" aria-hidden="true" @click="closeMenu()"></div>
    <aside
      id="sidebar"
      ref="drawer"
      class="sidebar"
      :role="menuOpen ? 'dialog' : undefined"
      :aria-modal="menuOpen ? 'true' : undefined"
      :aria-label="menuOpen ? 'Menu' : undefined"
      @keydown="drawerKey"
    >
      <div class="brand">
        <img src="./favicon.svg" alt="" />
        <div>
          Project Assembly
          <div class="eyebrow">FICSIT compliance terminal</div>
        </div>
        <button
          type="button"
          class="btn drawer-close"
          aria-label="Close menu"
          data-menu-close
          @click="closeMenu()"
        >
          ×
        </button>
      </div>
      <nav class="nav" aria-label="Main navigation">
        <a
          v-for="[id, icon, label] in NAV"
          :key="id"
          :href="'#' + id"
          :class="[frame.view === id ? 'active' : '', frame.needs[id] ? 'dim' : '']"
          :aria-current="frame.view === id ? 'page' : undefined"
          @click="navFollowed"
          :aria-describedby="frame.needs[id] ? `nav-${id}-needs` : undefined"
          ><span class="navicon" aria-hidden="true">{{ icon }}</span
          ><span class="nav-label"
            >{{ label
            }}<small
              v-if="frame.needs[id]"
              :id="`nav-${id}-needs`"
              class="nav-needs"
              aria-hidden="true"
              >{{ frame.needs[id] }}</small
            ></span
          ></a
        >
      </nav>
      <AdaPanel />
      <div :class="['save-status', frame.notSaved ? 'is-not-saved' : '']">
        <span v-if="frame.hasSave" class="dot" aria-hidden="true"></span
        ><span id="saved" role="status" aria-live="polite">{{ frame.saved }}</span>
      </div>
      <a
        v-if="frame.backup"
        href="#backup"
        :class="['backup-age', frame.backup.stale ? 'is-stale' : '']"
        data-backup-age
        @click="navFollowed"
        >{{ frame.backup.short }}</a
      >
      <div class="sidebar-foot">
        <ActionMenu
          id="profile-switcher"
          trigger-class="profile-switcher"
          :busy="switching"
          data-profile-switcher
        >
          <template #trigger
            ><svg
              class="profile-switcher-icon"
              aria-hidden="true"
              viewBox="0 0 10 14"
              width="10"
              height="14"
            >
              <path d="M1.5 5 5 1.5 8.5 5M1.5 9 5 12.5 8.5 9" /></svg
            ><span class="profile-switcher-name" :title="frame.footer[0]">{{
              frame.footer[0]
            }}</span
            ><template v-for="(line, i) in frame.footer.slice(1)" :key="i"
              ><br />{{ line }}</template
            ></template
          >
          <div
            v-if="frame.profiles.length"
            class="action-menu-group"
            role="group"
            :aria-label="'Profiles in ' + frame.saveName"
          >
            <div class="eyebrow" aria-hidden="true">Profiles in {{ frame.saveName }}</div>
            <button
              v-for="profile in frame.profiles"
              :key="profile.id"
              type="button"
              role="menuitemradio"
              tabindex="-1"
              class="btn"
              :aria-checked="profile.open ? 'true' : 'false'"
              :data-switch-profile="profile.id"
              @click="switchTo(profile.id, profile.open)"
            >
              {{ profile.name
              }}<span v-if="profile.open" class="action-menu-mark" aria-hidden="true">Open</span>
            </button>
          </div>
          <button
            v-if="frame.editable"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="btn"
            data-edit-open-profile
            @click="editOpen"
          >
            Edit settings
          </button>
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="btn"
            data-switch-page="profiles"
            @click="go('profiles')"
          >
            All saves & profiles
          </button>
          <button
            v-if="browserMode"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="btn"
            data-switch-page="backup"
            @click="go('backup')"
          >
            Backup
          </button>
          <template v-else>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              data-switch-page="account"
              @click="go('account')"
            >
              {{ frame.accountsEnabled ? 'Account' : 'Set up user accounts' }}
            </button>
            <button
              v-if="frame.accountsEnabled"
              type="button"
              role="menuitem"
              tabindex="-1"
              class="btn"
              data-switch-logout
              @click="signOut"
            >
              Sign out
            </button>
          </template>
        </ActionMenu>
      </div>
    </aside>
    <div>
      <header class="topbar">
        <div class="topbar-lead">
          <button
            ref="toggle"
            type="button"
            class="btn menu-toggle"
            aria-label="Menu"
            aria-controls="sidebar"
            :aria-expanded="menuOpen ? 'true' : 'false'"
            data-menu-toggle
            @click="menuOpen ? closeMenu() : openMenu()"
          >
            <span aria-hidden="true">☰</span></button
          ><img class="topbar-mark" src="./favicon.svg" alt="" />
        </div>
        <div class="breadcrumbs">
          <a href="#profiles" class="crumb-save" :title="frame.saveName">{{ frame.saveName }}</a
          ><template v-if="frame.profileName"
            ><span class="crumb-sep" aria-hidden="true">/</span
            ><a
              href="#profiles"
              class="crumb-profile"
              :title="frame.profileName"
              data-crumb-profile
              >{{ frame.profileName }}</a
            ></template
          >
        </div>
        <div class="topbar-tools">
          <!-- Before the track, so the track does not move under the pointer when it appears. -->
          <button
            v-if="frame.canPickPhase && frame.picker.elsewhere"
            type="button"
            class="btn work-on-phase"
            :aria-disabled="committing || undefined"
            data-work-on-phase
            @click="workOnShown"
          >
            Work on {{ frame.phaseLabel }}
          </button>
          <div
            class="phase-track"
            role="tablist"
            :aria-label="frame.picker.name"
            data-phase-track
            @keydown="trackKey"
          >
            <button
              v-for="segment in frame.track"
              :key="segment.phase"
              type="button"
              role="tab"
              aria-controls="main"
              :aria-selected="segment.phase === frame.phase ? 'true' : 'false'"
              :tabindex="segment.phase === frame.phase ? 0 : -1"
              :class="[
                'phase-track-seg',
                segment.phase === frame.phase ? 'current' : '',
                frame.canPickPhase && segment.phase === frame.picker.working ? 'working' : '',
              ]"
              :data-phase-seg="segment.phase"
              :disabled="!frame.canPickPhase"
              @click="showPhase(segment.phase)"
            >
              <span class="phase-track-name">{{ segment.label }}</span
              ><span v-if="segment.pct !== null" class="visually-hidden"
                >, {{ segment.pct }}% done</span
              ><span
                v-if="frame.canPickPhase && segment.phase === frame.picker.working"
                class="visually-hidden"
                data-working-phase
                >, working phase</span
              ><span v-if="segment.pct !== null" class="phase-track-bar" aria-hidden="true"
                ><span :style="{ width: segment.pct + '%' }"></span
              ></span>
            </button>
          </div>
          <label class="small phase-select"
            ><span data-phase-picker-label>{{ frame.picker.label }}</span>
            <select
              id="phase-picker"
              :aria-label="frame.picker.name"
              :disabled="!frame.canPickPhase"
              :value="frame.phase"
              @change="pickPhase"
            >
              <option v-for="[value, label] in frame.phases" :key="value" :value="value">
                {{ label }}
              </option>
            </select></label
          >
          <div :class="['save-status', frame.notSaved ? 'is-not-saved' : '']">
            <span v-if="frame.hasSave" class="dot" aria-hidden="true"></span
            ><span class="save-label"
              ><span id="saved-short" role="status" aria-live="polite">{{ frame.savedShort }}</span
              ><span aria-hidden="true">{{ savedShortWidest }}</span></span
            >
          </div>
        </div>
      </header>
      <GroupMovedNotice />
      <main id="main" class="workspace" tabindex="-1"></main>
    </div>
  </div>
</template>
