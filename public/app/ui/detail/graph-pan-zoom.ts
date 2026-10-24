// Pan and zoom for the flow graph's scrolling box (FlowGraphDialog.vue, #1223, part of #1201),
// with the arithmetic in graph-view.ts. The box keeps scrolling as before (scrollbars, the
// keyboard once it has focus); on top of that:
// - the wheel over the box zooms around the pointer, and only there: the page and the dialog
//   outside the box scroll as usual (a sideways wheel or touchpad swipe still scrolls the box);
// - a press on the background followed by a drag of a few px moves the drawing (mouse, pen or one
//   finger: the box has touch-action: none, nowhere else does);
// - a press on a box (a production line's, #1224, or since #1240 an input's or an output's)
//   followed by a drag of as many px moves that box (`lines`: where it is, where it goes, and the
//   drop, which the dialog saves; the dialog snaps it to the grid), while a press on a box without
//   a drag stays a click;
// - two fingers pinch to zoom around their middle, and move the drawing as they move;
// - zoomIn, zoomOut and fit for the buttons, around the middle of the box.
// show() puts a view back (the stored zoom and scroll offsets, #1224); the dialog saves them.
import { nextTick, ref, type Ref } from 'vue';
import {
  fitGraphView,
  GRAPH_ZOOM,
  graphWheelFactor,
  panGraphBy,
  zoomGraphAround,
  type GraphArea,
  type GraphPoint,
  type GraphView,
} from '../../graph-view.ts';

// How far (px) a press moves before it is a drag rather than a click.
export const PAN_THRESHOLD = 4;

interface Press {
  id: number;
  start: GraphPoint;
  left: number;
  top: number;
  panning: boolean;
  // A press on a box (a line's or a place's): its node id and where the box was (drawing units).
  line?: { node: string; from: GraphPoint; moved: boolean };
}

// What a drag of a box does (#1224, #1240): `at` gives where the box with node id `node` is now
// (null for one that does not move), `move` puts it somewhere else (drawing units, whole and never
// above or left of the drawing) as the pointer moves, and `drop` runs once when a drag that moved
// it ends.
export interface GraphLineDrag {
  at(node: string): GraphPoint | null;
  move(node: string, to: GraphPoint): void;
  drop(node: string): void;
}

export function useGraphPanZoom(
  box: Ref<HTMLElement | null>,
  size: () => GraphArea | null,
  lines?: GraphLineDrag,
) {
  const zoom = ref(1);
  const panning = ref(false);
  // A box is being dragged, for the grabbing cursor.
  const moving = ref(false);
  // Where each pointer on the box is (client px), for a pinch; the press a pan may start from.
  const pointers = new Map<number, GraphPoint>();
  let press: Press | null = null;
  let pinchDistance = 0;
  let pinchMiddle: GraphPoint = { x: 0, y: 0 };
  // A drag just ended: the click the browser sends after it is not a click on what it ended on.
  let dragged = false;

  const visible = (el: HTMLElement): GraphArea => ({
    width: el.clientWidth,
    height: el.clientHeight,
  });
  const current = (el: HTMLElement): GraphView => ({
    zoom: zoom.value,
    left: el.scrollLeft,
    top: el.scrollTop,
  });
  // A client point as a point in the box's visible area.
  const inBox = (el: HTMLElement, x: number, y: number): GraphPoint => {
    const rect = el.getBoundingClientRect();
    return { x: x - rect.left - el.clientLeft, y: y - rect.top - el.clientTop };
  };
  // The zoom first (the drawing's size follows on the next render), then the scroll offsets the
  // bigger or smaller drawing can take.
  async function show(view: GraphView) {
    zoom.value = view.zoom;
    await nextTick();
    const el = box.value;
    if (!el) return;
    el.scrollLeft = view.left;
    el.scrollTop = view.top;
  }
  function zoomBy(factor: number, point?: GraphPoint) {
    const el = box.value;
    const natural = size();
    if (!el || !natural) return;
    const area = visible(el);
    const at = point ?? { x: area.width / 2, y: area.height / 2 };
    return show(zoomGraphAround(current(el), factor, at, area, natural));
  }
  const zoomIn = () => zoomBy(GRAPH_ZOOM.step);
  const zoomOut = () => zoomBy(1 / GRAPH_ZOOM.step);
  function fit() {
    const el = box.value;
    const natural = size();
    if (el && natural) return show(fitGraphView(visible(el), natural));
  }

  function onWheel(e: WheelEvent) {
    const el = box.value;
    if (!el || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    void zoomBy(graphWheelFactor(e.deltaY, e.deltaMode), inBox(el, e.clientX, e.clientY));
  }

  // A press on the box's own scrollbar, which keeps doing what a scrollbar does.
  const onScrollbar = (el: HTMLElement, e: PointerEvent) => {
    const point = inBox(el, e.clientX, e.clientY);
    return point.x > el.clientWidth || point.y > el.clientHeight;
  };
  const middle = (): GraphPoint => {
    const [a, b] = [...pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  };
  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  // A press on a box moves the box once it is a drag; one anywhere else moves the drawing.
  function startPress(el: HTMLElement, e: PointerEvent) {
    const onNode = e.target instanceof Element ? e.target.closest('[data-node]') : null;
    const node = onNode?.getAttribute('data-node') ?? '';
    const from = node ? lines?.at(node) : null;
    press = {
      id: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      left: el.scrollLeft,
      top: el.scrollTop,
      panning: false,
      ...(from ? { line: { node, from, moved: false } } : {}),
    };
  }
  // The box under a drag, moved as far as the pointer, in the drawing's units.
  function dragLine(el: HTMLElement, current: Press, dx: number, dy: number) {
    const line = current.line;
    if (!line) return;
    if (!line.moved) {
      line.moved = moving.value = true;
      el.setPointerCapture?.(current.id);
    }
    lines?.move(line.node, {
      x: Math.max(0, Math.round(line.from.x + dx / zoom.value)),
      y: Math.max(0, Math.round(line.from.y + dy / zoom.value)),
    });
  }
  function onPointerDown(e: PointerEvent) {
    const el = box.value;
    if (!el || (e.pointerType === 'mouse' && e.button !== 0) || onScrollbar(el, e)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    if (pointers.size === 1) return startPress(el, e);
    // A second finger: a pinch, which no click follows. A box it was moving stays there.
    if (press?.line?.moved) lines?.drop(press.line.node);
    press = null;
    moving.value = false;
    pinchDistance = spread();
    pinchMiddle = middle();
    dragged = true;
  }
  function pinch(el: HTMLElement) {
    const distance = spread();
    const at = middle();
    const natural = size();
    if (!natural || pinchDistance === 0) return;
    const area = visible(el);
    const zoomed = zoomGraphAround(
      current(el),
      distance / pinchDistance,
      inBox(el, at.x, at.y),
      area,
      natural,
    );
    const moved = panGraphBy(zoomed, at.x - pinchMiddle.x, at.y - pinchMiddle.y, area, natural);
    pinchDistance = distance;
    pinchMiddle = at;
    void show(moved);
  }
  function onPointerMove(e: PointerEvent) {
    const el = box.value;
    if (!el || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) return pinch(el);
    if (!press || press.id !== e.pointerId) return;
    const dx = e.clientX - press.start.x;
    const dy = e.clientY - press.start.y;
    if (!press.panning && !press.line?.moved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
    if (press.line) return dragLine(el, press, dx, dy);
    if (!press.panning) {
      press.panning = panning.value = true;
      el.setPointerCapture?.(e.pointerId);
    }
    el.scrollLeft = press.left - dx;
    el.scrollTop = press.top - dy;
  }
  function onPointerUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    const line = press?.line;
    if (press?.panning || line?.moved) dragged = true;
    press = null;
    panning.value = moving.value = false;
    if (line?.moved) lines?.drop(line.node);
    // A finger left after a pinch moves the drawing from where it is now.
    const el = box.value;
    const [rest] = [...pointers.entries()];
    if (el && rest)
      press = {
        id: rest[0],
        start: rest[1],
        left: el.scrollLeft,
        top: el.scrollTop,
        panning: true,
      };
  }
  // In the capture phase on the box: the click that ends a drag or a pinch goes nowhere.
  function onClickCapture(e: MouseEvent) {
    if (!dragged) return;
    dragged = false;
    e.stopPropagation();
    e.preventDefault();
  }

  return {
    zoom,
    panning,
    moving,
    show,
    zoomIn,
    zoomOut,
    fit,
    handlers: {
      wheel: onWheel,
      pointerdown: onPointerDown,
      pointermove: onPointerMove,
      pointerup: onPointerUp,
      pointercancel: onPointerUp,
    },
    onClickCapture,
  };
}
