<!--
  The alternate recipe picker on All settings step 2, shown when Recipe access is "Pick
  specific alternate recipes", and on the guided recipes question under "I will choose them
  myself" (#1072). It lists the hard-drive alternates only: the MAM recipes have their own box
  (MamRecipes.vue, #1058) and Distilled Silica comes with its milestone in every plan.

  Each recipe has three states (#1075, app/recipe-states.ts): owned, hunting or not allowed, a
  radio group per row. They are the settings every plan has: owned is settings.ownedAlternates
  (hidden "ownedAlt" fields), hunting a pick (hidden "alt" fields, settings.alternateRecipes) that
  is not owned, and a hunting row the user set or Planner's choice ticked is on the hunt (hidden
  "altplanner", settings.plannerPicks); not allowed is neither. readAlternates reads them back with
  the rest of the step, so "Alternates you already own" (OwnedAlternates.vue) is not shown beside
  it. Ticked stars (name="altpref") are settings.preferredRecipes. A recipe the ingot preference
  already requires has no states; a pick the user gave it keeps its hidden "alt" field (#1058).

  The rows are grouped by product, each group with a one-line verdict: what its best alternate
  skips from the standard recipe and, when this profile's stored hard-drive ranking (#203) has
  them, the buildings it saves. A hunting row says what it saves if found and what the plan's
  product is made with until then. Filters by text, phase and state hide rows in place; "Hunt all
  shown" and "Clear shown" apply to the rows shown. "Planner's choice" calculates with every
  alternate allowed and marks the ones that plan uses from its start phase on as hunting, then
  calculates with just those and keeps the ones that plan uses too (#1058). Only the draft
  changes, nothing is saved.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { post, toast } from '../../api.ts';
import { $, required } from '../../format.ts';
import {
  compared,
  fallbacksOf,
  productOf,
  recipeSets,
  stateIn,
  withState,
  type RecipeSets,
  type RecipeState,
} from '../../recipe-states.ts';
import { payoffFigures, payoffSaving, rankedPhases } from '../../payoff.ts';
import { currentProfile, draft, payoff, wizard, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { alternatesUsed, openAltRecipe } from '../../wizard/recipes.ts';
import { readGuidedForm } from '../../wizard/guided.ts';
import { calcProgress, readWizard, wizardError } from '../../wizard/wizard.ts';
import { listNames } from '../../../wording.ts';
import { legacy } from '../bridge.ts';
import type { StoredCalculatedPlan } from '../../../types/index.ts';

// A stable empty list, so a draft without picks does not look replaced on every redraw.
const NONE: string[] = [];

const STATE_LABELS: [RecipeState, string][] = [
  ['owned', 'Owned'],
  ['hunting', 'Hunting'],
  ['off', 'Not allowed'],
];

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const settings = wizard.settings;
    const standard = workspace.catalog.standardRecipes || [];
    // The stored ranking of the profile Edit settings edits, while it belongs to its plan.
    const edit = wizard.edit;
    const ranking =
      edit &&
      payoff &&
      currentProfile?.id === edit.profileId &&
      payoff.planCreatedAt === edit.plan.createdAt
        ? payoff.ranking
        : null;
    const figures = ranking ? payoffFigures(ranking) : new Map();
    const rows = (workspace.catalog.alternates || [])
      .filter(alternate => !alternate.mam && !alternate.milestone)
      .map(alternate => {
        const outs = Object.keys(alternate.outputs);
        const name = alternate.name.replace('Alternate: ', '');
        const { skips, adds } = compared(alternate, standard);
        return {
          id: alternate.id,
          name,
          product: productOf(alternate),
          outs,
          phase: alternate.phase,
          text: (name + ' ' + outs.join(' ')).toLowerCase(),
          why: alternate.pure && settings.pureIngots === true ? 'ingot preference' : '',
          skips,
          adds,
          fallback: fallbacksOf(alternate, standard).map(recipe => recipe.name),
          figure: figures.get(alternate.id) || null,
        };
      })
      .sort((a, b) => a.product.localeCompare(b.product) || a.phase - b.phase);
    return {
      key: [
        settings.alternateRecipes || NONE,
        settings.ownedAlternates || NONE,
        settings.plannerPicks || NONE,
        settings.preferredRecipes || NONE,
      ],
      settings,
      rows,
      ranked: ranking ? rankedPhases(ranking) : null,
    };
  }),
);

// One alternate's row in the picker.
type AltRow = NonNullable<(typeof view)['value']>['rows'][number];

// The states on screen, from the draft whenever its lists are replaced (a read of the step,
// Planner's choice).
const sets = ref<RecipeSets>(recipeSets({}));
watch(
  () => view.value?.key,
  () => {
    if (view.value) sets.value = recipeSets(view.value.settings);
  },
  { immediate: true },
);
const state = (row: AltRow): RecipeState => stateIn(sets.value, row.id);
function choose(row: AltRow, next: RecipeState) {
  sets.value = withState(sets.value, row.id, next);
}

const filter = ref('');
const phase = ref('');
const only = ref<RecipeState | ''>('');
const shown = (row: AltRow) =>
  (filter.value.trim() === '' || row.text.includes(filter.value.trim().toLowerCase())) &&
  (phase.value === '' || row.phase <= Number(phase.value)) &&
  (only.value === '' || (!row.why && state(row) === only.value));

// The rows grouped by product, in the order the rows are sorted, with each group's verdict.
const groups = computed(() => {
  const list: { product: string; rows: AltRow[]; verdict: string }[] = [];
  for (const row of view.value?.rows || []) {
    const last = list[list.length - 1];
    if (last?.product === row.product) last.rows.push(row);
    else list.push({ product: row.product, rows: [row], verdict: '' });
  }
  for (const group of list) group.verdict = verdict(group.rows);
  return list;
});
// "Cast Screws skips Iron Rod, −14 buildings in Phase 2": the group's alternate that saves the
// most buildings by the ranking, else its first one that skips or adds an input.
function verdict(rows: AltRow[]): string {
  const ranked = rows
    .filter(row => row.figure && row.figure.buildings < 0)
    .sort((a, b) => a.figure!.buildings - b.figure!.buildings)[0];
  const best = ranked || rows.find(row => row.skips.length || row.adds.length);
  if (!best) return '';
  const how = best.skips.length
    ? `${best.name} skips ${listNames(best.skips)}`
    : best.adds.length
      ? `${best.name} uses ${listNames(best.adds)}`
      : best.name;
  return ranked ? `${how}, ${payoffSaving(ranked.figure!)}` : how;
}
// A row's figure in words: what a hunting row saves once found and what the plan makes its
// product with until then; what a recipe not allowed would save.
function payoffLine(row: AltRow): string {
  const now = state(row);
  const until = row.fallback.length ? `until then: ${listNames(row.fallback)}` : '';
  if (now === 'hunting') {
    if (row.figure?.status === 'infeasible') return 'The plan does not fit without it';
    if (row.figure && row.figure.buildings < 0)
      return [`If found: ${payoffSaving(row.figure)}`, until].filter(Boolean).join(' · ');
    return until ? 'Until found: ' + listNames(row.fallback) : '';
  }
  if (now === 'off' && row.figure && row.figure.buildings < 0)
    return `Worth a hard drive: ${payoffSaving(row.figure)}`;
  return '';
}

const counts = computed(() => {
  const rows = (view.value?.rows || []).filter(row => !row.why);
  return {
    owned: rows.filter(row => state(row) === 'owned').length,
    hunting: rows.filter(row => state(row) === 'hunting').length,
  };
});

function star(row: AltRow, on: boolean) {
  const next = { ...sets.value, starred: new Set(sets.value.starred) };
  if (on) {
    next.starred.add(row.id);
    // A star counts only on a pick: an owned recipe becomes one too (the pool is the same).
    if (!next.picked.has(row.id)) next.picked = new Set([...next.picked, row.id]);
  } else next.starred.delete(row.id);
  sets.value = next;
}
function all(to: RecipeState) {
  // The buttons are only drawn with the view.
  for (const row of view.value!.rows)
    if (!row.why && shown(row) && state(row) !== 'owned') choose(row, to);
}

// Planner's choice: its label shows the calculation's progress meanwhile, busy (bound
// aria-disabled, app/busy.ts: it keeps focus, #299).
const busy = ref(false);
const bestLabel = ref('Planner’s choice');
const label = {
  set textContent(text: string | null) {
    if (text === null) return;
    bestLabel.value = text;
  },
};
// How many times Planner's choice calculates again with just its picks, to drop the ones that
// plan leaves unused (#1058). Fewer recipes to choose from rarely leave another one unused.
const PRUNE_PASSES = 3;
async function best() {
  if (busy.value) return;
  busy.value = true;
  const wizardDraft = draft();
  try {
    // The guided recipes question shows this picker too (#1072): read its screen as the guided
    // start reads it: the five steps' reader would take it for the step the draft last showed.
    const form = required<HTMLFormElement>('#wizard-form');
    if (wizardDraft.mode === 'guided') readGuidedForm(form);
    else readWizard(form);
    const settings = wizardDraft.settings;
    // Not the recipes the plan has anyway: the ones the ingot preference locks in, or owned.
    const plain = new Set([
      ...(view.value?.rows || []).filter(row => row.why).map(row => row.id),
      ...(settings.ownedAlternates || []),
    ]);
    const usedIn = (plan: StoredCalculatedPlan) =>
      alternatesUsed(plan).filter(id => !plain.has(id));
    let used = usedIn(
      await post<StoredCalculatedPlan>(
        '/api/preview',
        { settings: { ...settings, recipes: 'all' } },
        true,
        calcProgress(label, 'Calculating…'),
      ),
    );
    // Then with just those, as Review will calculate, keeping the ones that plan uses too.
    for (let pass = 0; pass < PRUNE_PASSES && used.length; pass++) {
      const picks = used;
      const plan = await post<StoredCalculatedPlan>(
        '/api/preview',
        {
          settings: {
            ...settings,
            recipes: 'custom',
            alternateRecipes: picks,
            preferredRecipes: (settings.preferredRecipes || []).filter(id => picks.includes(id)),
            plannerPicks: picks,
          },
        },
        true,
        calcProgress(label, 'Checking…'),
      );
      used = usedIn(plan).filter(id => picks.includes(id));
      if (used.length === picks.length) break;
    }
    settings.alternateRecipes = used;
    settings.preferredRecipes = (settings.preferredRecipes || []).filter(id => used.includes(id));
    if (used.length) settings.plannerPicks = used;
    else delete settings.plannerPicks;
    render();
    toast(
      `Marked ${used.length} alternate recipes the planner uses with your current settings as hunting. They stay on the hard-drive hunt until you mark them unlocked.`,
    );
  } catch (error) {
    wizardError($<HTMLFormElement>('#wizard-form'), error as Error);
  } finally {
    busy.value = false;
    bestLabel.value = 'Planner’s choice';
  }
}
</script>

<template>
  <div v-if="view" class="alt-picker" data-recipe-states>
    <div class="alt-picker-head">
      <b data-alt-count
        >Alternate recipes · {{ counts.owned }} owned · {{ counts.hunting }} hunting</b
      ><span class="alt-tools"
        ><button
          type="button"
          class="btn quiet"
          data-alt-best
          title="Recalculates with every alternate allowed and marks only the recipes the optimal plan uses as hunting"
          :aria-disabled="busy || undefined"
          @click="best"
        >
          {{ bestLabel }}</button
        ><button type="button" class="btn quiet" data-alt-all @click="all('hunting')">
          Hunt all shown</button
        ><button type="button" class="btn quiet" data-alt-none @click="all('off')">
          Clear shown
        </button></span
      >
    </div>
    <div class="alt-filters">
      <input
        id="alt-filter"
        v-model="filter"
        type="search"
        placeholder="Filter by recipe or product…"
        aria-label="Filter alternate recipes"
      /><label
        >Phase
        <select v-model="phase" data-alt-phase aria-label="Show the recipes available by">
          <option value="">Any phase</option>
          <option v-for="n in 5" :key="n" :value="String(n)">By Phase {{ n }}</option>
        </select></label
      ><label
        >Show
        <select v-model="only" data-alt-only aria-label="Show the recipes in this state">
          <option value="">All states</option>
          <option v-for="[value, text] in STATE_LABELS" :key="value" :value="value">
            {{ text }}
          </option>
        </select></label
      >
    </div>
    <p class="small muted">
      <b>Owned</b>: you have unlocked it; the plan uses it freely and its unlock step starts ticked.
      <b>Hunting</b>: the plan counts on it, and its hard-drive step stays on the build plan’s hunt
      until you mark it unlocked. <b>Not allowed</b>: the plan never uses it. With nothing hunting
      or owned it is the same plan as with Standard recipes. The MAM recipes follow their own box
      above, and Distilled Silica comes with the Tier 7 milestone Control System Development in
      every plan. Requiring pure ingots locks the pure recipes; one you picked yourself stays picked
      when you turn that off again. Raw-resource conversion recipes are not alternates — they follow
      the SAM conversion setting and Tier 9 unlocks. <b>Planner’s choice</b> recalculates with every
      alternate allowed and marks only the recipes the plan uses from your start phase on as hunting
      — each costs one hard drive.
      <template v-if="view.ranked"
        >Buildings saved are from this profile’s hard-drive ranking for {{ view.ranked }}.</template
      >
    </p>
    <p class="alt-force-hint">
      <span class="alt-force-star">★</span
      ><span
        ><b>Force a recipe:</b> mark it owned or hunting, then click its star. The plan will use
        <b>no other recipe</b> for that product once the starred one is available.</span
      >
    </p>
    <div class="alt-list">
      <section
        v-for="group in groups"
        :key="group.product"
        class="alt-group"
        :data-alt-group="group.product"
        :hidden="!group.rows.some(shown)"
      >
        <h4>{{ group.product }}</h4>
        <p v-if="group.verdict" class="alt-verdict" data-alt-verdict>{{ group.verdict }}</p>
        <div
          v-for="row in group.rows"
          :key="row.id"
          class="alt-row"
          :data-alt-row="row.id"
          :data-alt-state="row.why ? 'required' : state(row)"
          :data-alt-text="row.text"
          :hidden="!shown(row)"
        >
          <span class="alt-name"
            >{{ row.name
            }}<small class="muted">
              · Phase {{ row.phase
              }}{{ row.outs.length > 1 ? ' · also ' + row.outs.slice(1).join(', ') : '' }}</small
            ></span
          >
          <span v-if="row.why" class="alt-required small muted"
            >Required by your {{ row.why }}</span
          >
          <span
            v-else
            class="alt-states"
            role="radiogroup"
            :aria-label="`${row.name}: owned, hunting or not allowed`"
            ><label
              v-for="[value, text] in STATE_LABELS"
              :key="value"
              :class="['alt-state', 'alt-state-' + value]"
              ><input
                type="radio"
                :name="'altstate:' + row.id"
                :value="value"
                :data-alt-set="value"
                :checked="state(row) === value"
                @change="choose(row, value)"
              /><span>{{ text }}</span></label
            ></span
          >
          <input v-if="sets.picked.has(row.id)" type="hidden" name="alt" :value="row.id" /><input
            v-if="state(row) === 'owned'"
            type="hidden"
            name="ownedAlt"
            :value="row.id"
          /><input
            v-if="sets.picked.has(row.id) && sets.planner.has(row.id)"
            type="hidden"
            name="altplanner"
            :value="row.id"
            data-alt-planner
          /><input
            v-if="row.why && sets.picked.has(row.id) && sets.starred.has(row.id)"
            type="hidden"
            name="altpref"
            :value="row.id"
          /><label
            v-if="!row.why"
            class="alt-pref"
            :title="`Force this recipe: the plan will not use any other recipe for ${row.product} once this one is available`"
            ><input
              type="checkbox"
              name="altpref"
              :value="row.id"
              :checked="sets.starred.has(row.id)"
              :disabled="state(row) === 'off'"
              :aria-label="`Force ${row.name} as the only ${row.product} recipe`"
              @change="star(row, ($event.target as HTMLInputElement).checked)"
            /><span>★</span></label
          ><button
            type="button"
            class="btn quiet alt-info"
            :data-alt-info="row.id"
            :aria-label="`Show the ${row.name} recipe`"
            @click="openAltRecipe(row.id)"
          >
            recipe ↗
          </button>
          <small v-if="!row.why && payoffLine(row)" class="alt-payoff" data-alt-payoff>{{
            payoffLine(row)
          }}</small>
        </div>
      </section>
    </div>
  </div>
</template>
