<!--
  "Belts & pipes" in a factory dialog: for every input of the flow model, how many lanes of
  the best available mark it needs, how many machines one lane feeds (manifold rows), and
  whether the last lane's spare capacity could also carry another factory's demand for the
  same item. Draws nothing without inputs.
-->
<script setup>
import { computed } from 'vue';
import { num } from '../../format.ts';
import { bestLane } from '../../flow.js';
import { phaseLabel } from '../../session.js';
import ItemIcon from '../ItemIcon.vue';
import { factoryLink } from '../actions.js';

const props = defineProps({ model: { type: Object, default: null } });

const advice = computed(() => {
  const m = props.model;
  if (!m || !m.inputs.length) return null;
  const belts = bestLane(false, m.stage),
    pipes = bestLane(true, m.stage);
  return {
    intro:
      `${phaseLabel(m.stage)} milestones give ${belts.mark} belts (${num(belts.cap)}/min) and ` +
      `${pipes.mark} pipes (${num(pipes.cap)} m³/min).` +
      (belts.next?.milestone
        ? ` ${belts.next.mark} belts (${num(belts.next.cap)}/min) unlock at Tier ${belts.next.milestone.tier} · ${belts.next.milestone.name} in Phase ${belts.next.milestone.phase}.`
        : ''),
    rows: m.inputs.map(i => {
      // per: what one machine at 100% draws; fed: how many such machines one full lane feeds.
      const p = i.plan,
        l = p.lane,
        per = i.rate / m.equivalent,
        fed = Math.floor(l.cap / per + 1e-9);
      const row = {
        name: i.name,
        rate: num(i.rate) + l.unit,
        lanes: `${p.count} × ${l.mark} ${p.word}${p.count > 1 ? 's' : ''}`,
        split:
          p.count > 1
            ? ` — ${p.full} full + 1 carrying ${num(p.last)}${l.unit}`
            : ` (${Math.round((i.rate / l.cap) * 100)}% of ${num(l.cap)}${l.unit})`,
        feed: null,
        spare: null,
        local: i.local,
      };
      if (m.machineCount > 1)
        row.feed =
          fed < 1
            ? {
                text: `Each machine takes ${num(per)}${l.unit} — more than one ${l.mark} ${p.word} carries, so give machines dedicated feeds.`,
              }
            : m.machineCount > fed
              ? {
                  lane: `${l.mark} ${p.word}`,
                  share: `${fed} of the ${num(m.machineCount)} machines`,
                  each: `${num(per)}${l.unit}`,
                  fed,
                }
              : {
                  text: `One ${l.mark} ${p.word} feeds all ${num(m.machineCount)} machines (${num(per)}${l.unit} each).`,
                };
      // Other factories whose whole demand for this item fits in the spare capacity; at most
      // two are offered, joined by " or ".
      if (p.count > 1 && p.spare > 0.01)
        row.spare = {
          word: p.word,
          amount: num(p.spare) + l.unit,
          merge: m
            .sameItemConsumers(i.name)
            .filter(x => x.rate <= p.spare + 0.01)
            .slice(0, 2)
            .map(x => ({ link: x.link, text: `${x.label} (${num(x.rate)}${l.unit}) ↗` })),
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
      {{ advice.intro }} If a milestone is not unlocked in your save yet, plan with the earlier
      mark.
    </p>
    <div class="logi">
      <div v-for="r in advice.rows" :key="r.name" class="logi-row">
        <ItemIcon :name="r.name" />
        <div>
          <b>{{ r.name }}</b>
          <p>
            <b>{{ r.rate }}</b> → <b>{{ r.lanes }}</b
            >{{ r.split }}.
          </p>
          <p v-if="r.feed?.text">{{ r.feed.text }}</p>
          <p v-else-if="r.feed">
            One full {{ r.feed.lane }} feeds <b>{{ r.feed.share }}</b> ({{ r.feed.each }} each) —
            plan manifold rows of {{ r.feed.fed }}.
          </p>
          <p v-if="r.spare">
            The last {{ r.spare.word }} has <b>{{ r.spare.amount }} spare</b> —
            <template v-if="r.spare.merge.length"
              >enough to also carry
              <template v-for="(x, n) in r.spare.merge" :key="n"
                >{{ n ? ' or ' : ''
                }}<button class="btn quiet" v-bind="factoryLink(x.link)">
                  {{ x.text }}
                </button></template
              >
              from the same bus</template
            ><template v-else>keep it as expansion headroom on this manifold</template>.
          </p>
          <p v-if="r.local">
            <button class="btn quiet" v-bind="factoryLink({ factory: r.local.id })">
              Local: ≈ {{ r.local.count }} × {{ r.local.machine }} at this site ↗
            </button>
          </p>
        </div>
      </div>
    </div>
  </template>
</template>
