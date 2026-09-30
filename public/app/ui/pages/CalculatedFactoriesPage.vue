<!--
  #factories on a calculated profile: the rows of the current phase matching the search and the
  status chips (`factoryFilter`, FilterChips.vue, shared with the handbook page; Held back is this
  page's own chip, a row ticked Running that a missing supplier holds back), user groups first,
  then a plan guide's shared sites (#468), then the ungrouped rows; Post Phase 5 adds a guide's
  completion modules. When nothing is left, it says why and offers All back. What moves between the groups has its own page,
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
  checked,
  factoryEditing,
  factoryFilter,
  loadContext,
  phase,
  query,
  setQuery,
  setWorkspace,
  stage,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { heldBack } from '../../views/calculated.ts';
import {
  completionView,
  factoryGroupsState,
  filterEmptyText,
  groupJumps,
  membershipsOf,
  siteEntry,
  statusFilter,
  type StatusFilter,
} from '../../views/factories.ts';
import { calcProgress } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { confirmAction } from '../confirm.ts';
import { refocusOnOpenedPage } from '../refocus.ts';
import { pickFactoryFilter } from '../actions.ts';
import CalcFactoryCard from '../factories/CalcFactoryCard.vue';
import CompletionModules from '../factories/CompletionModules.vue';
import EditGroupsToggle from '../factories/EditGroupsToggle.vue';
import GroupEditBar from '../factories/GroupEditBar.vue';
import GroupEditPanel from '../factories/GroupEditPanel.vue';
import GroupSections from '../factories/GroupSections.vue';
import FilterChips from '../factories/FilterChips.vue';
import JumpBar from '../factories/JumpBar.vue';
import PageHeader from '../PageHeader.vue';
import SiteSection from '../factories/SiteSection.vue';
import CalcWarnings from '../plan/CalcWarnings.vue';
import type { WorkspaceSummary } from '../../../types/index.ts';

// What a plan guide's shared sites say under their heading (#468).
const SITE_SUBS = {
  oil: 'These outputs share one oil campus: build its machines together and balance them as one site.',
  nuclear:
    'Build and balance this radioactive chain as one site at the power plants. Process buffers stay here; the general storage surplus does not apply.',
};

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    // The rows matching the search, then those the status chip keeps. The chips count what the
    // search found.
    const found = (calcStage()?.rows || []).filter(row =>
      (row.name + ' ' + Object.keys(row.outputs).join(' '))
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    const running = (row: (typeof found)[number]) => checked('calc-' + stage() + '-' + row.id);
    // A guide that builds some rows locally adds the handbook's Local chip (#478).
    const notes = calculated.guide?.factories || {};
    type Row = (typeof found)[number];
    const chips: [StatusFilter, (row: Row) => boolean][] = [['held', r => !!heldBack(r.id)]];
    if (Object.values(notes).some(note => note.local))
      chips.unshift(['local', r => !!notes[r.id]?.local]);
    const status = statusFilter(found, factoryFilter, running, chips);
    const rows = status.list;
    const ungrouped = rows.filter(r => !membershipsOf(r.id).length);
    // A plan guide (#393, #468) places some ungrouped rows at a shared site, drawn together as the
    // handbook drew its oil campus and nuclear site; the rest stay single cards.
    const guide = calculated.guide;
    const siteOf = (row: (typeof found)[number]) => guide?.factories?.[row.id]?.site ?? null;
    const sites = (['oil', 'nuclear'] as const)
      .map(kind =>
        siteEntry(
          kind,
          SITE_SUBS[kind],
          ungrouped.filter(r => siteOf(r) === kind),
          found.filter(r => !membershipsOf(r.id).length && siteOf(r) === kind),
          running,
        ),
      )
      .filter(site => site !== null);
    const singles = ungrouped.filter(r => !siteOf(r));
    // Post Phase 5 adds a guide's completion modules, as the handbook page did.
    const post = phase() === 'post' && !!guide?.completion?.length;
    // Whether any group section shows: an empty group only shows while editing.
    const groupsShown = factoryGroupsState().groups.some(
      group =>
        factoryEditing || rows.some(r => membershipsOf(r.id).some(m => m.group === group.id)),
    );
    return {
      whole: calculated.settings.wholeMachines,
      query,
      chips: status.chips,
      active: status.active,
      // Groups first, then the shared sites, as the page draws them.
      jumps: [
        ...groupJumps(found, rows, r => r.id, running, factoryEditing),
        ...sites.map(site => site.jump),
      ],
      empty: filterEmptyText('production lines', status.active, query),
      editing: factoryEditing,
      rows,
      sites,
      singles,
      label: (groupsShown || sites.length > 0) && singles.length > 0,
      post,
      completion: post ? completionView(guide!.completion!, query) : [],
      // The profile has groups, so the Logistics page has something to show (#229).
      grouped: factoryGroupsState().groups.length > 0,
    };
  }),
);

function search(event: Event) {
  setQuery((event.target as HTMLInputElement).value);
  render();
}

// "Round up production": after the unsaved-notes check, create the rounded revision and open
// it. The button shows the calculation's progress meanwhile, busy (app/busy.ts) so it keeps
// focus (#299). The rounded profile's page has no such button, so focus then goes to its
// heading (refocusOnOpenedPage in ui/refocus.ts, #300, #304).
// "Round up production…" (SP-18): a one-line offer whose explanation is in the confirm dialog
// (ui/confirm.ts, SP-06); confirmed, the flow is as before.
async function roundUp(event: Event) {
  const button = event.currentTarget as HTMLButtonElement;
  if (isBusy(button)) return;
  const confirmed = await confirmAction({
    title: 'Round up production?',
    body:
      'Creates a recalculated profile revision that prefers extra production over underclocking. Your previous profile stays available; increased factory requirements are marked for review.' +
      // A transcribed handbook says so first (#480).
      (isTranscribed(calculated) ? ' ' + RESOLVE_WARNING : ''),
    confirmLabel: 'Round up production',
  });
  if (!confirmed || !(await allowSwitch())) return;
  const refocus = refocusOnOpenedPage(button);
  await whileBusy(button, async () => {
    try {
      await writeQueue;
      const reply = await post<{
        workspace: WorkspaceSummary;
        saveId: string;
        profileId: string;
        reviewCount: number;
      }>('/api/round-up', {}, true, calcProgress(button, 'Recalculating…'));
      setWorkspace(reply.workspace);
      await loadContext(reply.saveId, reply.profileId);
      render();
      toast(
        'Created rounded profile. ' +
          reply.reviewCount +
          ' completed factory checks need review; previous progress is preserved.',
      );
      void refocus();
    } catch (error) {
      toast((error as Error).message, true);
      button.textContent = 'Round up production…';
    }
  });
}
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="CALCULATED PRODUCTION"
      title="Factory targets"
      subtitle="Each recipe line includes its inputs, whole buildings and later expansion. Multiple recipes for a part can share one site."
    />
    <GroupEditBar />
    <div v-if="!page.whole" class="notice info round-up-offer">
      Prefer extra production over underclocking?
      <button class="btn quiet" data-round-up @click="roundUp">Round up production…</button>
    </div>
    <div v-else class="notice info">
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
      /><FilterChips
        :chips="page.chips"
        :active="page.active.value"
        @pick="value => pickFactoryFilter(value)"
      /><span>{{ page.rows.length }} production lines</span><EditGroupsToggle />
    </div>
    <JumpBar :entries="page.jumps" />
    <GroupEditPanel v-if="page.editing" />
    <GroupSections :items="page.rows" :key-of="r => r.id">
      <template #card="{ item, group }"><CalcFactoryCard :row="item" :group="group" /></template>
    </GroupSections>
    <SiteSection v-for="site in page.sites" :key="site.kind" :site="site"
      ><CalcFactoryCard v-for="row in site.members" :key="row.id" :row="row"
    /></SiteSection>
    <p v-if="page.label" class="eyebrow">UNGROUPED PRODUCTION LINES</p>
    <div class="cards">
      <CalcFactoryCard v-for="row in page.singles" :key="row.id" :row="row" />
      <div v-if="!page.rows.length" class="empty-state" data-filter-empty>
        {{ page.empty }}
        <button
          v-if="page.active.value !== 'all'"
          class="btn"
          data-show-all
          @click="pickFactoryFilter('all', true)"
        >
          Show all production lines
        </button>
      </div>
    </div>
    <CompletionModules v-if="page.post" :modules="page.completion" />
    <p v-if="page.grouped" class="small muted" data-logistics-link>
      What each group sends the others, and by which belt, pipe or vehicle, is on
      <a href="#logistics">Logistics</a>.
    </p>
  </template>
</template>
