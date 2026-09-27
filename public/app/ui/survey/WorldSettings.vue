<!--
  The two World Randomization settings above the counts, exactly as the game presents them,
  and what the planner can fill in for them. They are All settings step 1's purity and
  distribution: readExtraction writes them to the draft's settings at once, and a world that
  is fully known (knownWorld) refills every count when either changes. Below them are "Reset
  all counts to zero" and, after a reset, "Undo reset" in its place, or "Undo refill" after a
  refill replaced counts typed by hand. There is deliberately no confirmation: the undo is the
  safety net.
-->
<script setup lang="ts">
import { computed } from 'vue';
import {
  distributions,
  knownWorld,
  matchingPreset,
  nodePresets,
  presetPurities,
  presetSurvey,
  purities,
  richShape,
} from '../../../preferences.ts';
import { toast } from '../../api.ts';
import { $ } from '../../format.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  extractionOf,
  readExtraction,
  resetExtraction,
  undoExtractionReset,
} from '../../wizard/extraction.ts';
import { noteWizardEdit } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import HelpTip from '../form/HelpTip.vue';
import { refocusAfterRemoval } from '../refocus.ts';
import SelectField from '../form/SelectField.vue';

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const s = wizard.settings,
      e = extractionOf(wizard);
    const known = knownWorld(s.purity, s.distribution);
    const active = matchingPreset(e);
    // Random is a shuffle: it moves nodes but not how many of each resource there are. So
    // it costs us only the purity split, and only for the settings that keep the map's own
    // split.
    const splitShuffled =
      s.distribution === 'randomized' && !known && presetPurities.includes(s.purity);
    return {
      purity: s.purity,
      distribution: s.distribution,
      status:
        known && active === s.purity
          ? 'filled'
          : known
            ? 'fillable'
            : splitShuffled
              ? 'split'
              : 'unknown',
      label: (nodePresets.find(([v]) => v === active) || [, ''])[1],
      active,
      shuffled: s.distribution === 'randomized',
      purityLabel: (purities.find(([v]) => v === s.purity) || [, ''])[1],
      rich: richShape[s.distribution] || '',
      undo: wizard.extractionUndo ? (wizard.extractionUndoKind ?? 'reset') : null,
    };
  }),
);

// "Fill in the counts below": every count from the default world at that purity. It also
// forgets any pending "Undo reset", and keeps the recorded purity in step with the counts.
// Fill, Reset and Undo each swap their button for another one, so focus goes to the one that
// takes its place (ui/refocus.ts, #290): Reset's Undo, Undo's Reset, and after Fill whichever of
// the two is shown.
const swapTo = (e: Event, fallback: string[]) =>
  refocusAfterRemoval(e.currentTarget, { fallback: fallback.map(s => '#main ' + s) });

function fill(e: Event) {
  const refocus = swapTo(e, ['[data-node-undo]', '[data-node-reset]']);
  const w = draft();
  noteWizardEdit();
  const form = $<HTMLFormElement>('#wizard-form');
  if (form) readExtraction(form);
  // The button is only drawn with the view.
  const purity = view.value!.purity;
  w.extraction = presetSurvey(purity, extractionOf(w), w.settings.distribution);
  w.extractionUndo = null;
  w.settings.purity = purity;
  render();
  void refocus();
  toast(
    'Filled in the default world at ' +
      (nodePresets.find(([v]) => v === purity)?.[1] || 'that purity') +
      '. Change any count that does not match your save.',
  );
}

function reset(e: Event) {
  const refocus = swapTo(e, ['[data-node-undo]']);
  const form = $<HTMLFormElement>('#wizard-form');
  if (form) readExtraction(form);
  resetExtraction();
  render();
  void refocus();
  toast(
    'Cleared. Every count is zero, your miner mark and clock are kept — and Undo reset puts it all back.',
  );
}

function undo(e: Event) {
  const refocus = swapTo(e, ['[data-node-reset]']);
  const kind = view.value?.undo;
  undoExtractionReset();
  render();
  void refocus();
  toast(
    kind === 'refill'
      ? 'Put back the counts you typed.'
      : 'Put back the counts you had before the reset.',
  );
}
</script>

<template>
  <div v-if="view" class="node-presets">
    <span class="eyebrow">Your world settings <HelpTip name="nodePresets" /></span>
    <div class="form-grid">
      <SelectField
        label="Resource node randomization"
        name="distribution"
        :options="distributions"
        :value="view.distribution"
      />
      <SelectField
        label="Resource node purity"
        name="purity"
        :options="purities"
        :value="view.purity"
      />
    </div>
    <p v-if="view.status === 'filled'" class="small">
      The counts below are the map's node totals at <b>{{ view.label }}</b
      >.<template v-if="view.shuffled">
        Random moves nodes around the map; as far as the community has established, it does not
        change how many of each resource there are. Nitrogen wells are left for you: a well is
        randomized whole and the map’s wells hold different numbers of satellites, so a shuffle can
        still leave you more or less nitrogen than the default map.</template
      >
      Change any that do not match your save.
    </p>
    <p v-else-if="view.status === 'fillable'" class="small">
      Your world's node counts are known for these settings.
      <button type="button" class="btn quiet" :data-node-preset="view.purity" @click="fill">
        Fill in the counts below
      </button>
    </p>
    <div v-else-if="view.status === 'split'" class="notice">
      <b>Only the purity split is missing.</b> Random shuffles which resource sits at each location,
      so your world holds the same number of nodes for each resource as the default map — but it
      shuffles their purities too, and <b>{{ view.purityLabel }}</b> keeps whatever split the
      shuffle produced. How many are impure, normal and pure is therefore yours to count. If you
      actually chose All Pure, Average or All Impure, pick that above and the counts fill
      in.<template v-if="view.active">
        The counts below are still the map's totals at <b>{{ view.label }}</b> — the totals are
        right, the split is not.</template
      >
    </div>
    <div v-else class="notice">
      <b>No preset for these settings.</b>
      <template v-if="view.rich"
        >A resource-rich distribution changes how many nodes each resource has, and the players who
        have counted these worlds get answers a third apart from one seed to the next — so filling
        anything in here would be a guess wearing a number. {{ view.rich }} Which way it goes is
        consistent; how far is not.</template
      ><template v-else>A random or hand-set purity has no fixed split to rearrange.</template>
      Count yours on the map linked on the first screen, or upload your save there and it will count
      them for you.<template v-if="view.active">
        The counts below are still the <b>map's totals at {{ view.label }}</b
        >, so check them against your save.</template
      >
    </div>
    <p class="small">
      <template v-if="view.undo === 'refill'"
        ><button type="button" class="btn quiet" data-node-undo @click="undo">Undo refill</button>
        <span class="muted"
          >Your typed counts were replaced by the map's totals for these settings. This puts them
          back; the world settings above stay as you chose them.</span
        ></template
      ><template v-else-if="view.undo"
        ><button type="button" class="btn quiet" data-node-undo @click="undo">Undo reset</button>
        <span class="muted"
          >Every count was cleared. This puts back what was there before.</span
        ></template
      ><template v-else
        ><button type="button" class="btn quiet" data-node-reset @click="reset">
          Reset all counts to zero
        </button>
        <span class="muted"
          >Clears every ore, well and committed amount so you can enter your own. You can undo
          it.</span
        ></template
      >
    </p>
    <p class="small muted">
      The purity settings do not move nodes or add any, they shift every node up or down the purity
      scale, so a known purity is the known node count rearranged. Oil wells are not in that table —
      count those yourself.
    </p>
  </div>
</template>
