<!--
  The dialog for one storage container (address `id`): where it sits, its four saved checks
  `slot-<id>-<step>` (toggleCheck in ui/actions.js), the factory that makes the item (a
  factoryLink() to the calculated row or the handbook factory, which opens that factory's
  dialog in its place) and the note saved under `slot-<id>`.
  Opened by openSlot in views/storage.js.
-->
<script setup>
import { computed } from 'vue';
import { calcStage, calculated, checked, plan } from '../../session.js';
import { SLOT_STEPS, storageBays, storageFloors } from '../../views/storage.js';
import { legacy } from '../bridge.js';
import DetailNote from './DetailNote.vue';
import DialogFrame from './DialogFrame.vue';
import { factoryLink, toggleCheck } from '../actions.js';

const props = defineProps({ id: { type: String, required: true } });

const view = computed(() =>
  legacy(() => {
    const id = props.id,
      b = storageBays().find(b => b.items.some(x => x.id === id));
    const x = b?.items.find(x => x.id === id);
    if (!x?.name) return null;
    const factory = calculated
      ? calcStage().rows?.find(r => r.outputs[x.name])
      : plan.factories.find(f => f.name === x.name);
    const index = Number(id.slice(b.id.length));
    return {
      name: x.name,
      subtitle: `${id} · ${storageFloors().find(f => f.id === b.floor)?.label || b.floor} · Bay ${b.id}`,
      bay: b.name,
      where: `${index <= 4 ? 'Rear' : 'Front'} bank, position ${((index - 1) % 4) + 1} from the left on the floor plan.`,
      steps: SLOT_STEPS.map(([k, label]) => {
        const key = 'slot-' + id + '-' + k;
        return { key, label, done: checked(key) };
      }),
      link: factory ? (calculated ? { calcFactory: factory.id } : { factory: factory.id }) : null,
    };
  }),
);
</script>

<template>
  <DialogFrame v-if="view" :title="view.name" :subtitle="view.subtitle" :icon="view.name">
    <p>
      <b>{{ view.bay }}</b
      ><br />{{ view.where }}
    </p>
    <div class="check-columns">
      <label v-for="s in view.steps" :key="s.key" class="check-row"
        ><input type="checkbox" :data-check="s.key" @change="toggleCheck" :checked="s.done" />{{
          s.label
        }}</label
      >
    </div>
    <div v-if="view.link" class="detail-actions">
      <button class="btn" v-bind="factoryLink(view.link)">Open production target →</button>
    </div>
    <p v-else class="small muted">
      Collected or completion item. Reserve its own supply; this storage position does not add
      production capacity.
    </p>
    <h3>Container notes</h3>
    <DetailNote
      :note-key="'slot-' + id"
      label="Belt source, splitter setting or remaining work."
      aria-label="Container notes"
    />
  </DialogFrame>
</template>
