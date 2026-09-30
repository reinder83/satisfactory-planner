<!--
  One Space Elevator delivery counter on the build plan. `delivery` is { id, name, target,
  rate, initial }: a handbook delivery from plan.json, or a calculated one with the id
  `<stage>-<item slug>` and initial 0. An unsaved count falls back to `initial` only on an
  original (handbook) profile, by kind rather than id, so a duplicated or imported copy does
  too. A committed entry must be a whole number from 0 to the target; an invalid one, or a
  failed write, puts the saved count back.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { save, toast } from '../../api.ts';
import { duration, num } from '../../format.ts';
import { currentProfile, state } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import { settle, useDraft } from '../draft.ts';

// A delivery of the current phase: a handbook one (with the amount handed in when the
// handbook was written) or a calculated plan's.
const props = defineProps<{
  delivery: { id: string; name: string; target: number; rate: number; initial?: number };
}>();

const saved = () =>
  state.deliveries[props.delivery.id] ??
  (currentProfile.kind === 'original' ? (props.delivery.initial ?? 0) : 0);

const counter = computed(() =>
  legacy(() => {
    const delivery = props.delivery,
      count = saved(),
      left = Math.max(0, delivery.target - count);
    // The text follows the saved count: at the target it reads complete, with or without a
    // rate (#596), and a lowered count no longer does (#590). Without a rate there are no
    // minutes to give; with one the wait reads as a plain duration (#624). It names no phase, as the calculated plan draws every phase's (#595).
    return {
      value: count,
      width: Math.min(100, (count / delivery.target) * 100),
      remaining: !left
        ? 'Delivery complete'
        : delivery.rate
          ? `${num(delivery.rate)}/min net · ${duration(left / delivery.rate)} left`
          : `${num(left)} remaining`,
    };
  }),
);

// What the input shows: the saved count, then what the user types, so a redraw while another
// control saves keeps a number typed but not yet committed (#627, ui/draft.ts). A new saved count
// (a reload from another tab) replaces what is shown while nothing has been typed. The counter
// stays editable while it saves, so a number typed meanwhile is kept when that save returns, and
// saved when it is committed in turn (#664).
const draft = useDraft(() => String(counter.value.value));

// A refused entry shows the saved count again at once; a save, done or failed, does so unless
// another number has been typed since it started (`shown` is the draft then).
function putBack(input: HTMLInputElement, shown = draft.value) {
  if (settle(draft, shown, String(saved()))) input.value = draft.value;
}

async function change(event: Event) {
  const input = event.target as HTMLInputElement,
    delivery = props.delivery,
    count = Number(input.value);
  if (!Number.isInteger(count) || count < 0 || count > delivery.target) {
    toast('Enter a whole number between 0 and ' + num(delivery.target) + '.', true);
    putBack(input);
    return;
  }
  const shown = draft.value;
  try {
    await save({ type: 'delivery', key: delivery.id, value: count });
    render();
  } catch {}
  putBack(input, shown);
}
</script>

<template>
  <div class="delivery">
    <label :for="'delivery-' + delivery.id">{{ delivery.name }}</label>
    <div>
      <input
        :id="'delivery-' + delivery.id"
        :data-delivery="delivery.id"
        type="number"
        min="0"
        :max="delivery.target"
        step="1"
        :value="draft"
        @input="draft = ($event.target as HTMLInputElement).value"
        @change="change"
      /><small>/ {{ num(delivery.target) }}</small>
    </div>
    <div class="progress-track">
      <span :style="{ width: counter.width + '%' }"></span>
    </div>
    <span class="small muted">{{ counter.remaining }}</span>
  </div>
</template>
