// A box whose table may be wider than the box (#1020, #1074), the element of the template ref
// `name`: whether it scrolls sideways, worked out when the box is drawn and whenever it or the
// table in it changes size (a closed box has no width, so it scrolls nothing). A box that scrolls
// takes keyboard focus, named for its table, so the arrow keys can scroll it; StepTable.vue and
// the profile comparison bind `tabindex`, `role` and `aria-label` from `scrollAttrs`.
import { onBeforeUnmount, ref, useTemplateRef, watch, type Ref } from 'vue';

export function useScrollBox(name: string): {
  scrolls: Ref<boolean>;
  scrollAttrs: (label: string) => Record<string, string | number | undefined>;
} {
  const box = useTemplateRef<HTMLElement>(name);
  const scrolls = ref(false);
  const measure = () => {
    const el = box.value;
    scrolls.value = !!el && el.scrollWidth > el.clientWidth + 1;
  };
  let observer: ResizeObserver | undefined;
  // Whenever the box is drawn (it may come and go with a v-if), measure it and watch its size.
  watch(
    box,
    el => {
      observer?.disconnect();
      measure();
      if (typeof ResizeObserver === 'undefined' || !el) return;
      observer = new ResizeObserver(measure);
      // The box, and the table in it, which grows without the box when its rows change.
      for (const part of [el, ...el.children]) observer.observe(part);
    },
    { flush: 'post' },
  );
  onBeforeUnmount(() => observer?.disconnect());
  const scrollAttrs = (label: string) => ({
    tabindex: scrolls.value ? 0 : undefined,
    role: scrolls.value ? 'region' : undefined,
    'aria-label': scrolls.value ? label + ' (scrolls sideways)' : undefined,
  });
  return { scrolls, scrollAttrs };
}
