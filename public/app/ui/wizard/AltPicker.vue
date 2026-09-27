<!--
  The alternate recipe picker on All settings step 2, shown when Recipe access is "Pick
  specific alternate recipes". Ticked boxes (name="alt") become settings.alternateRecipes and
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
import { calcProgress, readWizard, wizardError } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import type { StoredCalculatedPlan } from '../../../types/index.ts';

// A stable empty list, so a draft without picks does not look replaced on every redraw.
const NONE: string[] = [];

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const s = wizard.settings;
    return {
      alternates: s.alternateRecipes || NONE,
      preferred: s.preferredRecipes || NONE,
      rows: (workspace.catalog.alternates || []).map(a => {
        const outs = Object.keys(a.outputs);
        return {
          id: a.id,
          name: a.name,
          outs,
          text: (a.name + ' ' + outs.join(' ')).toLowerCase(),
          when: a.mam ? 'MAM research' : 'Phase ' + a.phase,
          why:
            a.mam && !['auto', 'coal', 'fuel'].includes(s.mainPower || 'auto')
              ? 'power preference'
              : a.pure && s.pureIngots === true
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
const shown = (r: AltRow) =>
  filter.value.trim() === '' || r.text.includes(filter.value.trim().toLowerCase());
const count = computed(() =>
  touched.value
    ? // touched is only set by the boxes, which the view draws.
      view.value!.rows.filter(r => !r.why && picked.value.has(r.id)).length
    : picked.value.size,
);

function tick(r: AltRow, on: boolean) {
  const p = new Set(picked.value),
    s = new Set(starred.value);
  on ? p.add(r.id) : p.delete(r.id);
  if (!on) s.delete(r.id);
  picked.value = p;
  starred.value = s;
  touched.value = true;
}
function star(r: AltRow, on: boolean) {
  const s = new Set(starred.value);
  on ? s.add(r.id) : s.delete(r.id);
  starred.value = s;
}
function all(on: boolean) {
  // The buttons are only drawn with the view.
  for (const r of view.value!.rows) if (!r.why && shown(r)) tick(r, on);
}

// Planner's choice: its label shows the calculation's progress meanwhile, busy (bound
// aria-disabled, app/busy.ts: it keeps focus, #299).
const busy = ref(false);
const bestLabel = ref('Planner’s choice');
async function best() {
  if (busy.value) return;
  busy.value = true;
  const w = draft();
  try {
    readWizard(required<HTMLFormElement>('#wizard-form'));
    const preview = await post<StoredCalculatedPlan>(
      '/api/preview',
      { settings: { ...w.settings, recipes: 'all' } },
      true,
      calcProgress(
        {
          set textContent(v: string | null) {
            if (v === null) return;
            bestLabel.value = v;
          },
        },
        'Calculating…',
      ),
    );
    const used = alternatesUsed(preview);
    w.settings.alternateRecipes = used;
    render();
    toast(`Selected ${used.length} alternate recipes the planner uses with your current settings.`);
  } catch (err) {
    wizardError($<HTMLFormElement>('#wizard-form'), err as Error);
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
      crash sites; Turbofuel and Compacted Coal are researched in the MAM instead. Recipes your
      other choices depend on are selected automatically: a turbofuel-based power route locks its
      MAM recipes, and requiring pure ingots locks the pure recipes. Raw-resource conversion recipes
      are not alternates — they follow the SAM conversion setting and Tier 9 unlocks. Selecting none
      plans with standard recipes only. <b>Planner’s choice</b> recalculates with every alternate
      allowed and ticks only the recipes the optimal plan actually uses — each ticked recipe costs
      one hard drive. Select all and Clear all apply to the rows currently shown by the filter.
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
        v-for="r in view.rows"
        :key="r.id"
        class="alt-row"
        :data-alt-text="r.text"
        :hidden="!shown(r)"
      >
        <label class="check-row"
          ><input
            v-if="r.why"
            type="checkbox"
            checked
            disabled
            :aria-label="`${r.name} is required by your ${r.why}`"
          /><input
            v-else
            type="checkbox"
            name="alt"
            :value="r.id"
            :checked="picked.has(r.id)"
            @change="tick(r, ($event.target as HTMLInputElement).checked)"
          /><span
            >{{ r.name
            }}<small class="muted">
              · {{ r.outs.join(', ') }} · {{ r.when
              }}{{ r.why ? ' · required by your ' + r.why : '' }}</small
            ></span
          ></label
        ><label
          v-if="!r.why"
          class="alt-pref"
          :title="`Force this recipe: the plan will not use any other recipe for ${r.outs[0]} once this one is available`"
          ><input
            type="checkbox"
            name="altpref"
            :value="r.id"
            :checked="starred.has(r.id)"
            :disabled="!picked.has(r.id)"
            :aria-label="`Force ${r.name} as the only ${r.outs[0]} recipe`"
            @change="star(r, ($event.target as HTMLInputElement).checked)"
          /><span>★</span></label
        ><button
          type="button"
          class="btn quiet alt-info"
          :data-alt-info="r.id"
          :aria-label="`Show the ${r.name} recipe`"
          @click="openAltRecipe(r.id)"
        >
          recipe ↗
        </button>
      </div>
    </div>
  </div>
</template>
