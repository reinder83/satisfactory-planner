<!-- A factory group's build order (groupChain in factory-detail.ts): suppliers before
     consumers, each stage with what it needs and what it feeds, linked to its factory dialog.
     Opened from "Build order ↗" on a group with more than one factory. "build order" in the
     eyebrow is joined by a no-break space, so the eyebrow wrapping on a phone (#454) keeps it
     whole (#460). Its title is the group's
     name, which the user typed (up to 80 characters) and the body does not repeat, so on a phone
     it wraps rather than being cut short (#435). -->
<script setup lang="ts">
import { computed } from 'vue';
import { groupChain } from '../../factory-detail.ts';
import { phaseLabel, stage } from '../../session.ts';
import { legacy } from '../bridge.ts';
import DialogFrame from './DialogFrame.vue';
import { factoryLink } from '../actions.ts';

const props = defineProps<{ id: string }>();
// The eyebrow's start; a no-break space keeps "build order" on one line (#460).
const EYEBROW = 'Factory group · build\u00a0order';

const chain = computed(() =>
  legacy(() => {
    const buildOrder = groupChain(props.id);
    return buildOrder && { ...buildOrder, phase: phaseLabel(stage()) };
  }),
);
</script>

<template>
  <DialogFrame
    v-if="chain && !chain.stages.length"
    :title="chain.name"
    wrap-title
    :subtitle="EYEBROW"
  >
    <p class="small muted">No factories from this group produce anything in the current phase.</p>
  </DialogFrame>
  <DialogFrame
    v-else-if="chain"
    :title="chain.name"
    wrap-title
    :subtitle="EYEBROW + ' · ' + chain.phase"
  >
    <p class="small muted">
      Stages are ordered so suppliers come before their consumers. An input marked <b>loop</b> is
      produced by a later stage: run that stage from a starter batch first, then close the loop.
    </p>
    <div class="chain">
      <div v-for="chainStage in chain.stages" :key="chainStage.id" class="chain-stage">
        <span class="chain-no">{{ chainStage.no }}</span>
        <div class="chain-body">
          <div class="chain-title">
            <button class="rail-link" v-bind="factoryLink(chainStage.link)">
              {{ chainStage.name }} ↗</button
            ><span class="muted">{{ chainStage.machines }}</span>
          </div>
          <p v-if="chainStage.needs.length" class="small">
            <b>Needs</b
            ><template v-for="(need, i) in chainStage.needs" :key="i"
              ><br />{{ need.text }}
              <span class="muted"
                >· <b v-if="need.loop" class="chain-loop">loop — seed a starter batch</b
                ><template v-else>{{ need.from }}</template></span
              ></template
            >
          </p>
          <p v-else class="small muted">No belt or pipe inputs.</p>
          <p class="small">
            <b>Feeds</b><br /><template v-if="chainStage.feeds.length"
              ><template v-for="(feed, i) in chainStage.feeds" :key="i"
                ><br v-if="i" />{{ feed }}</template
              ></template
            ><template v-else>{{ chainStage.power ? 'Power grid' : '—' }}</template>
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
