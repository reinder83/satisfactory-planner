<!--
  One guided question's options as picture cards: radios named "guided:<id>", read back by
  readGuidedForm (wizard/guided.ts). The picked card follows the settings, so a change made in
  All settings shows here. The artwork is either up to four bundled item icons or an inline SVG
  glyph (GUIDED_GLYPHS), never a new asset; the glyphs are fixed markup, not user text.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { GUIDED_GLYPHS, guidedAnswer } from '../../wizard/guided.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import type { GuidedQuestion } from '../../../types/index.ts';

const props = defineProps<{ question: GuidedQuestion }>();

const picked = computed(() => legacy(() => guidedAnswer(props.question)));
const glyph = (name?: string) => GUIDED_GLYPHS[name || ''] || GUIDED_GLYPHS.balanced;
</script>

<template>
  <div class="guided-grid">
    <label
      v-for="o in question.options"
      :key="o.value"
      :class="['guided-card', o.value === picked ? 'is-picked' : '']"
    >
      <input
        type="radio"
        :name="'guided:' + question.id"
        :value="o.value"
        :aria-label="o.label + '. ' + o.detail"
        :checked="o.value === picked"
      />
      <span v-if="o.items" class="guided-art items" aria-hidden="true"
        ><ItemIcon v-for="n in o.items.slice(0, 4)" :key="n" :name="n"
      /></span>
      <span v-else class="guided-art" aria-hidden="true"
        ><svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="glyph(o.glyph)"
        ></svg
      ></span>
      <strong>{{ o.label }}</strong>
      <p>{{ o.detail }}</p>
      <span v-if="o.handoff" class="badge">Opens All settings</span>
    </label>
  </div>
</template>
