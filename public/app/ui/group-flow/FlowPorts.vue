<!--
  What comes into a factory group, or leaves it, on its flow page (#894): one box per place (raw
  resources, existing supply, another group, rows in no group, a destination), each item with
  its rate and the belts or pipes it takes. Leaving, the AWESOME Sink and protected storage fold
  into one "Sink & storage" summary (`fold`), closed until it is opened.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { FLUIDS, itemRate } from '../../flow.ts';
import type { FlowFold, FlowPort } from '../../group-flow.ts';
import { num } from '../../format.ts';
import ItemIcon from '../ItemIcon.vue';

const props = defineProps<{ title: string; id: string; ports: FlowPort[]; fold?: FlowFold }>();

interface Place {
  key: string;
  label: string;
  ports: FlowPort[];
}
// Raw resources and existing supply each come from one place per item, so they are listed
// under one heading each; any other place has its own box.
const KIND_LABELS: Partial<Record<FlowPort['kind'], string>> = {
  raw: 'Raw resources',
  supply: 'Existing supply',
};
function byPlace(ports: readonly FlowPort[]): Place[] {
  const places = new Map<string, Place>();
  for (const port of ports) {
    const label = KIND_LABELS[port.kind];
    const key = label ? port.kind : port.place;
    const place = places.get(key) ?? { key, label: label ?? port.label, ports: [] };
    place.ports.push(port);
    places.set(key, place);
  }
  return [...places.values()];
}
const places = computed(() => byPlace(props.ports));
const foldPlaces = computed(() => byPlace(props.fold?.ports ?? []));
const unit = computed(() =>
  props.fold?.ports.some(port => FLUIDS.has(port.item)) ? ' (fluids in m³)' : '',
);
</script>

<template>
  <section v-if="places.length || fold?.ports.length" class="gf-band" :aria-labelledby="id">
    <h2 :id="id" class="gf-colcap">{{ title }}</h2>
    <div class="gf-ports">
      <section v-for="place in places" :key="place.key" class="gf-port">
        <h3>{{ place.label }}</h3>
        <div v-for="port in place.ports" :key="port.place + port.item" class="gf-row">
          <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
          ><span class="gf-num"
            ><b>{{ itemRate(port.item, port.rate) }}</b
            ><small>{{ port.belts }}</small></span
          >
        </div>
      </section>
      <details v-if="fold?.ports.length" class="gf-port gf-fold" data-gf-fold>
        <summary>
          <h3>Sink &amp; storage</h3>
          <span class="small muted"
            >{{ fold.items }} {{ fold.items === 1 ? 'item' : 'items' }} · {{ num(fold.rate) }}/min
            in all{{ unit }}</span
          >
        </summary>
        <template v-for="place in foldPlaces" :key="place.key">
          <h4>{{ place.label }}</h4>
          <div v-for="port in place.ports" :key="port.place + port.item" class="gf-row">
            <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
            ><span class="gf-num"
              ><b>{{ itemRate(port.item, port.rate) }}</b
              ><small>{{ port.belts }}</small></span
            >
          </div>
        </template>
      </details>
    </div>
  </section>
</template>
