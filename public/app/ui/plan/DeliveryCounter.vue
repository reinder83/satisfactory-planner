<!--
  One Space Elevator delivery counter on the build plan. `delivery` is { id, name, target,
  rate, initial }: a handbook delivery from plan.json, or a calculated one with the id
  `<stage>-<item slug>` and initial 0. An unsaved count falls back to `initial` only on the
  original profile. A committed entry must be a whole number from 0 to the target; an
  invalid one, or a failed write, puts the saved count back.
-->
<script setup>
import { computed } from 'vue';
import { save, toast } from '../../api.js';
import { num } from '../../format.js';
import { currentProfile, state } from '../../session.js';
import { render } from '../../shell.js';
import { legacy } from '../bridge.js';

const props = defineProps({ delivery: { type: Object, required: true } });

const saved = () =>
  state.deliveries[props.delivery.id] ??
  (currentProfile.id === 'original' ? props.delivery.initial : 0);

const counter = computed(() =>
  legacy(() => {
    const d = props.delivery,
      v = saved();
    return {
      value: v,
      width: Math.min(100, (v / d.target) * 100),
      remaining: d.rate
        ? `${num(d.rate)}/min net · ${num(Math.max(0, d.target - v) / d.rate)} minutes remaining`
        : 'Phase 3 delivery already complete',
    };
  }),
);

async function change(e) {
  const el = e.target,
    d = props.delivery,
    v = Number(el.value);
  if (!Number.isInteger(v) || v < 0 || v > d.target) {
    toast('Enter a whole number between 0 and ' + num(d.target) + '.', true);
    el.value = saved();
    return;
  }
  try {
    await save({ type: 'delivery', key: d.id, value: v });
    render();
  } catch {
    el.value = saved();
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
