<!--
  A handbook factory's card at the current stage. Its Running box writes the saved check key
  `factory-<stage>-<id>` (toggleCheck in ui/actions.ts); its name and "Details ↗" open the
  factory dialog (factoryLink()). Inside a group it
  shows that group's share of the output; while editing groups, its group editor.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { checked, factoryEditing, stage } from '../../session.ts';
import { allocationText } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import AssignEditor from './AssignEditor.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import type { HandbookFactory } from '../../../types/index.ts';

// group is the factory group this card sits in, or null outside the groups.
const props = withDefaults(defineProps<{ factory: HandbookFactory; group?: string | null }>(), {
  group: null,
});

const card = computed(() =>
  legacy(() => {
    const f = props.factory,
      // The pages draw only factories with this stage.
      r = f.stages[stage()]!,
      check = 'factory-' + stage() + '-' + f.id;
    return {
      check,
      done: checked(check),
      output: num(r.output),
      recipe: r.recipe.replace('Alternate: ', ''),
      machines: r.machines ? `${num(r.machines)} × ${r.machine}` : 'See shared oil campus',
      storage: `· storage ${num(r.storage)}/min`,
      allocation: props.group ? allocationText(f.id, props.group, r.output, r.machines) : '',
      editing: factoryEditing,
    };
  }),
);
</script>

<template>
  <article :class="['factory-card', card.done ? 'done' : '']">
    <div class="card-top">
      <span class="card-icon"><ItemIcon :name="factory.name" /></span>
      <div class="card-main">
        <button class="name" v-bind="factoryLink({ factory: factory.id })">
          {{ factory.name }}
        </button>
        <div class="output">{{ card.output }} <span>/min</span></div>
      </div>
      <span v-if="factory.local" class="badge">Local</span>
      <span v-else-if="factory.conversion" class="badge orange">Convert</span>
    </div>
    <div class="recipe">{{ card.recipe }}</div>
    <div class="small">
      {{ card.machines }}
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
      ><button class="btn quiet" v-bind="factoryLink({ factory: factory.id })">Details ↗</button>
    </footer>
    <AssignEditor v-if="card.editing" :factory-key="factory.id" />
  </article>
</template>
