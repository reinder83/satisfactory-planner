<!--
  A game term with its glossary definition (#1076, preferences/glossary.ts): the word as written,
  drawn as a button with a dotted underline, and its definition with "Where to get it" in a
  tooltip. It opens on hover, on keyboard focus and on a tap or click (which keeps it open until
  the next tap, a tap elsewhere or Escape); Escape closes it without moving focus. The tooltip is
  in the page only while open, so the text around it reads, searches and copies as it always did.
  It is drawn at the end of <body> (a Teleport), fixed under the word, so a box that scrolls or
  clips, such as a step table's (ui/plan/StepTable.vue), never cuts it off; it follows the word
  when the page or a box scrolls, goes above it when there is no room below, and moves left or
  right to stay inside the window, so a phone never scrolls sideways. The mouse may move from the
  word onto the tooltip without closing it.
-->
<script setup lang="ts">
import { computed, useId } from 'vue';
import { glossary } from '../../preferences.ts';
import { useTipPopup } from './tip-popup.ts';

const props = defineProps<{ term: string; text?: string }>();
const entry = computed(() => glossary[props.term]);
const tipId = 'term-' + useId();
// The popup behaviour is shared with the "?" help button (ui/tip-popup.ts, ui/HelpPopover.vue).
const popup = useTipPopup();
const { open, press, pointerEnter, pointerLeave, focus, blur, click, close } = popup;
</script>

<template>
  <span
    v-if="entry"
    :ref="popup.root"
    class="term"
    @pointerenter="pointerEnter"
    @pointerleave="pointerLeave"
    ><button
      :ref="popup.button"
      type="button"
      class="term-word"
      :data-term="term"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-describedby="open ? tipId : undefined"
      @pointerdown="press"
      @focus="focus"
      @blur="blur"
      @click="click"
      @keydown.esc="close"
    >
      {{ text ?? entry.label }}</button
    ><Teleport to="body"
      ><span
        v-if="open"
        :id="tipId"
        :ref="popup.tip"
        role="tooltip"
        class="term-tip"
        data-term-tip
        @pointerenter="pointerEnter"
        @pointerleave="pointerLeave"
        ><b>{{ entry.label }}.</b> {{ entry.definition }}
        <span class="term-where"><b>Where to get it:</b> {{ entry.where }}</span></span
      ></Teleport
    ></span
  ><template v-else>{{ text }}</template>
</template>
