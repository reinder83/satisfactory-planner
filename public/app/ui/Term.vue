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
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { glossary } from '../../preferences.ts';

const props = defineProps<{ term: string; text?: string }>();
const entry = computed(() => glossary[props.term]);
const tipId = 'term-' + useId();

const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const tip = ref<HTMLElement | null>(null);
const hovered = ref(false),
  focused = ref(false),
  pinned = ref(false);
const open = computed(() => pinned.value || hovered.value || focused.value);
// A press focuses the button before its click: that focus is the click's, not the keyboard's,
// so the click alone decides (a tap opens it, the next tap closes it).
let pressing = false;
function press() {
  pressing = true;
}

// Whether a node is the term or its tooltip, which is elsewhere in the page.
const ours = (node: EventTarget | null) =>
  !!node && (!!root.value?.contains(node as Node) || !!tip.value?.contains(node as Node));

// The mouse leaving the word closes the tooltip a moment later, so it can cross the gap onto
// the tooltip, which keeps it open.
const LEAVE_DELAY = 100;
let leaving: ReturnType<typeof setTimeout> | undefined;
function pointerEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  clearTimeout(leaving);
  hovered.value = true;
}
function pointerLeave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  clearTimeout(leaving);
  leaving = setTimeout(() => (hovered.value = false), LEAVE_DELAY);
}
function focus() {
  if (!pressing) focused.value = true;
}
function blur(event: FocusEvent) {
  if (ours(event.relatedTarget)) return;
  pressing = false;
  focused.value = false;
  pinned.value = false;
}
function click() {
  pressing = false;
  pinned.value = !pinned.value;
  if (!pinned.value) hovered.value = focused.value = false;
}
function close(event: KeyboardEvent) {
  if (!open.value) return;
  event.stopPropagation();
  clearTimeout(leaving);
  pinned.value = hovered.value = focused.value = false;
}
// A tap or click anywhere else closes a pinned definition (a phone's tap does not always move
// focus, so blur alone would leave it open).
function outside(event: PointerEvent) {
  if (!ours(event.target)) pinned.value = hovered.value = false;
}

// Place the open tooltip under the word (above it when it does not fit below but does above),
// shifted sideways by what would stick out of the window.
const MARGIN = 8,
  GAP = 4;
function place() {
  const box = tip.value,
    word = button.value;
  if (!box || !word) return;
  const anchor = word.getBoundingClientRect(),
    width = document.documentElement.clientWidth || window.innerWidth,
    height = document.documentElement.clientHeight || window.innerHeight,
    size = box.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(anchor.left, width - MARGIN - size.width));
  const below = anchor.bottom + GAP,
    above = anchor.top - GAP - size.height;
  const top = below + size.height > height - MARGIN && above >= MARGIN ? above : below;
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}

// While open: follow the word on any scroll (the page's or a box's, caught on the way down) and
// on a resize, and listen for a tap elsewhere.
function listen(on: boolean) {
  if (on) {
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  } else {
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  }
}
watch(open, async value => {
  listen(value);
  if (!value) return;
  await nextTick();
  place();
});
onBeforeUnmount(() => {
  clearTimeout(leaving);
  listen(false);
});
</script>

<template>
  <span
    v-if="entry"
    ref="root"
    class="term"
    @pointerenter="pointerEnter"
    @pointerleave="pointerLeave"
    ><button
      ref="button"
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
        ref="tip"
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
