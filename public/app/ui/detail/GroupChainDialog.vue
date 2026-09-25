<!-- A factory group's build order (groupChain in factory-detail.js): suppliers before
     consumers, each stage with what it needs and what it feeds, linked to its factory dialog.
     Opened from "Build order ↗" on a group with more than one factory. -->
<script setup>
import { computed } from 'vue';
import { groupChain } from '../../factory-detail.js';
import { phaseLabel, stage } from '../../session.js';
import { legacy } from '../bridge.js';
import DialogFrame from './DialogFrame.vue';
import { factoryLink } from '../actions.js';

const props = defineProps({ id: { type: String, required: true } });

const chain = computed(() =>
  legacy(() => {
    const c = groupChain(props.id);
    return c && { ...c, phase: phaseLabel(stage()) };
  }),
);
</script>

<template>
  <DialogFrame
    v-if="chain && !chain.stages.length"
    :title="chain.name"
    subtitle="Factory group · build order"
  >
    <p class="small muted">No factories from this group produce anything in the current phase.</p>
  </DialogFrame>
  <DialogFrame
    v-else-if="chain"
    :title="chain.name"
    :subtitle="'Factory group · build order · ' + chain.phase"
  >
    <p class="small muted">
      Stages are ordered so suppliers come before their consumers. An input marked <b>loop</b> is
      produced by a later stage: run that stage from a starter batch first, then close the loop.
    </p>
    <div class="chain">
      <div v-for="s in chain.stages" :key="s.id" class="chain-stage">
        <span class="chain-no">{{ s.no }}</span>
        <div class="chain-body">
          <div class="chain-title">
            <button class="rail-link" v-bind="factoryLink(s.link)">{{ s.name }} ↗</button
            ><span class="muted">{{ s.machines }}</span>
          </div>
          <p v-if="s.needs.length" class="small">
            <b>Needs</b
            ><template v-for="(n, i) in s.needs" :key="i"
              ><br />{{ n.text }}
              <span class="muted"
                >· <b v-if="n.loop" class="chain-loop">loop — seed a starter batch</b
                ><template v-else>{{ n.from }}</template></span
              ></template
            >
          </p>
          <p v-else class="small muted">No belt or pipe inputs.</p>
          <p class="small">
            <b>Feeds</b><br /><template v-if="s.feeds.length"
              ><template v-for="(f, i) in s.feeds" :key="i"
                ><br v-if="i" />{{ f }}</template
              ></template
            ><template v-else>{{ s.power ? 'Power grid' : '—' }}</template>
          </p>
        </div>
      </div>
    </div>
    <p v-if="chain.split" class="small muted">
      Rates are the whole plan’s totals; this group’s production split is shown on the factory
      cards.
    </p>
  </DialogFrame>
</template>
