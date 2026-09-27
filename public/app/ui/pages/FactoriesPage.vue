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
  sectionCollapsed,
  setQuery,
  stage,
} from '../../session.ts';
import { render } from '../../shell.ts';
import {
  factoryGroupsState,
  filterEmptyText,
  groupJumps,
  jumpEntry,
  membershipsOf,
  statusFilter,
} from '../../views/factories.ts';
import { inputText } from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import CollapseToggle from '../factories/CollapseToggle.vue';
import EditGroupsToggle from '../factories/EditGroupsToggle.vue';
import FactoryCard from '../factories/FactoryCard.vue';
import GroupEditPanel from '../factories/GroupEditPanel.vue';
import GroupSections from '../factories/GroupSections.vue';
import FilterChips from '../factories/FilterChips.vue';
import JumpBar from '../factories/JumpBar.vue';
import PageHeader from '../PageHeader.vue';
import { pickFactoryFilter, toggleCheck } from '../actions.ts';
import type { HandbookFactory } from '../../../types/index.ts';

// Which shared site a factory is drawn under; null means a card of its own.
const siteOf = (f: HandbookFactory) =>
  ['Plastic', 'Rubber'].includes(f.name) ? 'oil' : f.nuclear ? 'nuclear' : null;

// null for a stage the handbook has no plan for (Phase 1 or 2, which only a calculated profile
// can be at, or any phase of the browser edition's empty handbook): until render() swaps this
// page out, it draws nothing rather than throwing (#356).
const page = computed(() =>
  legacy(() => {
    const p = plan.plans[stage()];
    if (!p) return null;
    const running = (f: HandbookFactory) => checked('factory-' + stage() + '-' + f.id);
    // Factories at this stage that match the search text, then those the status chip keeps. The
    // chips count what the search found.
    const found = plan.factories
      .filter(f => f.stages[stage()])
      .filter(f =>
        // The filter above keeps only factories with this stage.
        (f.name + ' ' + f.stages[stage()]!.recipe).toLowerCase().includes(query.toLowerCase()),
      );
    const status = statusFilter(found, factoryFilter, running, [['local', f => !!f.local]]);
    const list = status.list;
    const ungrouped = list.filter(f => !membershipsOf(f.id).length);
    const site = (kind: 'oil' | 'nuclear', label: string, sub: string) => {
      const members = ungrouped.filter(f => siteOf(f) === kind);
      const key = 'site-' + kind;
      // The jump bar counts what the search found at the site, whatever the chip keeps.
      const atSite = found.filter(f => !membershipsOf(f.id).length && siteOf(f) === kind);
      return members.length
        ? {
            kind,
            key,
            label,
            sub,
            members,
            collapsed: sectionCollapsed(key),
            jump: jumpEntry(key, label, atSite, running),
          }
        : null;
    };
    const sites = [
      site(
        'oil',
        'Oil campus',
        `One shared machine set produces these outputs together: ${num(p.oil.reduce((a, x) => a + x.machines, 0))} buildings · crude ${num(p.oilTotals.crude)}/min · water ${num(p.oilTotals.water)}/min. Open a card for the shared recipe table.`,
      ),
      site(
        'nuclear',
        'Nuclear site',
        'Build and balance this radioactive chain as one site at the power plants. Process buffers stay here; the general storage surplus does not apply.',
      ),
    ].filter(s => s !== null);
    const singles = ungrouped.filter(f => !siteOf(f));
    // Whether any group section shows: an empty group only shows while editing.
    const groupsShown = factoryGroupsState().groups.some(
      gr => factoryEditing || list.some(f => membershipsOf(f.id).some(m => m.group === gr.id)),
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
      completion:
        phase() === 'post'
          ? plan.completion
              .filter(r => r.name.toLowerCase().includes(query.toLowerCase()))
              .map(r => ({
                ...r,
                check: 'completion-' + r.id,
                done: checked('completion-' + r.id),
                // The last machine is only named when it runs below 100%.
                line:
                  `${num(r.output)}/min · ${num(r.machines)} ${r.machine}` +
                  ((r.lastClock ?? 100) < 100 ? ` · last at ${num(r.lastClock)}%` : ''),
                inputText: inputText(r.inputs),
                byproducts: Object.keys(r.byproducts).length ? inputText(r.byproducts) : '',
              }))
          : [],
    };
  }),
);

function search(e: Event) {
  setQuery((e.target as HTMLInputElement).value);
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
        @pick="v => pickFactoryFilter(v)"
      /><span class="small muted">{{ page.list.length }} targets</span><EditGroupsToggle />
    </div>
    <JumpBar :entries="page.jumps" />
    <GroupEditPanel v-if="page.editing" />
    <GroupSections :items="page.list" :key-of="f => f.id">
      <template #card="{ item, group }"><FactoryCard :factory="item" :group="group" /></template>
    </GroupSections>
    <section
      v-for="s in page.sites"
      :id="'section-' + s.key"
      :key="s.kind"
      :class="['site-group', s.collapsed ? 'collapsed' : '']"
    >
      <header class="site-head">
        <div class="site-title">
          <CollapseToggle :section-key="s.key" :label="'Outputs of ' + s.label" />
          <div>
            <span class="eyebrow">SHARED SITE · {{ s.members.length }} OUTPUTS</span>
            <h2 tabindex="-1" data-section-heading>{{ s.label }}</h2>
          </div>
        </div>
        <p class="small muted">{{ s.sub }}</p>
      </header>
      <div v-show="!s.collapsed" :id="'cards-' + s.key" class="cards">
        <FactoryCard v-for="f in s.members" :key="f.id" :factory="f" />
      </div>
    </section>
    <p v-if="page.label" class="eyebrow">UNGROUPED FACTORIES</p>
    <div class="cards">
      <template v-if="page.singles.length"
        ><FactoryCard v-for="f in page.singles" :key="f.id" :factory="f"
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
    <section v-if="page.post" style="margin-top: 32px">
      <h2>Additional completion modules</h2>
      <div class="notice info">
        These recipe inputs are additional to the main resource budget. Allocate their supply first.
        Gathered feedstock and byproducts still need handling.
      </div>
      <div class="completion-grid">
        <article v-for="r in page.completion" :key="r.id" class="completion-item">
          <label class="check-row"
            ><input
              type="checkbox"
              :data-check="r.check"
              @change="toggleCheck"
              :checked="r.done"
            /><strong>{{ r.name }}</strong></label
          >
          <p>{{ r.line }}<br />{{ r.recipe }}</p>
          <p>
            <b>Inputs:</b> {{ r.inputText
            }}<template v-if="r.byproducts"><br /><b>Byproducts:</b> {{ r.byproducts }}</template>
          </p>
        </article>
      </div>
    </section>
  </template>
</template>
