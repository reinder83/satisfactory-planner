<!--
  The page frame: sidebar navigation, ADA, save status, profile footer, and the top bar with
  breadcrumbs and the phase picker. The current page is drawn into the empty <main> by
  render() in shell.ts until each page becomes a component of its own.
-->
<script setup lang="ts">
import { computed } from 'vue';
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
} from '../session.ts';
import type { Phase } from '../../types/index.ts';
import { render } from '../shell.ts';
import AdaPanel from './AdaPanel.vue';
import { legacy } from './bridge.ts';

// The sidebar's navigation: route, icon, label.
const NAV: [id: string, icon: string, label: string][] = [
  ['plan', '◫', 'Build plan'],
  ['factories', '▥', 'Factories'],
  ['logistics', '⇄', 'Logistics'],
  ['storage', '▦', 'Storage room'],
  ['resources', '↗', 'Power & resources'],
  ['backup', '⇅', 'Backup & notes'],
];

const frame = computed(() =>
  legacy(() => ({
    view,
    saveName: currentSave.name,
    canPickPhase: !!currentSave.id,
    phase: phase(),
    phases: phaseOptions().map(p => [p, phaseLabel(p)]),
    saved: pending ? 'Saving…' : browserMode ? 'Saved in this browser' : 'Saved on server',
    savedShort: pending ? 'Saving…' : browserMode ? 'Saved in browser' : 'Saved',
    footer: profileFooter(),
  })),
);

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
async function pickPhase(e: Event) {
  const el = e.target as HTMLSelectElement;
  if (!allowSwitch()) {
    el.value = phase();
    return;
  }
  el.disabled = true;
  try {
    // The options are phaseOptions(), so the value is a phase.
    await save({ type: 'phase', value: el.value as Phase });
    setQuery('');
    render();
  } catch {
    el.value = phase();
  } finally {
    el.disabled = false;
  }
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <img src="./favicon.svg" alt="" />
        <div>
          Project Assembly
          <div class="eyebrow">FICSIT compliance terminal</div>
        </div>
      </div>
      <nav class="nav" aria-label="Main navigation">
        <a
          v-for="[id, icon, label] in NAV"
          :key="id"
          :href="'#' + id"
          :class="frame.view === id ? 'active' : ''"
          :aria-current="frame.view === id ? 'page' : undefined"
          ><span class="navicon" aria-hidden="true">{{ icon }}</span
          >{{ label }}</a
        >
      </nav>
      <AdaPanel />
      <div class="save-status">
        <span class="dot" aria-hidden="true"></span
        ><span id="saved" role="status" aria-live="polite">{{ frame.saved }}</span>
      </div>
      <div class="sidebar-foot">
        <template v-for="(line, i) in frame.footer" :key="i"><br v-if="i" />{{ line }}</template>
      </div>
    </aside>
    <div>
      <header class="topbar">
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
