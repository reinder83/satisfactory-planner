<!--
  The page frame: sidebar navigation, ADA, save status, profile footer, and the top bar with
  breadcrumbs and the phase picker. The current page is drawn into the empty <main> by
  render() in shell.js until each page becomes a component of its own.
-->
<script setup>
import { computed } from 'vue';
import { browserMode } from '../../browser-api.js';
import { purities } from '../../preferences.js';
import { pending, save } from '../api.js';
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
} from '../session.js';
import { render } from '../shell.js';
import AdaPanel from './AdaPanel.vue';
import { legacy } from './bridge.js';

// The sidebar's navigation: route, icon, label.
const NAV = [
  ['plan', '◫', 'Build plan'],
  ['factories', '▥', 'Factories'],
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
    footer: profileFooter(),
  })),
);

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
// on failure it shows the saved phase again. There is no unsaved-notes check, so an unsaved
// phase note edit is lost in the redraw.
async function pickPhase(e) {
  const el = e.target;
  el.disabled = true;
  try {
    await save({ type: 'phase', value: el.value });
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
          :aria-current="frame.view === id ? 'page' : null"
          ><span class="navicon" aria-hidden="true">{{ icon }}</span
          >{{ label }}</a
        >
      </nav>
      <AdaPanel />
      <div class="save-status">
        <span class="dot"></span><span id="saved">{{ frame.saved }}</span>
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
      </header>
      <main id="main" class="workspace" tabindex="-1"></main>
    </div>
  </div>
</template>
