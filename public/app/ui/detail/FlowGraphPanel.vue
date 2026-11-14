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
-->
<script setup lang="ts">
import { computed } from 'vue';
import { checked, stage } from '../../session.ts';
import type { GraphEdge, GraphNode } from '../../flow-graph.ts';
import { legacy } from '../bridge.ts';
import { toggleCheck } from '../actions.ts';

const props = defineProps<{
  node: GraphNode;
  // The arrows into the box and out of it.
  ins: GraphEdge[];
  outs: GraphEdge[];
  // The plan row of the line.
  row: string;
  readonly: boolean;
}>();
defineEmits<{ clear: []; line: []; order: [] }>();

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
    </footer>
  </section>
</template>
