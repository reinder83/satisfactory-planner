<!--
  The banner under a factory's heading when some of its lines are ticked Running but held back
  by a missing input (FAC-2, #1342): "10 lines waiting on inputs · Fix first: Plastic → Oil
  campus [Show]". The cards still say "Running at 0%: short of Plastic" one by one; this is the
  one next action. The rule for "Fix first" is in app/factory-waiting.ts: the input that holds
  back the most of the factory's lines. [Show] focuses the line that makes it when it is in this
  factory, else the factory or shared site that does (ui/factories/reveal.ts), unfolding it. An
  input no line makes shows no button. Only outside edit mode.
-->
<script setup lang="ts">
import { waitingText, type Waiting } from '../../factory-waiting.ts';
import { showLine, showSection } from './reveal.ts';

const props = defineProps<{ waiting: Waiting; groupId: string }>();

function show() {
  const target = props.waiting.target;
  if (!target) return;
  // Another factory or shared site: its heading; the same factory, or a lone line: the line.
  if (target.section && target.section !== props.groupId) void showSection(target.section);
  else void showLine(target.line, target.section);
}
</script>

<template>
  <p class="small notice warn factory-waiting" data-waiting>
    <span data-waiting-count>{{ waitingText(waiting.count) }}</span
    ><span aria-hidden="true">·</span>
    <span class="factory-waiting-fix" data-waiting-fix
      >Fix first: {{ waiting.item
      }}<template v-if="waiting.target"> → {{ waiting.target.label }}</template></span
    ><button v-if="waiting.target" type="button" class="btn" data-waiting-show @click="show">
      Show<span class="visually-hidden"> {{ waiting.item }} in {{ waiting.target.label }}</span>
    </button>
  </p>
</template>
