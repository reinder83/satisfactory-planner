<!--
  "Belts & pipes" in a factory dialog: for every input of the flow model, how many lanes of
  the best available mark it needs (and, until its milestone is ticked, which one it needs and the
  mark to plan with until then, #1065; a belt the plan says the player already has needs none,
  #1068), how many machines one lane feeds (manifold rows), and
  whether the last lane's spare capacity could also carry another factory's demand for the
  same item. Draws nothing without inputs.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { bestLane, laneUnlockNote } from '../../flow.ts';
import { phaseLabel } from '../../session.ts';
import ItemIcon from '../ItemIcon.vue';
import { factoryLink } from '../actions.ts';
import type { FlowModel } from '../../flow.ts';
import type { FactoryLink } from '../actions.ts';

const props = withDefaults(defineProps<{ model?: FlowModel | null }>(), { model: null });

// How one full lane feeds the machines: a sentence, or the lane, the share of machines it
// feeds, each machine's draw and how many that is.
interface FeedAdvice {
  text?: string;
  lane?: string;
  share?: string;
  each?: string;
  fed?: number;
}
// Spare capacity on the last lane, and the factories whose demand would fit on it.
interface SpareAdvice {
  word: string;
  amount: string;
  merge: { link: FactoryLink; text: string }[];
}
interface AdviceRow {
  name: string;
  rate: string;
  lanes: string;
  split: string;
  feed: FeedAdvice | null;
  spare: SpareAdvice | null;
}

// The last lane's rate as printed. A remainder that rounds to 0 at two decimals (a rate a hair
// over a multiple) says so, rather than a lane carrying "0/min".
const lastRate = (rate: number) => (num(rate) === '0' ? 'under 0.01' : num(rate));

const advice = computed(() => {
  const model = props.model;
  if (!model || !model.inputs.length) return null;
  const belts = bestLane(false, model.stage),
    pipes = bestLane(true, model.stage);
  return {
    // A belt the player already has (#1068) is theirs, not the phase's milestones'.
    intro:
      (belts.owned
        ? `${phaseLabel(model.stage)} plans with the ${belts.mark} belts you already have (${num(belts.cap)}/min); its milestones give `
        : `${phaseLabel(model.stage)} milestones give ${belts.mark} belts (${num(belts.cap)}/min) and `) +
      `${pipes.mark} pipes (${num(pipes.cap)} m³/min).` +
      (belts.next?.milestone
        ? ` ${belts.next.mark} belts (${num(belts.next.cap)}/min) unlock at Tier ${belts.next.milestone.tier} · ${belts.next.milestone.name} in Phase ${belts.next.milestone.phase}.`
        : ''),
    // What the marks still need (#1065): their milestones, until ticked.
    unlock: [laneUnlockNote(belts), laneUnlockNote(pipes)].filter(Boolean).join(' '),
    rows: model.inputs.map(input => {
      // perMachine: what one machine at 100% draws; fed: how many such machines one full lane
      // feeds.
      const plan = input.plan,
        lane = plan.lane,
        perMachine = input.rate / model.equivalent,
        fed = Math.floor(lane.cap / perMachine + 1e-9);
      const row: AdviceRow = {
        name: input.name,
        rate: num(input.rate) + lane.unit,
        lanes: `${plan.count} × ${lane.mark} ${plan.word}${plan.count > 1 ? 's' : ''}`,
        split:
          plan.count > 1
            ? plan.full === plan.count
              ? ` — all ${plan.count} full`
              : ` — ${plan.full} full + 1 carrying ${lastRate(plan.last)}${lane.unit}`
            : ` (${Math.round((input.rate / lane.cap) * 100)}% of ${num(lane.cap)}${lane.unit})`,
        feed: null,
        spare: null,
      };
      if (model.machineCount > 1)
        row.feed =
          fed < 1
            ? {
                text: `Each machine takes ${num(perMachine)}${lane.unit} — more than one ${lane.mark} ${plan.word} carries, so give machines dedicated feeds.`,
              }
            : model.machineCount > fed
              ? {
                  lane: `${lane.mark} ${plan.word}`,
                  share: `${fed} of the ${num(model.machineCount)} machines`,
                  each: `${num(perMachine)}${lane.unit}`,
                  fed,
                }
              : {
                  text: `One ${lane.mark} ${plan.word} feeds all ${num(model.machineCount)} machines (${num(perMachine)}${lane.unit} each).`,
                };
      // Other factories whose whole demand for this item fits in the spare capacity; at most
      // two are offered, joined by " or ".
      if (plan.count > 1 && plan.spare > 0.01)
        row.spare = {
          word: plan.word,
          amount: num(plan.spare) + lane.unit,
          merge: model
            .sameItemConsumers(input.name)
            .filter(consumer => consumer.rate <= plan.spare + 0.01)
            .slice(0, 2)
            .map(consumer => ({
              link: consumer.link,
              text: `${consumer.label} (${num(consumer.rate)}${lane.unit}) ↗`,
            })),
        };
      return row;
    }),
  };
});
</script>

<template>
  <template v-if="advice">
    <h3>Belts &amp; pipes</h3>
    <p class="small muted">
      {{ advice.intro }}<template v-if="advice.unlock"> {{ advice.unlock }}</template>
    </p>
    <div class="logi">
      <div v-for="row in advice.rows" :key="row.name" class="logi-row">
        <ItemIcon :name="row.name" />
        <div>
          <b>{{ row.name }}</b>
          <p>
            <b>{{ row.rate }}</b> → <b>{{ row.lanes }}</b
            >{{ row.split }}.
          </p>
          <p v-if="row.feed?.text">{{ row.feed.text }}</p>
          <p v-else-if="row.feed">
            One full {{ row.feed.lane }} feeds <b>{{ row.feed.share }}</b> ({{
              row.feed.each
            }}
            each) — plan manifold rows of {{ row.feed.fed }}.
          </p>
          <p v-if="row.spare">
            The last {{ row.spare.word }} has <b>{{ row.spare.amount }} spare</b> —
            <template v-if="row.spare.merge.length"
              >enough to also carry
              <template v-for="(merge, i) in row.spare.merge" :key="i"
                >{{ i ? ' or ' : ''
                }}<button class="btn quiet" v-bind="factoryLink(merge.link)">
                  {{ merge.text }}
                </button></template
              >
              from the same bus</template
            ><template v-else>keep it as expansion headroom on this manifold</template>.
          </p>
        </div>
      </div>
    </div>
  </template>
</template>
