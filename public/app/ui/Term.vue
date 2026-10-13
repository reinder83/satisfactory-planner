<!--
  A game term with its glossary definition (#1076, preferences/glossary.ts): the word as written,
  drawn as a button with a dotted underline, and its definition with "Where to get it" in a
  tooltip. It opens on hover, on keyboard focus and on a tap or click (which keeps it open until
  the next tap, a tap elsewhere or Escape); Escape closes it without moving focus. The tooltip is
  in the page only while open, so the text around it reads, searches and copies as it always did.
  The tooltip is moved left or right to stay inside the window, so a phone never scrolls sideways.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { glossary } from '../../preferences.ts';

const props = defineProps<{ term: string; text?: string }>();
const entry = computed(() => glossary[props.term]);
const tipId = 'term-' + useId();

const root = ref<HTMLElement | null>(null);
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

function pointerEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') hovered.value = true;
}
function pointerLeave(event: PointerEvent) {
  if (event.pointerType === 'mouse') hovered.value = false;
}
function focus() {
  if (!pressing) focused.value = true;
}
function blur(event: FocusEvent) {
  if (root.value?.contains(event.relatedTarget as Node | null)) return;
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
  pinned.value = hovered.value = focused.value = false;
}
// A tap or click anywhere else closes a pinned definition (a phone's tap does not always move
// focus, so blur alone would leave it open).
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node | null)) pinned.value = hovered.value = false;
}

// Keep the open tooltip inside the window: shift it by what sticks out on either side.
watch(open, async value => {
  if (value) document.addEventListener('pointerdown', outside, true);
  else document.removeEventListener('pointerdown', outside, true);
  if (!value) return;
  await nextTick();
  const box = tip.value;
  if (!box) return;
  box.style.left = '';
  const rect = box.getBoundingClientRect(),
    width = document.documentElement.clientWidth || window.innerWidth,
    margin = 8;
  const shift =
    rect.right > width - margin
      ? width - margin - rect.right
      : rect.left < margin
        ? margin - rect.left
        : 0;
  if (shift) box.style.left = `${Math.round(shift)}px`;
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true));
</script>

<template>
  <span
    v-if="entry"
    ref="root"
    class="term"
    @pointerenter="pointerEnter"
    @pointerleave="pointerLeave"
    ><button
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
    ><span v-if="open" :id="tipId" ref="tip" role="tooltip" class="term-tip" data-term-tip
      ><b>{{ entry.label }}.</b> {{ entry.definition }}
      <span class="term-where"><b>Where to get it:</b> {{ entry.where }}</span></span
    ></span
  ><template v-else>{{ text }}</template>
</template>
