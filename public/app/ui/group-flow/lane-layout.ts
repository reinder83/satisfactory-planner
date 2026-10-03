// The lanes of a group's flow page (#894), measured after layout. The page leaves a gutter left
// of its cards sized to the lanes the group needs (laneGutter in group-flow.ts), and this
// measures where each row's name sits so laneWires (views/group-flow-page.ts) can draw each link
// from a dot on its output row to an arrowhead on its input row. It measures again whenever the
// drawing changes size (a row wrapping, a font arriving, the window turning to a phone's width)
// and after the flow changes.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { LANE_METRICS, laneGutter } from '../../group-flow.ts';
import type { GroupFlow } from '../../group-flow.ts';
import { laneWires, type RowAnchor } from '../../views/group-flow-page.ts';

// The phone layout's width, as in style.css.
const NARROW = '(max-width: 720px)';

// The middle of the first line of a row's name: a row whose text wraps is pointed at by its
// item's name, not between its lines (#894). An inline box has one client rect per line.
function nameMiddle(name: Element): number {
  const first = name.getClientRects()[0] ?? name.getBoundingClientRect();
  return first.top + first.height / 2;
}

// Every row's anchor in `host`: rows are marked data-row (the row's id in the flow) and hold
// their name in .gf-name; a row's card is its .gf-card.
function measureAnchors(host: HTMLElement): Map<string, RowAnchor> {
  const base = host.getBoundingClientRect();
  const anchors = new Map<string, RowAnchor>();
  for (const row of host.querySelectorAll<HTMLElement>('[data-row]')) {
    const name = row.querySelector('.gf-name'),
      card = row.closest('.gf-card');
    if (!name || !card) continue;
    anchors.set(row.dataset.row!, {
      x: card.getBoundingClientRect().left - base.left,
      y: nameMiddle(name) - base.top,
    });
  }
  return anchors;
}

export function useLaneLayout(host: Ref<HTMLElement | null>, flow: () => GroupFlow | null) {
  const narrow = ref(false);
  const metrics = computed(() => (narrow.value ? LANE_METRICS.narrow : LANE_METRICS.wide));
  const gutter = computed(() => laneGutter(flow()?.laneCount ?? 0, metrics.value));
  const anchors = shallowRef(new Map<string, RowAnchor>());

  function measure() {
    const el = host.value;
    if (!el) return;
    anchors.value = measureAnchors(el);
  }
  const wires = computed(() => laneWires(flow()?.lanes ?? [], anchors.value, metrics.value));

  let media: MediaQueryList | undefined;
  let observer: ResizeObserver | undefined;
  const turned = (event: MediaQueryListEvent) => {
    narrow.value = event.matches;
  };
  onMounted(() => {
    media = globalThis.matchMedia?.(NARROW);
    narrow.value = media?.matches === true;
    media?.addEventListener?.('change', turned);
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => measure());
      if (host.value) observer.observe(host.value);
    }
    void nextTick(measure);
  });
  onBeforeUnmount(() => {
    media?.removeEventListener?.('change', turned);
    observer?.disconnect();
  });
  // A new flow (another phase, group or tick) or gutter redraws the rows: measure them after.
  watch([flow, gutter, host], async () => {
    await nextTick();
    observer?.disconnect();
    if (host.value) observer?.observe(host.value);
    measure();
  });

  return { gutter, wires };
}
