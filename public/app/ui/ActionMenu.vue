<!--
  A ⋯ button that opens a short menu of actions (#238): the actions a card does not need to show
  all the time. The items are the default slot: buttons with role="menuitem" and tabindex="-1"
  (the arrow keys move between them, so Tab leaves the menu instead), the destructive one last
  with .btn.danger. Attributes given to the component (data-* hooks) land on the ⋯ button.

  Keyboard, as a menu button: Enter, Space and ArrowDown open it on the first item, ArrowUp on
  the last; ArrowUp/ArrowDown (wrapping), Home and End move; Escape closes it and returns focus to
  ⋯; Tab closes it and moves on. A click outside closes it, and opening one menu closes any other.
  Choosing an item closes the menu and puts focus on ⋯ before the item's own handler runs, so a
  confirmation asked by that handler (ui/confirm.ts) hands focus back to ⋯, and an item's action
  that removes the card records ⋯ as its control for refocusAfterRemoval() (ui/refocus.ts).

  `busy` marks ⋯ busy while one of its actions runs (aria-disabled, app/busy.ts, #299: it keeps
  focus and a press does nothing), and `busyText` ("Copying…") replaces ⋯ meanwhile, since the
  item that would say so is out of sight. The ⋯ is drawn (an inline SVG), since neither
  typeface has the glyph.
-->
<script lang="ts">
// The menu open on the page, to close when another one opens.
let current: (() => void) | null = null;
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  // The menu element's id, unique on the page (the ⋯ button's aria-controls).
  id: string;
  // The ⋯ button's accessible name ("More actions for <profile>").
  label: string;
  busy?: boolean;
  busyText?: string;
}>();

const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const list = ref<HTMLElement>();

const items = () =>
  list.value ? [...list.value.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];

function outside(e: Event) {
  if (!(e.target instanceof Node) || !root.value?.contains(e.target)) hide(false);
}

async function show(at: 'first' | 'last') {
  if (props.busy) return;
  if (current && current !== close) current();
  current = close;
  open.value = true;
  document.addEventListener('pointerdown', outside, true);
  await nextTick();
  const all = items();
  (at === 'last' ? all[all.length - 1] : all[0])?.focus();
}

function hide(refocus: boolean) {
  if (!open.value) return;
  open.value = false;
  if (current === close) current = null;
  document.removeEventListener('pointerdown', outside, true);
  if (refocus) trigger.value?.focus();
}
const close = () => hide(false);

// A click on ⋯, which Enter and Space also give a button.
function toggle() {
  if (open.value) hide(true);
  else void show('first');
}

function triggerKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  void show(e.key === 'ArrowUp' ? 'last' : 'first');
}

function menuKey(e: KeyboardEvent) {
  const all = items();
  const at = all.indexOf(document.activeElement as HTMLElement);
  const to = (i: number) => {
    e.preventDefault();
    all[(i + all.length) % all.length]?.focus();
  };
  if (e.key === 'ArrowDown') to(at + 1);
  else if (e.key === 'ArrowUp') to(at < 0 ? -1 : at - 1);
  else if (e.key === 'Home') to(0);
  else if (e.key === 'End') to(-1);
  else if (e.key === 'Escape') {
    // Not the Escape of a dialog the menu may be in.
    e.preventDefault();
    e.stopPropagation();
    hide(true);
  } else if (e.key === 'Tab') hide(false);
}

// Capture: before the item's own handler, which then finds focus on ⋯.
function chosen(e: Event) {
  if (e.target instanceof Element && e.target.closest('[role="menuitem"]')) hide(true);
}

// Focus that leaves the menu for another control (Shift+Tab, a click elsewhere) closes it.
function left(e: FocusEvent) {
  const to = e.relatedTarget;
  if (to instanceof Node && !root.value?.contains(to)) hide(false);
}

onBeforeUnmount(() => hide(false));
</script>

<template>
  <div ref="root" class="action-menu" @focusout="left">
    <button
      v-bind="$attrs"
      :id="id + '-button'"
      ref="trigger"
      type="button"
      class="btn action-menu-button"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="id"
      :aria-label="busyText ? undefined : label"
      :aria-disabled="busy || undefined"
      @click="toggle"
      @keydown="triggerKey"
    >
      <template v-if="busyText">{{ busyText }}</template
      ><svg v-else aria-hidden="true" viewBox="0 0 16 4" width="16" height="4">
        <circle cx="2" cy="2" r="1.6" />
        <circle cx="8" cy="2" r="1.6" />
        <circle cx="14" cy="2" r="1.6" />
      </svg>
    </button>
    <div
      :id="id"
      ref="list"
      class="action-menu-list"
      role="menu"
      :aria-labelledby="id + '-button'"
      :hidden="!open"
      @keydown="menuKey"
      @click.capture="chosen"
    >
      <slot />
    </div>
  </div>
</template>
