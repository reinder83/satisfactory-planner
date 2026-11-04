<!--
  "From the factory links" on the Logistics page's Trains tab (#1301), over the stations: how many
  links of the phase shown go by train and how many have no train line yet (proposeTrains in
  app/train-proposal.ts, the same answers as the preview), and "Create stations from train links",
  which opens the preview (ui/detail/TrainProposalDialog.vue). With no link on a train the button
  has nothing to do and is disabled, and the text says where to pick Train.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { phase, phaseLabel } from '../../session.ts';
import { proposeTrains } from '../../train-proposal.ts';
import { phaseTrainLinks, proposalWorld } from '../../views/trains.ts';
import { legacy } from '../bridge.ts';
import { showDetail } from '../detail.ts';

const view = computed(() =>
  legacy(() => {
    const links = phaseTrainLinks();
    const proposals = proposeTrains(links, proposalWorld(), { ids: () => 'ts-preview' });
    return {
      links: links.length,
      open: proposals.filter(proposal => proposal.status === 'propose').length,
      phase: phaseLabel(phase()),
    };
  }),
);
const count = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const text = computed(() => {
  const { links, open, phase: name } = view.value;
  if (!links)
    return `No link goes by train in ${name}. Pick Train under By on a link of the Between factories tab, and this proposes its stations and line.`;
  const going = `${count(links, 'link goes', 'links go')} by train in ${name}`;
  if (!open) return `${going}, and each already has a train line.`;
  const missing =
    open < links
      ? `${open} of them ${open === 1 ? 'has' : 'have'} no train line yet`
      : links === 1
        ? 'it has no train line yet'
        : 'none has a train line yet';
  return `${going}; ${missing}. Create proposes a pick-up station, a drop-off station and a line for each, to check before anything is saved.`;
});
const open = () => showDetail({ kind: 'trains', id: 'links' });
</script>

<template>
  <section
    class="panel trains-from-links"
    data-trains-from-links
    aria-labelledby="trains-from-links-title"
  >
    <h2 id="trains-from-links-title">From the factory links</h2>
    <p class="small muted" data-trains-from-links-text>{{ text }}</p>
    <p class="station-add">
      <button
        type="button"
        class="btn primary"
        data-trains-from-links-open
        :disabled="!view.links"
        @click="open"
      >
        Create stations from train links
      </button>
    </p>
  </section>
</template>
