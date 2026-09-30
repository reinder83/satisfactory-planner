<!--
  #factories for the original handbook at the current stage, filtered by the step search
  (view state `query`) and the status chips (`factoryFilter`, FilterChips.vue; Local is this
  page's own chip). A factory in a user group is drawn there only; the rest go under the shared
  sites (Plastic and Rubber out of one oil campus, nuclear factories at the nuclear site), then
  as single cards. When nothing is left, it says why and offers All back. Post-game adds the
  completion modules, whose boxes write `completion-<id>` checks. A calculated profile gets
  CalculatedFactoriesPage.vue instead.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import {
  checked,
  factoryEditing,
  factoryFilter,
  phase,
  plan,
  query,
  setQuery,
  stage,
} from '../../session.ts';
import { render } from '../../shell.ts';
import {
  factoryGroupsState,
  filterEmptyText,
  groupJumps,
  completionView,
  membershipsOf,
  siteEntry,
  statusFilter,
} from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import CompletionModules from '../factories/CompletionModules.vue';
import EditGroupsToggle from '../factories/EditGroupsToggle.vue';
import GroupEditBar from '../factories/GroupEditBar.vue';
import FactoryCard from '../factories/FactoryCard.vue';
import GroupEditPanel from '../factories/GroupEditPanel.vue';
import SiteSection from '../factories/SiteSection.vue';
import GroupSections from '../factories/GroupSections.vue';
import FilterChips from '../factories/FilterChips.vue';
import JumpBar from '../factories/JumpBar.vue';
import PageHeader from '../PageHeader.vue';
import { pickFactoryFilter } from '../actions.ts';
import type { HandbookFactory } from '../../../types/index.ts';

// Which shared site a factory is drawn under; null means a card of its own.
const siteOf = (factory: HandbookFactory) =>
  ['Plastic', 'Rubber'].includes(factory.name) ? 'oil' : factory.nuclear ? 'nuclear' : null;

// null for a stage the handbook has no plan for (Phase 1 or 2, which only a calculated profile
// can be at, or any phase of the browser edition's empty handbook): until render() swaps this
// page out, it draws nothing rather than throwing (#356).
const page = computed(() =>
  legacy(() => {
    const stagePlan = plan.plans[stage()];
    if (!stagePlan) return null;
    const running = (factory: HandbookFactory) => checked('factory-' + stage() + '-' + factory.id);
    // Factories at this stage that match the search text, then those the status chip keeps. The
    // chips count what the search found.
    const found = plan.factories
      .filter(f => f.stages[stage()])
      .filter(factory =>
        // The filter above keeps only factories with this stage.
        (factory.name + ' ' + factory.stages[stage()]!.recipe)
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
    const status = statusFilter(found, factoryFilter, running, [['local', f => !!f.local]]);
    const list = status.list;
    const ungrouped = list.filter(f => !membershipsOf(f.id).length);
    const site = (kind: 'oil' | 'nuclear', sub: string) =>
      siteEntry(
        kind,
        sub,
        ungrouped.filter(f => siteOf(f) === kind),
        found.filter(f => !membershipsOf(f.id).length && siteOf(f) === kind),
        running,
      );
    const sites = [
      site(
        'oil',
        `One shared machine set produces these outputs together: ${num(stagePlan.oil.reduce((total, line) => total + line.machines, 0))} buildings · crude ${num(stagePlan.oilTotals.crude)}/min · water ${num(stagePlan.oilTotals.water)}/min. Open a card for the shared recipe table.`,
      ),
      site(
        'nuclear',
        'Build and balance this radioactive chain as one site at the power plants. Process buffers stay here; the general storage surplus does not apply.',
      ),
    ].filter(s => s !== null);
    const singles = ungrouped.filter(f => !siteOf(f));
    // Whether any group section shows: an empty group only shows while editing.
    const groupsShown = factoryGroupsState().groups.some(
      group =>
        factoryEditing || list.some(f => membershipsOf(f.id).some(m => m.group === group.id)),
    );
    return {
      post: phase() === 'post',
      query,
      chips: status.chips,
      active: status.active,
      // Groups first, then the shared sites, as the page draws them.
      jumps: [
        ...groupJumps(found, list, f => f.id, running, factoryEditing),
        ...sites.map(s => s.jump),
      ],
      empty: filterEmptyText('factories', status.active, query),
      editing: factoryEditing,
      list,
      sites,
      singles,
      label: (groupsShown || sites.length > 0) && singles.length > 0,
      completion: phase() === 'post' ? completionView(plan.completion, query) : [],
    };
  }),
);

function search(event: Event) {
  setQuery((event.target as HTMLInputElement).value);
  render();
}
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="PRODUCTION LIBRARY"
      title="Factory targets"
      subtitle="Outputs include downstream supply, protected storage and elevator exports. Click a factory for its inputs and expansion history."
    />
    <GroupEditBar />
    <div v-if="page.post" class="notice info">
      These are retained Phase 5 capacities, not mandatory post-game output rates. Give new storage
      items priority before committing all spare output to sinks.
    </div>
    <div class="toolbar">
      <input
        id="factory-search"
        class="search"
        placeholder="Find a part or recipe…"
        aria-label="Find a factory"
        :value="page.query"
        @input="search"
      /><FilterChips
        :chips="page.chips"
        :active="page.active.value"
        @pick="value => pickFactoryFilter(value)"
      /><span class="small muted">{{ page.list.length }} targets</span><EditGroupsToggle />
    </div>
    <JumpBar :entries="page.jumps" />
    <GroupEditPanel v-if="page.editing" />
    <GroupSections :items="page.list" :key-of="f => f.id">
      <template #card="{ item, group }"><FactoryCard :factory="item" :group="group" /></template>
    </GroupSections>
    <SiteSection v-for="site in page.sites" :key="site.kind" :site="site"
      ><FactoryCard v-for="factory in site.members" :key="factory.id" :factory="factory"
    /></SiteSection>
    <p v-if="page.label" class="eyebrow">UNGROUPED FACTORIES</p>
    <div class="cards">
      <template v-if="page.singles.length"
        ><FactoryCard v-for="factory in page.singles" :key="factory.id" :factory="factory"
      /></template>
      <div v-else-if="!page.list.length" class="empty-state" data-filter-empty>
        {{ page.empty }}
        <button
          v-if="page.active.value !== 'all'"
          class="btn"
          data-show-all
          @click="pickFactoryFilter('all', true)"
        >
          Show all factories
        </button>
      </div>
    </div>
    <CompletionModules v-if="page.post" :modules="page.completion" />
  </template>
</template>
