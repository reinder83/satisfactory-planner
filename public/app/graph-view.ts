// Pan and zoom of a factory's flow graph (#1223, part of #1201), as plain arithmetic the dialog
// (ui/detail/FlowGraphDialog.vue) applies to its scrolling box. The drawing keeps its own
// coordinates (its viewBox); a zoom draws it `zoom` times its natural size, and `left` and `top`
// are the box's scroll offsets into that zoomed drawing, so the box's scrollbars and the keyboard
// keep scrolling it. Nothing here is saved: the view starts at natural size each time the
// dialog opens (remembering it is slice 2, #1224).

// The zoom the view keeps to: a tenth of natural size, enough to fit a factory of many lines,
// up to three times it. A button press zooms by `step`.
export const GRAPH_ZOOM = { min: 0.1, max: 3, step: 1.25 } as const;

export interface GraphView {
  zoom: number;
  left: number;
  top: number;
}
// A width and height in px: the box's visible area, or the drawing at natural size.
export interface GraphArea {
  width: number;
  height: number;
}
// A point in the box's visible area, in px from its top-left corner.
export interface GraphPoint {
  x: number;
  y: number;
}

export const clampGraphZoom = (zoom: number): number =>
  Math.min(GRAPH_ZOOM.max, Math.max(GRAPH_ZOOM.min, zoom));

// Scroll offsets the box can reach at `zoom`: from 0 to where the drawing's far edge meets the
// box's, 0 when the drawing is smaller than the box.
const clampOffset = (offset: number, drawn: number, visible: number): number =>
  Math.min(Math.max(0, drawn - visible), Math.max(0, offset));

// `view` with its offsets kept inside what the box can scroll to.
export function clampGraphView(view: GraphView, box: GraphArea, size: GraphArea): GraphView {
  const zoom = clampGraphZoom(view.zoom);
  return {
    zoom,
    left: clampOffset(view.left, size.width * zoom, box.width),
    top: clampOffset(view.top, size.height * zoom, box.height),
  };
}

// `view` zoomed by `factor` around `point`: the spot of the drawing under the point stays under
// it, as far as the box can scroll.
export function zoomGraphAround(
  view: GraphView,
  factor: number,
  point: GraphPoint,
  box: GraphArea,
  size: GraphArea,
): GraphView {
  const zoom = clampGraphZoom(view.zoom * factor);
  const ratio = zoom / view.zoom;
  return clampGraphView(
    {
      zoom,
      left: (view.left + point.x) * ratio - point.x,
      top: (view.top + point.y) * ratio - point.y,
    },
    box,
    size,
  );
}

// `view` moved so the drawing follows a drag of `dx`, `dy` px.
export const panGraphBy = (
  view: GraphView,
  dx: number,
  dy: number,
  box: GraphArea,
  size: GraphArea,
): GraphView => clampGraphView({ ...view, left: view.left - dx, top: view.top - dy }, box, size);

// The whole drawing in the box: the largest zoom at which it fits, never above natural size (a
// small graph is not blown up), from its top-left corner.
export function fitGraphView(box: GraphArea, size: GraphArea): GraphView {
  const fits = Math.min(box.width / size.width, box.height / size.height, 1);
  return { zoom: clampGraphZoom(Number.isFinite(fits) && fits > 0 ? fits : 1), left: 0, top: 0 };
}

// The zoom factor of one wheel event: a notch of a mouse wheel (100 px, or 3 lines) zooms by about
// 1.2, up the wheel in, down out; a touchpad's small steps zoom smoothly. `deltaMode` is the
// event's: 0 px, 1 lines, 2 pages.
export function graphWheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return Math.exp(-Math.max(-500, Math.min(500, px)) * 0.0018);
}
