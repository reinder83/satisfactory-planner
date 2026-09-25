<!--
  #factories for the original handbook at the current stage, filtered by the step search
  (view state `query`) and the status select (`factoryFilter`). A factory in a user group is
  drawn there only; the rest go under the shared sites (Plastic and Rubber out of one oil
  campus, nuclear factories at the nuclear site), then as single cards. Post-game adds the
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
  setFactoryFilter,
  setQuery,
  stage,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { inputText } from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import EditGroupsToggle from '../factories/EditGroupsToggle.vue';
import FactoryCard from '../factories/FactoryCard.vue';
import GroupEditPanel from '../factories/GroupEditPanel.vue';
import GroupSections from '../factories/GroupSections.vue';
import PageHeader from '../PageHeader.vue';
import { toggleCheck } from '../actions.ts';
import type { HandbookFactory } from '../../../types/index.ts';

// The status filter: value, label.
const FILTERS: [value: string, label: string][] = [
  ['all', 'All factories'],
  ['todo', 'Not running yet'],
  ['done', 'Running'],
  ['local', 'Made beside consumers'],
];

// Which shared site a factory is drawn under; null means a card of its own.
const siteOf = (f: HandbookFactory) =>
  ['Plastic', 'Rubber'].includes(f.name) ? 'oil' : f.nuclear ? 'nuclear' : null;

const page = computed(() =>
  legacy(() => {
    const running = (f: HandbookFactory) => checked('factory-' + stage() + '-' + f.id);
    // Factories at this stage that match the search text and the status filter.
    const list = plan.factories
      .filter(f => f.stages[stage()])
      .filter(f =>
        // The filter above keeps only factories with this stage.
        (f.name + ' ' + f.stages[stage()]!.recipe).toLowerCase().includes(query.toLowerCase()),
      )
      .filter(
        f =>
          factoryFilter === 'all' ||
          (factoryFilter === 'todo' && !running(f)) ||
          (factoryFilter === 'done' && running(f)) ||
          (factoryFilter === 'local' && f.local),
      );
    const ungrouped = list.filter(f => !membershipsOf(f.id).length);
    // The handbook has a stage plan for every phase it covers.
    const p = plan.plans[stage()]!;
    const site = (kind: 'oil' | 'nuclear', label: string, sub: string) => {
      const members = ungrouped.filter(f => siteOf(f) === kind);
      return members.length ? { kind, label, sub, members } : null;
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
      filter: factoryFilter,
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
                line: `${num(r.output)}/min · ${num(r.machines)} ${r.machine} · last at ${num(r.lastClock)}%`,
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

function filter(e: Event) {
  setFactoryFilter((e.target as HTMLSelectElement).value);
  render();
}
</script>

<template>
  <PageHeader
    eyebrow="PRODUCTION LIBRARY"
    title="Factory targets"
    subtitle="Outputs include downstream supply, protected storage and elevator exports. Click a factory for its inputs and expansion history."
  />
  <div v-if="page.post" class="notice">
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
    /><select id="factory-filter" aria-label="Factory status" @change="filter">
      <option v-for="[v, l] in FILTERS" :key="v" :value="v" :selected="page.filter === v">
        {{ l }}
      </option></select
    ><span class="small muted">{{ page.list.length }} targets</span><EditGroupsToggle />
  </div>
  <GroupEditPanel v-if="page.editing" />
  <GroupSections :items="page.list" :key-of="f => f.id">
    <template #card="{ item, group }"><FactoryCard :factory="item" :group="group" /></template>
  </GroupSections>
  <section v-for="s in page.sites" :key="s.kind" class="site-group">
    <header class="site-head">
      <div>
        <span class="eyebrow">SHARED SITE · {{ s.members.length }} OUTPUTS</span>
        <h2>{{ s.label }}</h2>
      </div>
      <p class="small muted">{{ s.sub }}</p>
    </header>
    <div class="cards">
      <FactoryCard v-for="f in s.members" :key="f.id" :factory="f" />
    </div>
  </section>
  <p v-if="page.label" class="eyebrow">UNGROUPED FACTORIES</p>
  <div class="cards">
    <template v-if="page.singles.length"
      ><FactoryCard v-for="f in page.singles" :key="f.id" :factory="f"
    /></template>
    <div v-else-if="!page.list.length" class="empty-state">No factories match this filter.</div>
  </div>
  <section v-if="page.post" style="margin-top: 32px">
    <h2>Additional completion modules</h2>
    <div class="notice">
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
