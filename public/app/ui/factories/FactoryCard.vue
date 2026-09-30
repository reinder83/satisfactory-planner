<!--
  A handbook factory's card at the current stage. Its Running box writes the saved check key
  `factory-<stage>-<id>` (toggleCheck in ui/actions.ts); its name opens the factory dialog
  (factoryLink()), and so does a click anywhere else on the card (SP-19). Inside a group it
  shows that group's share of the output; while editing groups, its group editor.
  The same structure as CalcFactoryCard.vue (SP-14): the output with its unit as the headline,
  machines and the last one's clock on the line below it, then the recipe. The chip at the top
  says whether it runs (RunningChip.vue, SP-15) and follows the Running box.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { itemRate, rateUnit } from '../../flow.ts';
import { num } from '../../format.ts';
import { checked, factoryEditing, stage } from '../../session.ts';
import { allocationText, machineLine } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import AssignEditor from './AssignEditor.vue';
import RunningChip from './RunningChip.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import type { HandbookFactory } from '../../../types/index.ts';

// group is the factory group this card sits in, or null outside the groups.
const props = withDefaults(defineProps<{ factory: HandbookFactory; group?: string | null }>(), {
  group: null,
});

const card = computed(() =>
  legacy(() => {
    const factory = props.factory,
      // The pages draw only factories with this stage.
      stageRow = factory.stages[stage()]!,
      check = 'factory-' + stage() + '-' + factory.id;
    return {
      check,
      done: checked(check),
      output: num(stageRow.output),
      // m³/min for a fluid, as the dialog's summary line says it (#351).
      unit: rateUnit(factory.name),
      recipe: stageRow.recipe.replace('Alternate: ', ''),
      machines: stageRow.machines
        ? machineLine(stageRow.machines, stageRow.machine, stageRow.lastClock)
        : 'See shared oil campus',
      storage: `· storage ${itemRate(factory.name, stageRow.storage)}`,
      allocation: props.group
        ? allocationText(factory.id, props.group, stageRow.output, stageRow.machines, rate =>
            itemRate(factory.name, rate),
          )
        : '',
      editing: factoryEditing,
    };
  }),
);
</script>

<template>
  <article :class="['factory-card', card.done ? 'done' : '']">
    <RunningChip :status="card.done ? 'running' : 'idle'" />
    <div class="card-top">
      <span class="card-icon"><ItemIcon :name="factory.name" /></span>
      <div class="card-main">
        <button class="name" v-bind="factoryLink({ factory: factory.id })">
          {{ factory.name }}
        </button>
        <div class="output">
          {{ card.output }} <span>{{ card.unit }}</span>
        </div>
        <div class="small machines">{{ card.machines }}</div>
      </div>
      <span v-if="factory.local" class="badge">Local</span>
      <span v-else-if="factory.conversion" class="badge orange">Convert</span>
    </div>
    <div class="recipe">
      {{ card.recipe }}
      <span class="muted">{{ card.storage }}</span>
    </div>
    <div v-if="card.allocation" class="small allocation">{{ card.allocation }}</div>
    <footer>
      <label class="check-row"
        ><input
          type="checkbox"
          :data-check="card.check"
          @change="toggleCheck"
          :checked="card.done"
        />Running</label
      >
    </footer>
    <AssignEditor v-if="card.editing" :factory-key="factory.id" />
  </article>
</template>
