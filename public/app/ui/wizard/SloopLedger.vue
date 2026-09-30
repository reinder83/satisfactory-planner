<!--
  The somersloop ledger on All settings step 2, drawn from the settings as last read, so its
  totals refresh on the next redraw rather than as you type. Each augmenter costs 10 sloops.
  Augmenters and their fuel change the calculation; the hand-fed lines do not (their inputs
  are gathered, never belted), so their checkboxes (name="sloop", read back by readWizard as
  settings.sloopReserved) only reserve sloops and add steps.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { wizard, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const settings = wizard.settings,
      reserved: string[] = settings.sloopReserved || [];
    const augmenters = settings.augmenters || 0,
      fueled = settings.fueledAugmenters || 0;
    return {
      augmenters,
      fueled,
      sloops: 10 * augmenters,
      mw: num(500 * augmenters),
      boost: Math.round((0.1 * (augmenters - fueled) + 0.3 * fueled) * 100),
      matrix: num(5 * fueled),
      committed: 10 * augmenters + reserved.length + (settings.amplifySloops || 0),
      have: settings.somersloops || 0,
      amplify: settings.amplifySloops || 0,
      uses: (workspace.catalog.sloopUses || []).map(([id, label]) => ({
        id,
        label,
        on: reserved.includes(id),
      })),
    };
  }),
);
</script>

<template>
  <template v-if="view">
    <div class="notice info">
      <b>Somersloop ledger.</b>
      <template v-if="view.augmenters"
        >{{ view.augmenters }} augmenter{{ view.augmenters > 1 ? 's' : '' }} cost
        {{ view.sloops }} sloops and give Phase 5 {{ view.mw }} MW plus a {{ view.boost }}%
        multiplier on the grid's base production.
        {{
          view.fueled
            ? `Fueling ${view.fueled} of them adds ${view.matrix} Alien Power Matrix/min to the plan — the rate is derived here, never entered.`
            : 'Unfueled augmenters need no Alien Power Matrix.'
        }}</template
      ><template v-else>Enter augmenters to include their power in Phase 5.</template> Committed:
      <b>{{ view.committed }}</b> of {{ view.have }} available.<template
        v-if="view.committed > view.have"
        >{{ ' ' }}<span class="warn">More than you have.</span></template
      >
    </div>
    <p v-if="view.amplify" class="small muted">
      Production amplification will place up to {{ num(view.amplify) }} somersloops in this plan's
      own machines. An amplified machine keeps its inputs, doubles its output and draws four times
      the power, so it trades power for ore and buildings. The budget applies to each phase's plan
      rather than adding up across phases, because every phase is a self-contained steady state.
    </p>
    <p v-else class="small muted">
      Production amplification is off. Somersloops in your production lines cut ore and buildings,
      but finding and reaching them is a hunt — leave this at 0 to plan without it, exactly as
      before.
    </p>
    <p class="eyebrow">SOMERSLOOPS PARKED IN HAND-FED LINES</p>
    <div>
      <label v-for="use in view.uses" :key="use.id" class="check-row"
        ><input type="checkbox" name="sloop" :value="use.id" :checked="use.on" />{{
          use.label
        }}</label
      >
    </div>
    <p class="small muted">
      These double the output of a finite, hand-gathered input, so they are usually the best sloop
      you will ever spend: the world's power slugs are worth twice as many Power Shards through an
      amplified Constructor. Their inputs are carried in by hand, so they stay out of the production
      balance and only reserve a sloop and add a checklist step. The Crafting Bench cannot be
      amplified — the constructor recipe is the one that doubles.
    </p>
  </template>
</template>
