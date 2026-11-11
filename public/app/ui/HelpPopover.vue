<!--
  A "?" help button (X-3, #1333): the long explanation that used to sit in a paragraph under a
  heading, behind a button next to it. It opens the glossary's popup (ui/tip-popup.ts, the same one
  ui/Term.vue uses): hover, keyboard focus, a tap or click, Escape to close without moving focus,
  a tap elsewhere to close, drawn at the end of <body> so no box clips it. The text is the whole
  explanation, from `helpText` in preferences/help.ts (the one map of help texts, keyed by `name`);
  it is in the page only while open, so the page itself stays short. The button is a real button
  named "Help: <topic>" with aria-expanded, and the open text describes it (aria-describedby), so a
  screen reader reaches the text by activating the button. At least 24 px square, 44 px on a touch
  screen (style.css, .help-btn).
-->
<script setup lang="ts">
import { computed, useId } from 'vue';
import { helpText } from '../../preferences.ts';
import { useTipPopup } from './tip-popup.ts';

const props = withDefaults(
  defineProps<{
    // The key of the text in `helpText`.
    name: string;
    // What the help is about, for the button's name: "Help: <topic>".
    topic: string;
    // The mark on the button: "?" for a heading, "ⓘ" for a setting's field (form/HelpTip.vue).
    glyph?: string;
  }>(),
  { glyph: '?' },
);
const text = computed(() => helpText[props.name] || '');
const tipId = 'help-' + useId();
const popup = useTipPopup();
const { open, press, pointerEnter, pointerLeave, focus, blur, click, close } = popup;
</script>

<template>
  <span
    v-if="text"
    :ref="popup.root"
    class="help-pop"
    @pointerenter="pointerEnter"
    @pointerleave="pointerLeave"
    ><button
      :ref="popup.button"
      type="button"
      class="help-btn"
      :class="{ 'help-btn-info': glyph !== '?' }"
      :data-help="name"
      :aria-label="`Help: ${topic}`"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-describedby="open ? tipId : undefined"
      @pointerdown="press"
      @focus="focus"
      @blur="blur"
      @click="click"
      @keydown.esc="close"
    >
      <span aria-hidden="true">{{ glyph }}</span></button
    ><Teleport to="body"
      ><span
        v-if="open"
        :id="tipId"
        :ref="popup.tip"
        role="tooltip"
        class="term-tip help-tip"
        data-help-tip
        @pointerenter="pointerEnter"
        @pointerleave="pointerLeave"
        >{{ text }}</span
      ></Teleport
    ></span
  >
</template>
