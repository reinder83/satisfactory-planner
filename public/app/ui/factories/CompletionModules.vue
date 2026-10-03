<!-- Post Phase 5's additional completion modules on the factories page (a plan guide's, #468):
     one card per line with its check `completion-<id>`, its rate, machines and
     recipe, and its inputs and byproducts. completionView (views/factories.ts) prepares them. -->
<script setup lang="ts">
import { toggleCheck } from '../actions.ts';
import type { CompletionView } from '../../views/factories.ts';

defineProps<{ modules: CompletionView[] }>();
</script>

<template>
  <section style="margin-top: 32px">
    <h2>Additional completion modules</h2>
    <div class="notice info">
      These recipe inputs are additional to the main resource budget. Allocate their supply first.
      Gathered feedstock and byproducts still need handling.
    </div>
    <div class="completion-grid">
      <article v-for="module in modules" :key="module.id" class="completion-item">
        <label class="check-row"
          ><input
            type="checkbox"
            :data-check="module.check"
            @change="toggleCheck"
            :checked="module.done"
          /><strong>{{ module.name }}</strong></label
        >
        <p>{{ module.line }}<br />{{ module.recipe }}</p>
        <p>
          <b>Inputs:</b> {{ module.inputText
          }}<template v-if="module.byproductText"
            ><br /><b>Byproducts:</b> {{ module.byproductText }}</template
          >
        </p>
      </article>
    </div>
  </section>
</template>
