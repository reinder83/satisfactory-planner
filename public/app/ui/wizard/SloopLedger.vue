<!--
  The somersloop ledger on All settings step 2. Each augmenter costs 10 sloops. Augmenters and
  their fuel change the calculation; the hand-fed lines do not (their inputs are gathered, never
  belted), so their checkboxes (name="sloop", read back by readWizard as settings.sloopReserved)
  only reserve sloops and add steps.

  It follows the step's fields as they are typed (#1059): the somersloops available, the
  augmenters, the fueled ones, the amplification budget and the hand-fed boxes are read from the
  form on every input and change, not written to the draft (readWizard does that when the step
  is left, as before), so a box being cleared to type a new number is never filled back in.
  Until a field is touched it shows the draft. The budget is a hard limit (public/somersloops.ts):
  a commitment beyond it turns the ledger into a warning, and Review is refused until it fits.
  With an amplification budget it says from which phase amplification is planned: the phase of
  the MAM's Production Amplifier research (AMPLIFIER_PHASE, #1056).
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { num } from '../../format.ts';
import { wizard, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import {
  AMPLIFIER_PHASE,
  AMPLIFIER_RESEARCH,
  sloopCommitment,
  sloopPartsWords,
  type SloopSettings,
} from '../../../somersloops.ts';

// The ledger's fields as the form holds them now, once one has been touched.
type Typed = Required<Pick<SloopSettings, 'somersloops' | 'augmenters' | 'amplifySloops'>> & {
  fueledAugmenters: number;
  sloopReserved: string[];
};
const typed = ref<Typed | null>(null);
const ledger = ref<HTMLElement | null>(null);
let form: HTMLFormElement | null = null;

// A number box as a count: empty or not a number reads as 0, as the ledger has nothing else.
const field = (name: string) => {
  const value = Number((form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
  return Number.isFinite(value) ? value : 0;
};
function follow() {
  if (!form) return;
  typed.value = {
    somersloops: field('somersloops'),
    augmenters: field('augmenters'),
    fueledAugmenters: field('fueledAugmenters'),
    amplifySloops: field('amplifySloops'),
    sloopReserved: [...form.querySelectorAll<HTMLInputElement>('input[name=sloop]:checked')].map(
      box => box.value,
    ),
  };
}
onMounted(() => {
  form = ledger.value?.closest('form') ?? null;
  form?.addEventListener('input', follow);
  form?.addEventListener('change', follow);
});
onBeforeUnmount(() => {
  form?.removeEventListener('input', follow);
  form?.removeEventListener('change', follow);
  form = null;
});

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const settings = wizard.settings,
      reserved: string[] = settings.sloopReserved || [];
    const now = typed.value ?? {
      somersloops: settings.somersloops || 0,
      augmenters: settings.augmenters || 0,
      fueledAugmenters: settings.fueledAugmenters || 0,
      amplifySloops: settings.amplifySloops || 0,
      sloopReserved: reserved,
    };
    const commitment = sloopCommitment(now);
    const augmenters = commitment.augmenters,
      fueled = Math.min(Math.max(0, Math.floor(now.fueledAugmenters)), augmenters);
    return {
      augmenters,
      fueled,
      sloops: num(commitment.augmenterSloops),
      mw: num(500 * augmenters),
      boost: Math.round((0.1 * (augmenters - fueled) + 0.3 * fueled) * 100),
      matrix: num(5 * fueled),
      committed: num(commitment.committed),
      parts: commitment.committed ? sloopPartsWords(commitment) : '',
      have: num(commitment.available),
      over: commitment.over,
      overText: num(commitment.over),
      amplify: commitment.amplify,
      // The boxes start as the draft has them; the browser keeps what is ticked since.
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
    <div ref="ledger" class="notice" :class="view.over ? 'warn' : 'info'" data-sloop-ledger>
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
      <b data-sloop-committed>{{ view.committed }}</b> of
      <span data-sloop-available>{{ view.have }}</span> available<template v-if="view.parts">
        ({{ view.parts }})</template
      >.<template v-if="view.over"
        >{{ ' ' }}<b>That is {{ view.overText }} more than you have</b>, so Review will not
        calculate this plan: raise the somersloops available, or build fewer augmenters, park fewer
        in hand-fed lines or lower the amplification budget.</template
      >
    </div>
    <p v-if="view.amplify" class="small muted">
      Production amplification will place up to {{ num(view.amplify) }} somersloops in this plan's
      own machines. An amplified machine keeps its inputs, doubles its output and draws four times
      the power, so it trades power for ore and buildings. The budget applies to each phase's plan
      rather than adding up across phases, because every phase is a self-contained steady state.
      <span data-amp-from
        >Amplification starts in Phase {{ AMPLIFIER_PHASE }}: machines take somersloops only after
        the MAM research {{ AMPLIFIER_RESEARCH }}, which needs SAM Fluctuators and Circuit Boards,
        so earlier phases are planned without it.</span
      >
    </p>
    <p v-else class="small muted" data-explain>
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
    <p class="small muted" data-explain>
      These double the output of a finite, hand-gathered input, so they are usually the best sloop
      you will ever spend: the world's power slugs are worth twice as many Power Shards through an
      amplified Constructor. Their inputs are carried in by hand, so they stay out of the production
      balance and only reserve a sloop and add a checklist step. The Crafting Bench cannot be
      amplified — the constructor recipe is the one that doubles.
    </p>
  </template>
</template>
