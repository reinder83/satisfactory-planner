<!--
  All settings step 3's objective (#1180, settings.objective): what the plan keeps lowest while it
  meets the goal, as four cards like the goal's (radio "objective": the fewest buildings, the
  default, least power, least raw resources or a weighted mix), each with a line saying what it
  does. The weighted mix shows three whole weights from 0 to 10 ("objectiveWeight:buildings",
  "…:power", "…:raw"), which readObjective in wizard/wizard.ts reads; a mix of three zeros stops
  Continue with a message on the first box, as settings() would refuse it. Choosing a card shows or
  hides the weights at once; nothing is read until the step is left.
-->
<script setup lang="ts">
import { nextTick, ref } from 'vue';
import {
  OBJECTIVE_WEIGHT_MAX,
  OBJECTIVE_WEIGHTS,
  OBJECTIVES,
  objectiveKind,
} from '../../../preferences.ts';
import type { ObjectiveKind, PlanObjective } from '../../../types/index.ts';
import HelpTip from '../form/HelpTip.vue';
import { vValue } from '../form/value.ts';

const props = defineProps<{ objective: PlanObjective | undefined }>();

const kind = ref<ObjectiveKind>(objectiveKind(props.objective));
// A mix starts from the draft's own weights, else from one of each. The boxes keep what is typed
// (v-value), so a redraw never puts these back over it.
const initial =
  typeof props.objective === 'object' ? { ...props.objective } : { buildings: 1, power: 1, raw: 1 };
const LABELS = {
  buildings: 'Buildings weight',
  power: 'Power weight',
  raw: 'Raw resources weight',
};
const ZERO = 'Give at least one weight above 0.';

async function choose(e: Event) {
  const card = e.target as HTMLInputElement;
  kind.value = card.value as ObjectiveKind;
  if (kind.value !== 'weighted') return;
  // The weight boxes appear on the next render, after the live estimate read the step without
  // them (readObjective then keeps the draft's weights, else 1 each): an input from the first box
  // once it is there has the estimate read the weights it shows.
  await nextTick();
  card
    .closest('[data-objective]')
    ?.querySelector('[data-objective-weights] input')
    ?.dispatchEvent(new Event('input', { bubbles: true }));
}
// While every weight is 0 the first box carries the message, so Continue stops there.
function typed(e: Event) {
  const boxes = [
    ...((e.target as HTMLInputElement)
      .closest('[data-objective-weights]')
      ?.querySelectorAll('input') ?? []),
  ];
  const zero = boxes.every(box => !(Number(box.value) > 0));
  boxes[0]?.setCustomValidity(zero ? ZERO : '');
}
</script>

<template>
  <fieldset class="objective-choice" data-objective>
    <legend>What the plan keeps lowest <HelpTip name="objective" /></legend>
    <p class="small muted" data-explain>
      The goal sets how fast each phase delivers; this sets what the plan keeps lowest while it
      does.
    </p>
    <div class="goal-grid">
      <label v-for="[id, label, line] in OBJECTIVES" :key="id" class="goal-card"
        ><input
          type="radio"
          name="objective"
          :value="id"
          :checked="kind === id"
          @change="choose"
        /><strong>{{ label }}</strong>
        <p>{{ line }}</p></label
      >
    </div>
    <div v-if="kind === 'weighted'" class="form-grid objective-weights" data-objective-weights>
      <label v-for="name in OBJECTIVE_WEIGHTS" :key="name" class="field"
        >{{ LABELS[name]
        }}<input
          v-value="initial[name]"
          :name="'objectiveWeight:' + name"
          type="number"
          min="0"
          :max="OBJECTIVE_WEIGHT_MAX"
          step="1"
          required
          @input="typed"
      /></label>
    </div>
  </fieldset>
</template>
