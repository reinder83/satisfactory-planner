<!--
  The page frame: sidebar navigation, ADA, save status, the profile switcher, and the top bar
  with breadcrumbs and the phase picker. The current page is drawn into the empty <main> by
  render() in shell.ts.

  The profile switcher (SP-07, #242) is the sidebar footer as a menu button (ui/ActionMenu.vue):
  the open profile's name and settings lines on the button, and in its menu the open save's
  profiles, "All saves & profiles", then "Account" and "Sign out" on the server or "Backups &
  transfer" in the browser edition. A profile opens through openProfile in ui/actions.ts, the
  profiles page's Open, so it asks about unsaved notes first; signing out is the account page's
  signOut. The pages go through the address, as a sidebar link does, so the hash route asks too.
  Focus stays on the switcher after its choice, as it does on a followed sidebar link (the frame
  stays).

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
  setQuery,
  view,
  workspace,
} from '../session.ts';
import type { View } from '../session.ts';
import type { Phase } from '../../types/index.ts';
import { render } from '../shell.ts';
import { factoryGroupsState } from '../views/factories.ts';
import AdaPanel from './AdaPanel.vue';
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
          ? 'needs factory groups'
          : '',
    } as Record<string, string>,
    saveName: currentSave.name,
    canPickPhase: !!currentSave.id,
    phase: phase(),
    phases: phaseOptions().map(p => [p, phaseLabel(p)]),
    saved: pending ? 'Saving…' : browserMode ? 'Saved in this browser' : 'Saved on server',
    savedShort: pending ? 'Saving…' : browserMode ? 'Saved in browser' : 'Saved',
    footer: profileFooter(),
    // The open save's profiles, for the switcher. A signed-out workspace has no saves, and the
    // frame may redraw once more before the sign-in screen replaces it.
    profiles: (workspace.saves?.find(s => s.id === currentSave.id)?.profiles ?? []).map(p => ({
      id: p.id,
      name: p.name,
      open: p.id === currentProfile?.id,
    })),
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
const go = (v: View) => {
  closeMenu(false);
  location.hash = v;
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
function drawerKey(e: KeyboardEvent) {
  if (!menuOpen.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeMenu();
  } else if (e.key === 'Tab') {
    const all = focusable();
    if (!all.length) return;
    const first = all[0]!,
      last = all.at(-1)!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
// A navigation link followed from the drawer: close it. The link is then hidden, so it lets go
// of focus and the page it opens takes it (focusOpenedPage in ui/refocus.ts); the page already
// shown opens nothing, so focus goes back to ☰ instead.
function navFollowed(e: Event) {
  if (!menuOpen.value) return;
  const link = e.currentTarget as HTMLAnchorElement;
  const same = link.getAttribute('href') === location.hash;
  closeMenu(same);
  if (!same) link.blur();
}
// Widening past the phone layout shows the sidebar again, so the drawer closes.
let wide: MediaQueryList | undefined;
const widened = (e: MediaQueryListEvent) => {
  if (e.matches) closeMenu(false);
};
onMounted(() => {
  wide = globalThis.matchMedia?.('(min-width: 721px)');
  wide?.addEventListener?.('change', widened);
});
onBeforeUnmount(() => wide?.removeEventListener?.('change', widened));

// The top bar's short save status (shown at phone width, where the sidebar's is hidden)
// reserves the width of its longest label in this edition, so it never shifts the bar.
const savedShortWidest = browserMode ? 'Saved in browser' : 'Saving…';

// The sidebar footer: the open profile's name and the game settings it was planned for, as
// lines. The original handbook's settings are fixed, so they are written out.
function profileFooter() {
  if (calculated) {
    const s = calculated.settings;
    const date = new Date(calculated.createdAt);
    const purity = purities.find(([id]) => id === s.purity)?.[1] || s.purity;
    return [
      currentProfile.name,
      `${purity} purity · ${num(s.multiplier)}× elevator parts`,
      `${num(s.powerFactor)}× power consumption`,
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
  if (currentProfile?.kind === 'original')
    return [
      currentProfile.name,
      'Pure nodes · 50× elevator parts',
      'Half power consumption',
      'Plan revised 13 September 2026',
    ];
  return ['Create or select a profile'];
}

// The "Working on" select: save the profile's selected phase, clear the search and redraw;
// on failure it shows the saved phase again. The redraw shows the new phase's notes, so an
// unsaved note is asked about first; kept, the select goes back to the saved phase.
// Busy while it saves (app/busy.ts, #299): a key pressed on it meanwhile shows the saved phase again.
async function pickPhase(e: Event) {
  const el = e.target as HTMLSelectElement;
  if (isBusy(el) || !(await allowSwitch())) {
    el.value = phase();
    return;
  }
  await whileBusy(el, async () => {
    try {
      // The options are phaseOptions(), so the value is a phase.
      await save({ type: 'phase', value: el.value as Phase });
      setQuery('');
      render();
    } catch {
      el.value = phase();
    }
  });
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
        <span class="dot" aria-hidden="true"></span
        ><span id="saved" role="status" aria-live="polite">{{ frame.saved }}</span>
      </div>
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
            ><template v-for="(line, i) in frame.footer" :key="i"
              ><br v-if="i" />{{ line }}</template
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
              v-for="p in frame.profiles"
              :key="p.id"
              type="button"
              role="menuitemradio"
              tabindex="-1"
              class="btn"
              :aria-checked="p.open ? 'true' : 'false'"
              :data-switch-profile="p.id"
              @click="switchTo(p.id, p.open)"
            >
              {{ p.name
              }}<span v-if="p.open" class="action-menu-mark" aria-hidden="true">Open</span>
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
            Backups & transfer
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
          <a href="#profiles">{{ frame.saveName }}</a> <span aria-hidden="true"> / </span>
          {{ phaseLabel(frame.phase) }}
        </div>
        <div class="topbar-tools">
          <label class="small"
            >Working on
            <select
              id="phase-picker"
              aria-label="Working phase"
              :disabled="!frame.canPickPhase"
              :value="frame.phase"
              @change="pickPhase"
            >
              <option v-for="[p, label] in frame.phases" :key="p" :value="p">{{ label }}</option>
            </select></label
          >
          <div class="save-status">
            <span class="dot" aria-hidden="true"></span
            ><span class="save-label"
              ><span id="saved-short" role="status" aria-live="polite">{{ frame.savedShort }}</span
              ><span aria-hidden="true">{{ savedShortWidest }}</span></span
            >
          </div>
        </div>
      </header>
      <main id="main" class="workspace" tabindex="-1"></main>
    </div>
  </div>
</template>
