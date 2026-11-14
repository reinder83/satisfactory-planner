<!--
  The selection panel under a factory's flow graph (FG-5, #1344): what the production line the
  user selected in FlowGraphDialog.vue takes in and gives out. In: every arrow into its box, with
  its rate, the belts or pipes that carry it and where it comes from; out: every arrow out of it,
  with its rate and the line, factory or place that takes it, a line's own output going back into
  itself included. "Mark running" is the factories card's Running box (CalcFactoryCard.vue: the
  same `calc-<phase>-<row id>` check, saved by toggleCheck), "Open line" the production line's
  dialog in the graph's place and "Open in build order" the factory's build order page with the
  line focused (the dialog does both). On another phase's tab (`readonly`) the facts stay and the
  three actions go: the line there is not the phase on screen's to tick, open or find.
  "Move to step …" (FG-8, #1345), the ⋯ menu after them, is the keyboard's way to push the line
  to another step, as dropping its box in the "New step" column is the pointer's: every other step
  and a new one after the last, and "Back to its own step" while the line was pushed. A step the
  line cannot reach, because a line feeding it sits in or after it, stays in the list marked
  "needs 03 first" and says so when chosen instead of moving. What a move said ("Needs 03 first: …",
  or "Moved 02 … to Step 4." with an Undo button) is repeated after the menu, since the toolbar's
  status it also goes to (and a screen reader reads) is off screen from here.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { checked, stage } from '../../session.ts';
import type { GraphEdge, GraphNode } from '../../flow-graph.ts';
import { legacy } from '../bridge.ts';
import { toggleCheck } from '../actions.ts';
import ActionMenu from '../ActionMenu.vue';

const props = defineProps<{
  node: GraphNode;
  // The arrows into the box and out of it.
  ins: GraphEdge[];
  outs: GraphEdge[];
  // The plan row of the line.
  row: string;
  readonly: boolean;
  // The steps the line can be moved to (FG-8): the step number, how it is worded ("Step 3 ·
  // Steel"), and `needs` the line to wait for ("03") when it is out of reach. `own` offers the
  // line back its own step.
  moves: { step: number; label: string; needs: string | null }[];
  own: boolean;
  // What the last move said, and what it can be undone as (empty for neither).
  note: string;
  undoText: string;
}>();
defineEmits<{
  clear: [];
  line: [];
  order: [];
  move: [step: number];
  own: [];
  undo: [];
}>();

const check = computed(() => 'calc-' + stage() + '-' + props.row);
const running = computed(() => legacy(() => checked(check.value)));
const belts = (edge: GraphEdge) => (edge.belts ? ` · ${edge.belts}` : '');
const NOTES: Record<GraphEdge['note'], string> = {
  '': '',
  loop: ' (loop: seed a starter batch)',
  self: '',
};
</script>

<template>
  <section
    class="fgraph-panel"
    role="region"
    :aria-label="`Selected production line: ${node.label}`"
    data-flow-graph-selection
  >
    <header class="fgraph-panel-head">
      <div>
        <h3 data-selection-name>{{ node.label }}</h3>
        <p class="small muted">{{ node.caption }}</p>
      </div>
      <button class="btn" type="button" data-selection-clear @click="$emit('clear')">
        Clear selection
      </button>
    </header>
    <div class="fgraph-panel-cols">
      <div>
        <h4>Comes in</h4>
        <ul v-if="ins.length" data-selection-in>
          <li v-for="edge in ins" :key="edge.id" :data-selection-edge="edge.id">
            <strong>{{ edge.item }}</strong> <span class="number">{{ edge.rateText }}</span
            ><span class="muted">{{ belts(edge) }} · from {{ edge.fromText }}</span
            ><span class="muted">{{ NOTES[edge.note] }}</span>
          </li>
        </ul>
        <p v-else class="small muted" data-selection-in>Nothing comes in.</p>
      </div>
      <div>
        <h4>Leaves</h4>
        <ul v-if="outs.length" data-selection-out>
          <li v-for="edge in outs" :key="edge.id" :data-selection-edge="edge.id">
            <strong>{{ edge.item }}</strong> <span class="number">{{ edge.rateText }}</span
            ><span class="muted">{{ belts(edge) }} · to {{ edge.toText }}</span
            ><span class="muted">{{ NOTES[edge.note] }}</span>
          </li>
        </ul>
        <p v-else class="small muted" data-selection-out>Nothing leaves it.</p>
      </div>
    </div>
    <footer v-if="!readonly" class="fgraph-panel-actions">
      <label class="check-row"
        ><input
          type="checkbox"
          :data-check="check"
          :aria-label="'Mark running: ' + node.label"
          data-selection-running
          :checked="running"
          @change="toggleCheck"
        />Mark running</label
      >
      <button class="btn" type="button" data-selection-line @click="$emit('line')">
        Open line
      </button>
      <button class="btn" type="button" data-selection-order @click="$emit('order')">
        Open in build order
      </button>
      <ActionMenu
        v-if="moves.length || own"
        id="fgraph-move-menu"
        :label="'Move ' + node.label + ' to another step'"
        data-selection-move
        ><button
          v-for="move in moves"
          :key="move.step"
          type="button"
          role="menuitem"
          tabindex="-1"
          class="btn"
          :aria-disabled="move.needs ? 'true' : undefined"
          :data-move-step="move.step"
          @click="$emit('move', move.step)"
        >
          Move to {{ move.label
          }}<template v-if="move.needs"> (needs {{ move.needs }} first)</template>
        </button>
        <button
          v-if="own"
          type="button"
          role="menuitem"
          tabindex="-1"
          class="btn"
          data-move-own
          @click="$emit('own')"
        >
          Back to its own step
        </button></ActionMenu
      >
      <span v-if="note || undoText" class="fgraph-panel-note small muted" data-selection-note>
        <span aria-hidden="true">{{ note || undoText }}</span>
        <button
          v-if="undoText && !note"
          class="btn"
          type="button"
          data-selection-undo
          @click="$emit('undo')"
        >
          Undo
        </button>
      </span>
    </footer>
  </section>
</template>
