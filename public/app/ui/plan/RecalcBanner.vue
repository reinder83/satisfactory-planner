<!--
  The one notice that says "This plan needs a recalculation", on the build plan and the Factories
  page (#1280). Four things can make the open plan differ from what the profile asks for, each read
  from the saved progress and compared with the plan; none recalculates by itself (AGENTS.md):

  - the production lines asked to run at exact clocks (`exactClocks`, saved from a line's dialog,
    ExactClockChoice.vue; exactClocksChange in app/exact-clocks.ts, #1066);
  - the somersloop pins (`sloopPins`, SloopPinChoice.vue; sloopPinsChange in app/sloop-pins.ts,
    #1235), with the phases whose pins add up to more than the amplification budget, which a
    recalculation would plan without them, and the pins the planner no longer takes, which a
    recalculation drops (#1271);
  - the Power Shard pins (`lineClocks`, ShardPinChoice.vue; lineClocksChange in app/shard-pins.ts,
    #1239), with the pins on a recipe the game data no longer has (#1271);
  - on the Factories page only (`onSite`): the items the groups make on site, which the factory
    groups' marks (factoryGroups.local, saved by OnSitePicker.vue) would give in a recalculation
    (onSiteChange in app/on-site-picker.ts, #877, #938, #970, #985).

  On the build plan's Overview (`ticks`, BP-7) a fifth reason joins them, the ticks showing more than
  the plan's "What you already have" settings count (#1068; ownedTicksNotice in views/calculated.ts,
  withOwnedFound in owned-ticks.ts): a better miner or belt milestone ticked, a hard-drive
  alternate's unlock the plan does not hold, or generators marked running beyond what some phase
  from the working phase on runs. It was a card of its own under this one. Its words and its own
  "Dismiss" stay with that reason (hidden in this browser until the ticks add something new,
  setTicksNoticeDismissed in session.ts; focus then goes to the Overview tab), and the one button
  raises those owned fields in the same recalculation.

  They used to be four notices, one above the other, each with its own button (#1280). Now there is
  one notice and one button: with one source it reads as that source's notice always did (its
  words, its label, its `data-*-recalc` and `data-recalc-*` hooks); with several it lists the
  reasons ("Made on site changed; Power Shard pins changed"), then each source's own words, and
  the one button recalculates this profile in place with all of them, after a confirmation that
  names the backup kept of the current version (recalculateOffer in ui/recalc-offer.ts, #1071): the
  progress is carried as Edit settings carries it, and ticks with no single line to land on are
  kept for review (#876). recalculateOffer sends the exact clocks and both kinds of pins asked for
  with every offer, so only the made-on-site settings are added here. The root carries the hook of
  each source that is pending and the button carries that source's button hook, so a test or a
  focus handler (OnSitePicker.vue) finds them as before.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { exactClockNames, exactClocksChange } from '../../exact-clocks.ts';
import { onSiteChange, onSiteRecalcSettings } from '../../on-site-picker.ts';
import { clockChangeWords, lineClocksChange } from '../../shard-pins.ts';
import { foundList, foundWords, alternatesPhrase, withOwnedFound } from '../../owned-ticks.ts';
import { calculated, setTicksNoticeDismissed, state, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { ownedTicksNotice } from '../../views/calculated.ts';
import { pinChangeWords, pinsOverBudget, sloopPinsChange } from '../../sloop-pins.ts';
import { catalogRecipeBook } from '../../built-capacity.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { listNames, localeNumber } from '../../../wording.ts';
import { legacy } from '../bridge.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';
import { refocusAfterRemoval } from '../refocus.ts';

// `onSite`: the Factories page, which also asks for the items the groups make on site. `ticks`:
// the build plan's Overview, which also offers what the ticks show you already have (BP-7).
const props = defineProps<{ onSite?: boolean; ticks?: boolean }>();

const owned = computed(() =>
  legacy(() => {
    const found = props.ticks ? ownedTicksNotice() : null;
    if (!found) return null;
    const words = foundWords(found, workspace.catalog?.alternates);
    return {
      found,
      list: foundList(words),
      unlocked: listNames(words.unlocked),
      alternates: alternatesPhrase(words.alternates),
      generators: listNames(words.generators),
    };
  }),
);

function dismissOwned(event: Event) {
  const shown = owned.value;
  if (!shown) return;
  const refocus = refocusAfterRemoval(event.currentTarget, {
    fallback: ['[data-plan-tab="overview"]', '#main h1'],
  });
  setTicksNoticeDismissed(shown.found);
  render();
  void refocus();
}

const exact = computed(() =>
  legacy(() => {
    const found = calculated ? exactClocksChange(calculated, state) : null;
    return found
      ? { exact: exactClockNames(found.exact), whole: exactClockNames(found.whole) }
      : null;
  }),
);

const sloops = computed(() =>
  legacy(() => {
    const found = calculated ? sloopPinsChange(calculated, state, catalogRecipeBook()) : null;
    if (!calculated || !found) return null;
    const over = pinsOverBudget(calculated, found.wanted);
    const budget = calculated.settings.amplifySloops ?? 0;
    return {
      lines: pinChangeWords(found.lines),
      stale: found.stale,
      over: over.length
        ? `The pins of ${over.length > 1 ? 'Phases' : 'Phase'} ${listNames(over.map(([phase, total]) => `${phase} (${localeNumber(total)})`))} add up to more than the ${localeNumber(budget)} somersloop${budget === 1 ? '' : 's'} production amplification may place in a phase, so a recalculation would plan ${over.length > 1 ? 'those phases' : 'that phase'} without them: raise the amplification budget on step 2 of Edit settings, or lower the pins.`
        : '',
    };
  }),
);

const shards = computed(() =>
  legacy(() => {
    const found = calculated ? lineClocksChange(calculated, state, catalogRecipeBook()) : null;
    if (!calculated || !found) return null;
    return { lines: clockChangeWords(found.lines), stale: found.stale };
  }),
);

const site = computed(() =>
  legacy(() =>
    props.onSite && calculated ? onSiteChange(calculated, factoryGroupsState()) : null,
  ),
);

// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

// What is pending, in the order the notices used to stand: the reason each gives for the list, the
// words after "Recalculates “name” " in the confirmation, and the label a lone source gives the
// button.
const reasons = computed(() => {
  const found: { reason: string; change: string; label: string }[] = [];
  if (site.value)
    found.push({
      reason: 'Made on site changed',
      change: 'the items your factories make on site',
      label: 'Recalculate in place with items made on site',
    });
  if (exact.value)
    found.push({
      reason: 'Exact clocks changed',
      change: 'the production lines at the clocks you chose',
      label: 'Recalculate in place with exact clocks',
    });
  if (sloops.value)
    found.push({
      reason: 'Somersloop pins changed',
      change: 'the somersloop pins you chose',
      label: 'Recalculate in place with somersloop pins',
    });
  if (shards.value)
    found.push({
      reason: 'Power Shard pins changed',
      change: 'the Power Shard pins you chose',
      label: 'Recalculate in place with Power Shard pins',
    });
  if (owned.value)
    found.push({
      reason: 'Ticks show more than the plan counts',
      change: `what your ticks show you already have: ${owned.value.list}`,
      label: 'Recalculate in place with what you have',
    });
  return found;
});
const many = computed(() => reasons.value.length > 1);
const label = computed(() =>
  many.value
    ? `Recalculate in place with all ${reasons.value.length} changes`
    : (reasons.value[0]?.label ?? ''),
);
// An empty attribute for a pending source, no attribute for the others.
const flag = (on: unknown) => (on ? '' : null);

// The plan's settings with the owned fields the ticks show raised, when that reason is pending.
const ownedSettings = <S extends NonNullable<typeof calculated>['settings']>(settings: S): S =>
  owned.value ? withOwnedFound(settings, owned.value.found) : settings;

function recalculate(event: Event) {
  if (!calculated || !reasons.value.length) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    // The plan's own settings, with what the groups make on site when that is pending; the exact
    // clocks and the pins go in with every offer.
    settings: ownedSettings(
      site.value ? onSiteRecalcSettings(calculated.settings, site.value) : calculated.settings,
    ),
    change: 'with ' + listNames(reasons.value.map(source => source.change)),
    label: label.value,
  });
}
</script>

<template>
  <div
    v-if="reasons.length"
    class="notice warn recalc-banner"
    :data-recalc-many="flag(many)"
    role="status"
    data-recalc-banner
    :data-on-site-recalc="flag(site)"
    :data-exact-clocks-recalc="flag(exact)"
    :data-sloop-pins-recalc="flag(sloops)"
    :data-shard-pins-recalc="flag(shards)"
    :data-owned-ticks-recalc="flag(owned)"
  >
    <p>
      <strong>This plan needs a recalculation.</strong>
      <template v-if="many"
        ><span data-recalc-reasons>{{ reasons.map(source => source.reason).join('; ') }}.</span>
      </template>
      <template v-if="site"
        ><span class="recalc-part">
          <template v-if="site.marksChanged"
            >What your factories make on site differs from this plan.
          </template>
          <template v-for="use in site.uses" :key="use"
            ><span data-on-site-use>{{ use }}.</span>
          </template>
          <template v-if="site.now">Now: {{ site.now }}.</template
          ><template v-else>Now no factory makes anything on site.</template>
          <template v-if="site.had"> This plan: {{ site.had }}.</template
          ><template v-else> This plan makes everything on central lines.</template> </span
        >{{ ' ' }}
      </template>
      <template v-if="exact"
        ><span class="recalc-part">
          <template v-if="exact.exact"
            ><span data-exact-clocks-asked>Exact clocks asked for: {{ exact.exact }}.</span>
          </template>
          <template v-if="exact.whole"
            ><span data-whole-clocks-asked>Whole machines asked for again: {{ exact.whole }}.</span>
          </template> </span
        >{{ ' ' }}
      </template>
      <template v-if="sloops"
        ><span class="recalc-part" data-sloop-pins-asked
          >Somersloop pins changed: {{ sloops.lines }}.</span
        >{{ ' ' }}
      </template>
      <template v-if="shards"
        ><span class="recalc-part" data-shard-pins-asked
          >Power Shard pins changed: {{ shards.lines }}.</span
        >{{ ' ' }}
      </template>
      <template v-if="owned"
        ><span class="recalc-part" data-owned-ticks
          ><template v-if="owned.unlocked"
            ><span data-owned-ticks-found="unlocked">You have unlocked {{ owned.unlocked }}.</span>
          </template>
          <template v-if="owned.alternates"
            ><span data-owned-ticks-found="alternates">You own {{ owned.alternates }}.</span>
          </template>
          <template v-if="owned.generators"
            ><span data-owned-ticks-found="generators">You run {{ owned.generators }}.</span>
          </template>
          The plan was calculated without them.
          <button
            type="button"
            class="btn quiet"
            data-owned-ticks-dismiss
            aria-describedby="owned-ticks-dismiss-note"
            @click="dismissOwned"
          >
            Dismiss
          </button>
          <span id="owned-ticks-dismiss-note" class="small muted"
            >It comes back when your ticks show something new.</span
          ></span
        >{{ ' ' }}
      </template>
      Nothing changes until you start it.
    </p>
    <p v-if="sloops?.over" data-sloop-pins-over>{{ sloops.over }}</p>
    <p v-if="sloops?.stale" data-sloop-pins-stale>{{ sloops.stale }}</p>
    <p v-if="shards?.stale" data-shard-pins-stale>{{ shards.stale }}</p>
    <p>
      <button
        class="btn primary"
        data-recalc-button
        :data-recalc-on-site="flag(site)"
        :data-recalc-exact-clocks="flag(exact)"
        :data-recalc-sloop-pins="flag(sloops)"
        :data-recalc-shard-pins="flag(shards)"
        :data-recalc-owned-ticks="flag(owned)"
        @click="recalculate"
      >
        {{ label }}
      </button>
      {{ IN_PLACE_NOTE
      }}<template v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
