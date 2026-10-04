<!--
  The page frame: sidebar navigation, ADA, save status, the profile switcher, and the top bar
  with the breadcrumb (the save) and the phase picker. The current page is drawn into the empty
  <main> by render() in shell.ts.

  The phase picker is a phase track (SP-44, #279): one segment per phase, each with its
  checklist's progress (views/phase-track.ts), as a group of radio buttons named "Working
  phase", so the arrow keys move between phases and a click switches, saved and guarded as the
  select is. At 720px and below the track gives way to the select, which is always there.

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
import { allowSwitch, pending, save } from '../api.ts';
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
import { isBusy, whileBusy } from '../busy.ts';
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
    canPickPhase: !!currentSave.id,
    phase: phase(),
    phases: phaseOptions().map(p => [p, phaseLabel(p)]),
    track: phaseTrack(),
    // With no save open (an empty workspace, #281) nothing has been saved, so the status never
    // claims it, and its dot, which marks a save, is left out.
    hasSave: !!currentSave.id,
    saved: pending
      ? 'Saving…'
      : !currentSave.id
        ? 'Nothing saved yet'
        : browserMode
          ? 'Saved in this browser'
          : 'Saved on server',
    savedShort: pending
      ? 'Saving…'
      : !currentSave.id
        ? 'No save yet'
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

// The "Working on" select: save the profile's selected phase, show it rather than the phase the
// profile opened on (#570), clear the search and redraw;
// on failure it shows the saved phase again. The redraw shows the new phase's notes, so an
// unsaved note is asked about first; kept, the select goes back to the saved phase.
// Busy while it saves (app/busy.ts, #299): a key pressed on it meanwhile shows the saved phase again.
async function pickPhase(event: Event) {
  const el = event.target as HTMLSelectElement;
  if (isBusy(el) || trackBusy.value || !(await allowSwitch())) {
    el.value = phase();
    return;
  }
  await whileBusy(el, async () => {
    try {
      // The options are phaseOptions(), so the value is a phase.
      await save({ type: 'phase', value: el.value as Phase });
      setOpenedPhase(null);
      setQuery('');
      render();
    } catch {
      el.value = phase();
    }
  });
}

// The phase track's radio buttons (SP-44): the same save, guard and redraw as the select. The
// arrow keys check the next radio at once, so while one switch saves, another is refused and
// the saved phase is checked again (the track is aria-busy meanwhile, like a busy select).
const trackBusy = ref(false);
function checkSavedPhase() {
  const saved = document.querySelector<HTMLInputElement>(
    `[data-phase-track] input[value="${phase()}"]`,
  );
  if (saved) saved.checked = true;
}
async function pickTrack(event: Event) {
  const el = event.target as HTMLInputElement;
  if (trackBusy.value || isBusy(document.querySelector('#phase-picker'))) return checkSavedPhase();
  trackBusy.value = true;
  try {
    if (!(await allowSwitch())) return checkSavedPhase();
    await save({ type: 'phase', value: el.value as Phase });
    setOpenedPhase(null);
    setQuery('');
    render();
  } catch {
    checkSavedPhase();
  } finally {
    trackBusy.value = false;
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
      <div class="save-status">
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
          <a href="#profiles" :title="frame.saveName">{{ frame.saveName }}</a>
        </div>
        <div class="topbar-tools">
          <div
            class="phase-track"
            role="radiogroup"
            aria-label="Working phase"
            :aria-busy="trackBusy || undefined"
            data-phase-track
          >
            <label
              v-for="segment in frame.track"
              :key="segment.phase"
              :class="['phase-track-seg', segment.phase === frame.phase ? 'current' : '']"
              :data-phase-seg="segment.phase"
              ><input
                type="radio"
                name="phase-track"
                :value="segment.phase"
                :checked="segment.phase === frame.phase"
                :disabled="!frame.canPickPhase"
                @change="pickTrack" /><span class="phase-track-name">{{ segment.label }}</span
              ><span v-if="segment.pct !== null" class="visually-hidden"
                >, {{ segment.pct }}% done</span
              ><span v-if="segment.pct !== null" class="phase-track-bar" aria-hidden="true"
                ><span :style="{ width: segment.pct + '%' }"></span></span
            ></label>
          </div>
          <label class="small phase-select"
            >Working on
            <select
              id="phase-picker"
              aria-label="Working phase"
              :disabled="!frame.canPickPhase"
              :value="frame.phase"
              @change="pickPhase"
            >
              <option v-for="[value, label] in frame.phases" :key="value" :value="value">
                {{ label }}
              </option>
            </select></label
          >
          <div class="save-status">
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
