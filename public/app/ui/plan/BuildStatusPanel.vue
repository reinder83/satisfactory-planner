<!--
  "Built so far" on a calculated profile's plan page (#66): from the factory rows ticked as
  built, how much of each Space Elevator part reaches the elevator now, the step to build next,
  built rows held back by a missing supplier, and a power warning. The numbers come from
  currentBuildStatus() (views/calculated.ts, build-status.ts); nothing here recalculates the plan.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { calcStage } from '../../session.ts';
import { currentBuildStatus } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';

// At most this many held-back rows are listed; the rest are counted.
const MAX_WAITING = 5;
const pct = (x: number) => Math.round(x * 100);

const view = computed(() =>
  legacy(() => {
    const s = currentBuildStatus();
    if (!s) return null;
    const name = (id: string) => calcStage()?.rows?.find(r => r.id === id)?.name || id;
    const waiting = s.rows
      .filter(r => r.built && r.share < 1 && r.shortOf)
      .map(r => ({
        id: r.id,
        name: name(r.id),
        text: `running at ${pct(r.share)}%, short of ${r.shortOf}`,
      }));
    const next = s.next && {
      id: s.next.id,
      name: name(s.next.id),
      why:
        s.next.gain > 0
          ? `adds ${Math.max(1, pct(s.next.gain))}% of the elevator delivery`
          : s.next.unblocks > 0
            ? `gets ${num(s.next.unblocks)} built machine${s.next.unblocks === 1 ? '' : 's'} running`
            : 'is the next unbuilt step in build order',
    };
    return {
      built: s.builtCount,
      total: s.rowCount,
      share: pct(s.deliveryShare),
      delivery: s.delivery.map(d => ({
        item: d.item,
        text: `${num(d.now)} of ${num(d.planned)} / min now`,
        width: d.planned > 0 ? Math.min(100, (d.now / d.planned) * 100) : 0,
      })),
      next,
      waiting: waiting.slice(0, MAX_WAITING),
      more: Math.max(0, waiting.length - MAX_WAITING),
      power: s.power.short
        ? `The built factories draw ${power(s.power.drawMW)}, more than the ${power(s.power.supplyMW)} from built generators and the spare power you listed.`
        : '',
    };
  }),
);
</script>

<template>
  <section v-if="view" class="panel build-status" data-build-status>
    <h2>Built so far</h2>
    <p class="small muted">
      {{ view.built }} of {{ view.total }} factories marked running. Raw resources count as mined;
      the rest follows from what is built.
    </p>
    <div v-for="d in view.delivery" :key="d.item" class="delivery">
      <label>{{ d.item }}</label>
      <div class="progress-track"><span :style="{ width: d.width + '%' }"></span></div>
      <span class="small muted" data-build-rate>{{ d.text }}</span>
    </div>
    <p v-if="view.built && !view.share" class="small" data-build-none>
      Nothing reaches the elevator yet.
    </p>
    <p v-else-if="view.delivery.length" class="small">
      {{ view.share }}% of the phase's delivery rate is flowing.
    </p>
    <p v-if="view.next" class="small" data-build-next>
      Build next:
      <button class="link" v-bind="factoryLink({ calcFactory: view.next.id })">
        {{ view.next.name }}</button
      >, which {{ view.next.why }}.
    </p>
    <p v-else class="small" data-build-next>Every factory of this phase is marked running.</p>
    <div v-if="view.waiting.length" class="notice" data-build-waiting>
      <b>Built but waiting on a supplier</b>
      <ul>
        <li v-for="w in view.waiting" :key="w.id">
          <button class="link" v-bind="factoryLink({ calcFactory: w.id })">{{ w.name }}</button>:
          {{ w.text }}
        </li>
      </ul>
      <p v-if="view.more">And {{ view.more }} more.</p>
    </div>
    <div v-if="view.power" class="notice" data-build-power>{{ view.power }}</div>
  </section>
</template>
