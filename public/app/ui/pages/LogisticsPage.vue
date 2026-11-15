<!--
  #logistics (#229): what moves between a calculated profile's factory groups in the current
  phase, and by which belt, pipe or vehicle, and the trains (#1284). Two tabs under the header
  (#1295), the build plan's tab pattern (CalculatedPlanPage.vue: a WAI-ARIA tab list, the arrow
  keys, Home and End move and open, only the open tab in the Tab order, each panel labelled by
  its tab):
  - Between factories: GroupLinks.vue (which used to sit at the foot of the calculated factories
    page). A phase without production lines, or a profile without groups, has nothing between
    them yet: each gets a short explanation with the way forward instead of an empty page. A
    milestone-only phase (#759) says why with MilestoneOnlyNotice.vue and its "Go to Phase N", as
    the Factories page does.
  - Trains, in every phase (stations and lines are not tied to a phase): "Create stations from
    train links" (ui/factories/TrainsFromLinks.vue, #1301), the train stations and
    their platforms (ui/factories/TrainStations.vue), the lines with their trains, what each
    wagon carries and the checks (ui/factories/TrainLines.vue) and the network diagram
    (ui/factories/TrainDiagram.vue).
  The open tab is remembered in this browser (logisticsTab in session.ts), so coming back opens
  it again; the subtitle follows the tab. With no calculated plan open (only while render() swaps
  the page after leaving a profile) it draws its header alone.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  calcStage,
  calculated,
  logisticsTab,
  milestoneOnly,
  phaseLabel,
  phase,
  setLogisticsTab,
  type LogisticsTab,
} from '../../session.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import GroupLinks from '../factories/GroupLinks.vue';
import TrainDiagram from '../factories/TrainDiagram.vue';
import TrainLines from '../factories/TrainLines.vue';
import TrainStations from '../factories/TrainStations.vue';
import TrainsFromLinks from '../factories/TrainsFromLinks.vue';
import { state } from '../../session.ts';
import EmptyGuide from '../EmptyGuide.vue';
import PageHeader from '../PageHeader.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';
import { tabKeyTarget } from '../plan/plan-tabs.ts';

const page = computed(() =>
  legacy(() => ({
    calculated: !!calculated,
    milestones: !!calculated && milestoneOnly(),
    rows: !!calcStage()?.rows?.length,
    groups: calculated ? factoryGroupsState().groups.length : 0,
    phase: phaseLabel(phase()),
    // No train station and no train line: the Trains tab has nothing yet (X-7).
    noTrains: !state.trainStations?.length && !state.trainLines?.length,
  })),
);

const TABS: readonly (readonly [LogisticsTab, string])[] = [
  ['links', 'Between factories'],
  ['trains', 'Trains'],
];
// The open tab, as remembered in this browser.
const active = ref<LogisticsTab>(logisticsTab);
function openTab(tab: LogisticsTab) {
  active.value = tab;
  setLogisticsTab(tab);
}
// "Open Between factories" in the Trains tab's empty guide: the tab opens and takes focus.
function showLinks() {
  openTab('links');
  void nextTick(() =>
    document.querySelector<HTMLButtonElement>('[data-logistics-tab="links"]')?.focus(),
  );
}
// Arrow keys, Home and End move between the tabs and open the one they reach.
function tabKey(event: KeyboardEvent) {
  const at = TABS.findIndex(([id]) => id === active.value);
  const next = tabKeyTarget(event.key, at, TABS.length);
  if (next === null) return;
  event.preventDefault();
  const target = TABS[next]![0]; // tabKeyTarget stays inside the list
  openTab(target);
  void nextTick(() =>
    document.querySelector<HTMLButtonElement>(`[data-logistics-tab="${target}"]`)?.focus(),
  );
}
const panelAttrs = (tab: LogisticsTab) => ({
  id: 'logistics-panel-' + tab,
  role: 'tabpanel',
  'aria-labelledby': 'logistics-tab-' + tab,
  tabindex: 0,
  hidden: active.value !== tab || undefined,
});
// The small line over the title names the open tab's subject (#1280).
const eyebrow = computed(() => (active.value === 'trains' ? 'TRAINS' : 'BETWEEN FACTORIES'));
const subtitle = computed(() => {
  if (!page.value.calculated) return '';
  if (active.value === 'trains')
    return 'Your train stations and the lines between them: what each wagon carries, and what to check.';
  return page.value.milestones
    ? ''
    : `What each factory sends the others in ${page.value.phase}, and the belts, pipes or vehicles it takes.`;
});
</script>

<template>
  <PageHeader :eyebrow="eyebrow" title="Logistics" :subtitle="subtitle" />
  <template v-if="page.calculated">
    <div
      class="tabs logistics-tabs"
      role="tablist"
      aria-label="Logistics"
      data-logistics-tabs
      @keydown="tabKey"
    >
      <button
        v-for="[id, label] in TABS"
        :id="'logistics-tab-' + id"
        :key="id"
        type="button"
        role="tab"
        :class="['tab', id === active ? 'active' : '']"
        :aria-selected="id === active ? 'true' : 'false'"
        :aria-controls="'logistics-panel-' + id"
        :tabindex="id === active ? 0 : -1"
        :data-logistics-tab="id"
        @click="openTab(id)"
      >
        {{ label }}
      </button>
    </div>
    <div v-bind="panelAttrs('links')" data-logistics-panel="links">
      <template v-if="page.milestones">
        <MilestoneOnlyNotice />
        <EmptyGuide page="logistics" title="What will appear here">
          <p class="small">
            What each factory sends the others, and by which belt, pipe or vehicle, once your
            production lines are sorted into factories. This phase builds no production lines, so
            nothing moves yet.
          </p>
          <template #links
            ><a href="#factories" data-empty-link>Open Factories</a>, where the lines are sorted
            into factories.</template
          >
        </EmptyGuide>
      </template>
      <div v-else-if="!page.rows" class="notice info" data-logistics-empty="phase">
        This phase has no production lines, so nothing moves between factories yet.
      </div>
      <div v-else-if="!page.groups" class="notice info" data-logistics-empty="groups">
        Nothing to show until the production lines are in factories.
        <a href="#factories">Sort them into factories on the Factories page</a>, and what each
        factory sends the others appears here.
      </div>
      <GroupLinks v-else />
    </div>
    <div v-bind="panelAttrs('trains')" data-logistics-panel="trains">
      <EmptyGuide v-if="page.noTrains" page="trains" title="What will appear here">
        <p class="small">
          Your train stations with their platforms, your train lines with what each wagon carries,
          and what to check on them. A link you set to go by train on Between factories can propose
          them for you; you can also add each one below.
        </p>
        <template #links
          ><button type="button" class="btn" data-empty-link @click="showLinks">
            Open Between factories
          </button></template
        >
      </EmptyGuide>
      <TrainsFromLinks />
      <TrainStations />
      <TrainLines />
      <!-- Drawn while its tab is open: the pan and zoom measure the box it scrolls in. -->
      <TrainDiagram v-if="active === 'trains'" />
    </div>
  </template>
</template>
