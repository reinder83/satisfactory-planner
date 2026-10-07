<!--
  The alternate recipe picker on All settings step 2, shown when Recipe access is "Pick
  specific alternate recipes", and on the guided recipes question under "I will choose them
  myself" (#1072). Ticked boxes (name="alt") become settings.alternateRecipes and
  ticked stars (name="altpref") settings.preferredRecipes, read back by readWizard with the
  rest of the step. A recipe the power or ingot preference already requires is a locked,
  ticked box with no name, so it is never read back as a pick. The ticks, stars and filter
  are this component's own until the step is read: a star can only be ticked beside a ticked
  recipe, and Select all / Clear all apply to the rows the filter shows. "Planner's choice"
  calculates once with every alternate allowed and ticks exactly the ones that plan uses;
  only the draft changes, nothing is saved.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { post, toast } from '../../api.ts';
import { $, required } from '../../format.ts';
import { draft, wizard, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { alternatesUsed, openAltRecipe } from '../../wizard/recipes.ts';
import { readGuidedForm } from '../../wizard/guided.ts';
import { calcProgress, readWizard, wizardError } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import { turbofuelRecipes } from '../../../preferences.ts';
import type { StoredCalculatedPlan } from '../../../types/index.ts';

// A stable empty list, so a draft without picks does not look replaced on every redraw.
const NONE: string[] = [];

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const settings = wizard.settings;
    return {
      alternates: settings.alternateRecipes || NONE,
      preferred: settings.preferredRecipes || NONE,
      rows: (workspace.catalog.alternates || []).map(alternate => {
        const outs = Object.keys(alternate.outputs);
        return {
          id: alternate.id,
          name: alternate.name,
          outs,
          text: (alternate.name + ' ' + outs.join(' ')).toLowerCase(),
          when: alternate.mam
            ? 'MAM research'
            : alternate.milestone
              ? `Tier ${alternate.milestone} milestone`
              : 'Phase ' + alternate.phase,
          why:
            turbofuelRecipes.includes(alternate.id) &&
            !['auto', 'coal', 'fuel'].includes(settings.mainPower || 'auto')
              ? 'power preference'
              : alternate.pure && settings.pureIngots === true
                ? 'ingot preference'
                : '',
        };
      }),
    };
  }),
);

// One alternate's row in the picker.
type AltRow = NonNullable<(typeof view)['value']>['rows'][number];

// The picks on screen, from the draft whenever the draft's lists are replaced (a read of the
// step, Planner's choice). `touched` once a box has been changed here: the heading counts the
// draft's list until then, and the ticked editable boxes after, as the screen shows them.
const picked = ref(new Set<string>());
const starred = ref(new Set<string>());
const touched = ref(false);
watch(
  () => view.value?.alternates,
  list => {
    picked.value = new Set(list || []);
    touched.value = false;
  },
  { immediate: true },
);
watch(
  () => view.value?.preferred,
  list => (starred.value = new Set(list || [])),
  { immediate: true },
);

const filter = ref('');
const shown = (row: AltRow) =>
  filter.value.trim() === '' || row.text.includes(filter.value.trim().toLowerCase());
const count = computed(() =>
  touched.value
    ? // touched is only set by the boxes, which the view draws.
      view.value!.rows.filter(r => !r.why && picked.value.has(r.id)).length
    : picked.value.size,
);

function tick(row: AltRow, on: boolean) {
  const picks = new Set(picked.value),
    stars = new Set(starred.value);
  on ? picks.add(row.id) : picks.delete(row.id);
  if (!on) stars.delete(row.id);
  picked.value = picks;
  starred.value = stars;
  touched.value = true;
}
function star(row: AltRow, on: boolean) {
  const stars = new Set(starred.value);
  on ? stars.add(row.id) : stars.delete(row.id);
  starred.value = stars;
}
function all(on: boolean) {
  // The buttons are only drawn with the view.
  for (const row of view.value!.rows) if (!row.why && shown(row)) tick(row, on);
}

// Planner's choice: its label shows the calculation's progress meanwhile, busy (bound
// aria-disabled, app/busy.ts: it keeps focus, #299).
const busy = ref(false);
const bestLabel = ref('Planner’s choice');
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
    const preview = await post<StoredCalculatedPlan>(
      '/api/preview',
      { settings: { ...wizardDraft.settings, recipes: 'all' } },
      true,
      calcProgress(
        {
          set textContent(text: string | null) {
            if (text === null) return;
            bestLabel.value = text;
          },
        },
        'Calculating…',
      ),
    );
    const used = alternatesUsed(preview);
    wizardDraft.settings.alternateRecipes = used;
    render();
    toast(`Selected ${used.length} alternate recipes the planner uses with your current settings.`);
  } catch (error) {
    wizardError($<HTMLFormElement>('#wizard-form'), error as Error);
  } finally {
    busy.value = false;
    bestLabel.value = 'Planner’s choice';
  }
}
</script>

<template>
  <div v-if="view" class="alt-picker">
    <div class="alt-picker-head">
      <b>Alternate recipes · {{ count }} selected</b
      ><span class="alt-tools"
        ><button
          type="button"
          class="btn quiet"
          data-alt-best
          title="Recalculates with every alternate allowed and ticks only the recipes the optimal plan uses"
          :aria-disabled="busy || undefined"
          @click="best"
        >
          {{ bestLabel }}</button
        ><button type="button" class="btn quiet" data-alt-all @click="all(true)">Select all</button
        ><button type="button" class="btn quiet" data-alt-none @click="all(false)">
          Clear all
        </button></span
      ><input
        id="alt-filter"
        v-model="filter"
        type="search"
        placeholder="Filter by recipe or product…"
        aria-label="Filter alternate recipes"
      />
    </div>
    <p class="small muted">
      Only the recipes you tick are allowed in the plan. Hard-drive alternates are unlocked from
      crash sites; Turbofuel, Compacted Coal and Polyester Fabric are researched in the MAM instead,
      and Distilled Silica comes with the Tier 7 milestone Control System Development. Recipes your
      other choices depend on are selected automatically: a turbofuel-based power route locks its
      MAM recipes, and requiring pure ingots locks the pure recipes. Raw-resource conversion recipes
      are not alternates — they follow the SAM conversion setting and Tier 9 unlocks. Selecting none
      plans with standard recipes only. <b>Planner’s choice</b> recalculates with every alternate
      allowed and ticks only the recipes the optimal plan actually uses — each ticked hard-drive
      alternate costs one hard drive. Select all and Clear all apply to the rows currently shown by
      the filter.
    </p>
    <p class="alt-force-hint">
      <span class="alt-force-star">★</span
      ><span
        ><b>Force a recipe:</b> tick it, then click its star. The plan will use
        <b>no other recipe</b> for that product once the starred one is available.</span
      >
    </p>
    <div class="alt-list">
      <div
        v-for="row in view.rows"
        :key="row.id"
        class="alt-row"
        :data-alt-text="row.text"
        :hidden="!shown(row)"
      >
        <label class="check-row"
          ><input
            v-if="row.why"
            type="checkbox"
            checked
            disabled
            :aria-label="`${row.name} is required by your ${row.why}`"
          /><input
            v-else
            type="checkbox"
            name="alt"
            :value="row.id"
            :checked="picked.has(row.id)"
            @change="tick(row, ($event.target as HTMLInputElement).checked)"
          /><span
            >{{ row.name
            }}<small class="muted">
              · {{ row.outs.join(', ') }} · {{ row.when
              }}{{ row.why ? ' · required by your ' + row.why : '' }}</small
            ></span
          ></label
        ><label
          v-if="!row.why"
          class="alt-pref"
          :title="`Force this recipe: the plan will not use any other recipe for ${row.outs[0]} once this one is available`"
          ><input
            type="checkbox"
            name="altpref"
            :value="row.id"
            :checked="starred.has(row.id)"
            :disabled="!picked.has(row.id)"
            :aria-label="`Force ${row.name} as the only ${row.outs[0]} recipe`"
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
      </div>
    </div>
  </div>
</template>
