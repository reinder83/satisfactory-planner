<!--
  A production line's build-plan step text as the production-line dialog's structure (BP-5,
  StepFacts in step-table.ts): the sentences that open it (what already runs, a line made on
  site), the machine count and what each machine makes, the inputs and outputs with their rates,
  and the sentences that close it (somersloops, Power Shards, spare coke). The words are the
  step's `body`, which stays for search and copying. PlanStep.vue draws it in place of the text;
  the byproduct advice, the built-machines counter, the later phases and the build materials
  follow it as they did. The sentences above and below mark the glossary terms in `terms`
  (#1076, ui/TermText.vue), each once.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { termParts } from '../../../preferences.ts';
import type { StepFacts } from '../../../step-table.ts';
import TermText from '../TermText.vue';

const props = withDefaults(defineProps<{ facts: StepFacts; terms?: readonly string[] }>(), {
  terms: () => [],
});
// The terms the closing sentences mark: those the opening ones have not.
const closingTerms = computed(() => {
  const marked = props.facts.notes.flatMap(note =>
    termParts(note, props.terms).map(part => part.term),
  );
  return props.terms.filter(term => !marked.includes(term));
});
</script>

<template>
  <div class="step-facts" data-step-facts>
    <p v-for="(note, index) in facts.notes" :key="'n' + index" data-step-facts-note>
      <TermText :text="note" :terms="terms" />
    </p>
    <dl class="step-facts-grid">
      <dt>Machines</dt>
      <dd data-step-machines>{{ facts.machines }}</dd>
      <dt>{{ facts.perMachine.label }}</dt>
      <dd data-step-per-machine>
        {{ facts.perMachine.text
        }}<template v-if="facts.perMachine.hint"
          >{{ ' ' }}<span class="muted">{{ facts.perMachine.hint }}</span></template
        >
      </dd>
      <dt>Inputs</dt>
      <dd data-step-inputs>
        <ul v-if="facts.inputs.length" class="step-rates">
          <li v-for="input in facts.inputs" :key="input.name">
            <span>{{ input.name }}</span
            >{{ ' ' }}<b>{{ input.rate }}</b>
          </li>
        </ul>
        <template v-else>None</template>
      </dd>
      <dt>Outputs</dt>
      <dd data-step-outputs>
        <ul class="step-rates">
          <li v-for="output in facts.outputs" :key="output.name">
            <span>{{ output.name }}</span
            >{{ ' ' }}<b>{{ output.rate }}</b>
          </li>
        </ul>
      </dd>
    </dl>
    <p v-for="(extra, index) in facts.extras" :key="'e' + index" data-step-facts-extra>
      <TermText :text="extra" :terms="closingTerms" />
    </p>
  </div>
</template>
