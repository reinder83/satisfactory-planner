<!--
  The dialog for one storage container (address `id`): where it sits, its four saved checks
  `slot-<id>-<step>` (toggleCheck in ui/actions.ts), the factory that makes the item (a
  factoryLink() to the calculated row, which opens that factory's dialog in its place) and the
  note saved under `slot-<id>`.
  Opened by openSlot in views/storage.ts.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage, checked } from '../../session.ts';
import { SLOT_STEPS, storageBays, storageFloors } from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import DetailNote from './DetailNote.vue';
import DialogFrame from './DialogFrame.vue';
import { factoryLink, toggleCheck } from '../actions.ts';

const props = defineProps<{ id: string }>();

const view = computed(() =>
  legacy(() => {
    const id = props.id,
      bay = storageBays().find(b => b.items.some(item => item.id === id));
    const slot = bay?.items.find(item => item.id === id);
    if (!bay || !slot?.name) return null;
    const name = slot.name;
    const factory = calcStage()?.rows?.find(r => r.outputs[name]);
    const index = Number(id.slice(bay.id.length));
    return {
      name,
      subtitle: `${id} · ${storageFloors().find(f => f.id === bay.floor)?.label || bay.floor} · Bay ${bay.id}`,
      bay: bay.name,
      where: `${index <= 4 ? 'Rear' : 'Front'} bank, position ${((index - 1) % 4) + 1} from the left on the floor plan.`,
      steps: SLOT_STEPS.map(([step, label]) => {
        const key = 'slot-' + id + '-' + step;
        return { key, label, done: checked(key) };
      }),
      link: factory ? { calcFactory: factory.id } : null,
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
      <label v-for="step in view.steps" :key="step.key" class="check-row"
        ><input
          type="checkbox"
          :data-check="step.key"
          @change="toggleCheck"
          :checked="step.done"
        />{{ step.label }}</label
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
