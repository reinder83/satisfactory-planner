<!--
  "Built so far" on a calculated profile's plan page (#66): from the factory rows ticked as
  built, how much of each Space Elevator part reaches the elevator now, the step to build next,
  built rows held back by a missing supplier, and a power warning. The numbers come from
  currentBuildStatus() (views/calculated.ts, build-status.ts); nothing here recalculates the plan.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { buildRowName, currentBuildStatus } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';

// At most this many held-back rows are listed; the rest are counted.
const MAX_WAITING = 5;
const percent = (share: number) => Math.round(share * 100);

const view = computed(() =>
  legacy(() => {
    const status = currentBuildStatus();
    if (!status) return null;
    const waiting = status.rows
      .filter(r => r.built && r.share < 1 && r.shortOf)
      .map(row => ({
        id: row.id,
        name: buildRowName(row.id),
        text: `running at ${percent(row.share)}%, short of ${row.shortOf}`,
      }));
    const next = status.next && {
      id: status.next.id,
      name: buildRowName(status.next.id),
      why:
        status.next.gain > 0
          ? `adds ${Math.max(1, percent(status.next.gain))}% of the elevator delivery`
          : status.next.unblocks > 0
            ? `gets ${num(status.next.unblocks)} built machine${status.next.unblocks === 1 ? '' : 's'} running`
            : 'is the next unbuilt step in build order',
    };
    return {
      built: status.builtCount,
      total: status.rowCount,
      share: percent(status.deliveryShare),
      delivery: status.delivery.map(delivery => ({
        item: delivery.item,
        text: `${num(delivery.now)} of ${num(delivery.planned)}/min now`,
        width: delivery.planned > 0 ? Math.min(100, (delivery.now / delivery.planned) * 100) : 0,
      })),
      next,
      waiting: waiting.slice(0, MAX_WAITING),
      more: Math.max(0, waiting.length - MAX_WAITING),
      power: status.power.short
        ? `The built factories draw ${power(status.power.drawMW)}, more than the ${power(status.power.supplyMW)} from built generators and the spare power you listed.`
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
    <div v-for="delivery in view.delivery" :key="delivery.item" class="delivery">
      <label>{{ delivery.item }}</label>
      <div class="progress-track"><span :style="{ width: delivery.width + '%' }"></span></div>
      <span class="small muted" data-build-rate>{{ delivery.text }}</span>
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
    <div v-if="view.waiting.length" class="notice warn" data-build-waiting>
      <b>Built but waiting on a supplier</b>
      <ul>
        <li v-for="row in view.waiting" :key="row.id">
          <button class="link" v-bind="factoryLink({ calcFactory: row.id })">{{ row.name }}</button
          >:
          {{ row.text }}
        </li>
      </ul>
      <p v-if="view.more">And {{ view.more }} more.</p>
    </div>
    <div v-if="view.power" class="notice warn" data-build-power>{{ view.power }}</div>
  </section>
</template>
