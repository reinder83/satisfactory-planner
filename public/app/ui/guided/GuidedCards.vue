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
      v-for="option in question.options"
      :key="option.value"
      :class="['guided-card', option.value === picked ? 'is-picked' : '']"
    >
      <input
        type="radio"
        :name="'guided:' + question.id"
        :value="option.value"
        :aria-label="option.label + '. ' + option.detail"
        :checked="option.value === picked"
      />
      <span v-if="option.items" class="guided-art items" aria-hidden="true"
        ><ItemIcon v-for="item in option.items.slice(0, 4)" :key="item" :name="item"
      /></span>
      <span v-else class="guided-art" aria-hidden="true"
        ><svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="glyph(option.glyph)"
        ></svg
      ></span>
      <strong>{{ option.label }}</strong>
      <p>{{ option.detail }}</p>
    </label>
  </div>
</template>
