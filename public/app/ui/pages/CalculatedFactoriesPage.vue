<!--
  #factories on a calculated profile: the rows of the current phase matching the search, user
  groups first, then the ungrouped rows. What moves between the groups has its own page,
  #logistics (LogisticsPage.vue, #229); a line under the rows points there.
  Without whole-machine production it offers "Round up production", which asks /api/round-up
  for a recalculated profile revision and opens it; the previous profile stays as it is.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { allowSwitch, post, toast, writeQueue } from '../../api.ts';
import {
  calcStage,
  calculated,
  factoryEditing,
  loadContext,
  query,
  setQuery,
  setWorkspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { calcProgress } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import CalcFactoryCard from '../factories/CalcFactoryCard.vue';
import EditGroupsToggle from '../factories/EditGroupsToggle.vue';
import GroupEditPanel from '../factories/GroupEditPanel.vue';
import GroupSections from '../factories/GroupSections.vue';
import PageHeader from '../PageHeader.vue';
import CalcWarnings from '../plan/CalcWarnings.vue';
import type { WorkspaceSummary } from '../../../types/index.ts';

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const rows = (calcStage()?.rows || []).filter(r =>
      (r.name + ' ' + Object.keys(r.outputs).join(' ')).toLowerCase().includes(query.toLowerCase()),
    );
    const ungrouped = rows.filter(r => !membershipsOf(r.id).length);
    // Whether any group section shows: an empty group only shows while editing.
    const groupsShown = factoryGroupsState().groups.some(
      gr => factoryEditing || rows.some(r => membershipsOf(r.id).some(m => m.group === gr.id)),
    );
    return {
      whole: calculated.settings.wholeMachines,
      query,
      editing: factoryEditing,
      rows,
      ungrouped,
      label: groupsShown && ungrouped.length > 0,
      // The profile has groups, so the Logistics page has something to show (#229).
      grouped: factoryGroupsState().groups.length > 0,
    };
  }),
);

function search(e: Event) {
  setQuery((e.target as HTMLInputElement).value);
  render();
}

// "Round up production": after the unsaved-notes check, create the rounded revision and open
// it. The button shows the calculation's progress meanwhile.
async function roundUp(e: Event) {
  const b = e.currentTarget as HTMLButtonElement;
  if (!allowSwitch()) return;
  b.disabled = true;
  try {
    await writeQueue;
    const r = await post<{
      workspace: WorkspaceSummary;
      saveId: string;
      profileId: string;
      reviewCount: number;
    }>('/api/round-up', {}, true, calcProgress(b, 'Recalculating…'));
    setWorkspace(r.workspace);
    await loadContext(r.saveId, r.profileId);
    render();
    toast(
      'Created rounded profile. ' +
        r.reviewCount +
        ' completed factory checks need review; previous progress is preserved.',
    );
  } catch (err) {
    toast((err as Error).message, true);
    b.disabled = false;
    b.textContent = 'Round up production';
  }
}
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="CALCULATED PRODUCTION"
      title="Factory targets"
      subtitle="Each recipe line includes its inputs, whole buildings and later expansion. Multiple recipes for a part can share one site."
    />
    <div v-if="!page.whole" class="notice blue">
      Prefer extra production over underclocking?
      <button class="btn primary" data-round-up @click="roundUp">Round up production</button>
      <p>
        Creates a recalculated profile revision. Your previous profile stays available; increased
        factory requirements are marked for review.
      </p>
    </div>
    <div v-else class="notice blue">
      Whole-machine production: protect downstream supply first, refill storage, then sink surplus
      solids. Liquid and nuclear balances remain controlled.
    </div>
    <CalcWarnings />
    <div class="toolbar">
      <input
        id="factory-search"
        class="search"
        aria-label="Find a factory"
        placeholder="Find a part or recipe…"
        :value="page.query"
        @input="search"
      /><span>{{ page.rows.length }} production lines</span><EditGroupsToggle />
    </div>
    <GroupEditPanel v-if="page.editing" />
    <GroupSections :items="page.rows" :key-of="r => r.id">
      <template #card="{ item, group }"><CalcFactoryCard :row="item" :group="group" /></template>
    </GroupSections>
    <p v-if="page.label" class="eyebrow">UNGROUPED PRODUCTION LINES</p>
    <div class="cards">
      <CalcFactoryCard v-for="r in page.ungrouped" :key="r.id" :row="r" />
    </div>
    <p v-if="page.grouped" class="small muted" data-logistics-link>
      What each group sends the others, and by which belt, pipe or vehicle, is on
      <a href="#logistics">Logistics</a>.
    </p>
  </template>
</template>
