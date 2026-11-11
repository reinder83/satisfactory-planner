// The popup behind a glossary term (ui/Term.vue) and a "?" help button (ui/HelpPopover.vue, X-3,
// #1333): one trigger button and one tooltip, so both open, close, place and focus the same way.
// It opens on hover, on keyboard focus and on a tap or click (which keeps it open until the next
// tap, a tap elsewhere or Escape); Escape closes it without moving focus. The tooltip is drawn at
// the end of <body> (the component Teleports it), fixed under the trigger, so a box that scrolls
// or clips never cuts it off; it follows the trigger when the page or a box scrolls, goes above it
// when there is no room below, and moves left or right to stay inside the window. The mouse may
// move from the trigger onto the tooltip without closing it.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const TIP_MARGIN = 8,
  TIP_GAP = 4;
// The mouse leaving the trigger closes the tooltip a moment later, so it can cross the gap onto
// the tooltip, which keeps it open.
const TIP_LEAVE_DELAY = 100;

export function useTipPopup() {
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

  // Whether a node is the trigger or its tooltip, which is elsewhere in the page.
  const ours = (node: EventTarget | null) =>
    !!node && (!!root.value?.contains(node as Node) || !!tip.value?.contains(node as Node));

  let leaving: ReturnType<typeof setTimeout> | undefined;
  function pointerEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(leaving);
    hovered.value = true;
  }
  function pointerLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(leaving);
    leaving = setTimeout(() => (hovered.value = false), TIP_LEAVE_DELAY);
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
  // A tap or click anywhere else closes a pinned tooltip (a phone's tap does not always move
  // focus, so blur alone would leave it open).
  function outside(event: PointerEvent) {
    if (!ours(event.target)) pinned.value = hovered.value = false;
  }

  // Place the open tooltip under the trigger (above it when it does not fit below but does
  // above), shifted sideways by what would stick out of the window.
  function place() {
    const box = tip.value,
      anchorButton = button.value;
    if (!box || !anchorButton) return;
    const anchor = anchorButton.getBoundingClientRect(),
      width = document.documentElement.clientWidth || window.innerWidth,
      height = document.documentElement.clientHeight || window.innerHeight,
      size = box.getBoundingClientRect();
    const left = Math.max(TIP_MARGIN, Math.min(anchor.left, width - TIP_MARGIN - size.width));
    const below = anchor.bottom + TIP_GAP,
      above = anchor.top - TIP_GAP - size.height;
    const top = below + size.height > height - TIP_MARGIN && above >= TIP_MARGIN ? above : below;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }

  // While open: follow the trigger on any scroll (the page's or a box's, caught on the way down)
  // and on a resize, and listen for a tap elsewhere.
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

  return {
    root,
    button,
    tip,
    open,
    press,
    pointerEnter,
    pointerLeave,
    focus,
    blur,
    click,
    close,
  };
}
