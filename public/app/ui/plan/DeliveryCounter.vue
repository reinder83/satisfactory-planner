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
import { num } from '../../format.ts';
import { currentProfile, state } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';

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
    // Without a rate there are no minutes to give: the text follows the saved count, so a
    // lowered count no longer reads as complete (#590).
    return {
      value: count,
      width: Math.min(100, (count / delivery.target) * 100),
      remaining: delivery.rate
        ? `${num(delivery.rate)}/min net · ${num(left / delivery.rate)} minutes remaining`
        : left
          ? `${num(left)} remaining`
          : 'Phase 3 delivery already complete',
    };
  }),
);

async function change(event: Event) {
  const input = event.target as HTMLInputElement,
    delivery = props.delivery,
    count = Number(input.value);
  if (!Number.isInteger(count) || count < 0 || count > delivery.target) {
    toast('Enter a whole number between 0 and ' + num(delivery.target) + '.', true);
    input.value = String(saved());
    return;
  }
  try {
    await save({ type: 'delivery', key: delivery.id, value: count });
    render();
  } catch {
    input.value = String(saved());
  }
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
        :value="counter.value"
        @change="change"
      /><small>/ {{ num(delivery.target) }}</small>
    </div>
    <div class="progress-track">
      <span :style="{ width: counter.width + '%' }"></span>
    </div>
    <span class="small muted">{{ counter.remaining }}</span>
  </div>
</template>
