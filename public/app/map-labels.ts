// Which names on the world map are drawn at the current zoom (MAP-5): a label that would sit on
// top of a label drawn before it is left out (it shows again on hover and on focus, and at a zoom
// where the pins are further apart), so no two names overlap and "Electro…" never hides under
// "Industrial parts". The pins and their accessible names are never affected: a label is
// decoration (aria-hidden), the name stays on the pin's aria-label.
//
// The boxes are estimated from the text, the font size and the CSS's own limits (style.css, the
// `.map-*-label` rules), not measured, so the answer is the same in a test and in a browser and
// needs no layout pass. Everything is in px on the drawn map.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
// One name to place, in the order of importance (the first is kept when two collide).
export interface MapLabel {
  id: string;
  box: Box;
}

// A little air around every box: two names closer than this read as touching.
const LABEL_PAD = 3;

const labelsOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.w + LABEL_PAD &&
  b.x < a.x + a.w + LABEL_PAD &&
  a.y < b.y + b.h + LABEL_PAD &&
  b.y < a.y + a.h + LABEL_PAD;

// The ids of the labels to leave out: a label is kept when it overlaps no label kept before it.
export function hiddenLabels(labels: readonly MapLabel[]): Set<string> {
  const hidden = new Set<string>();
  const kept: Box[] = [];
  for (const label of labels) {
    if (kept.some(box => labelsOverlap(box, label.box))) hidden.add(label.id);
    else kept.push(label.box);
  }
  return hidden;
}

// The width of a name set in the map's mono face: about 0.6 of the font size a character, cut at
// the label's max-width in characters (`ch`, as the CSS cuts it with an ellipsis).
export const textWidth = (text: string, fontPx: number, maxCh: number) =>
  Math.min(text.length, maxCh) * fontPx * 0.6;

// Where a name starts, as style.css draws a factory, station or marker: a 28px pin whose middle is
// on the spot, and the name 16px right of the middle.
const NAME_AT = 16;
const NAME_HEIGHT = 17;

// The box of the name of the item whose pin's middle is at (left, top).
export const nameBox = (
  left: number,
  top: number,
  text: string,
  fontPx: number,
  maxCh: number,
): Box => ({
  x: left + NAME_AT,
  y: top - NAME_HEIGHT / 2,
  w: textWidth(text, fontPx, maxCh),
  h: NAME_HEIGHT,
});

// A train line's name, set centred over its spot with its baseline at (x, y): 12px text.
export function lineNameBox(x: number, y: number, text: string): Box {
  const w = text.length * 12 * 0.6;
  return { x: x - w / 2, y: y - 12, w, h: 16 };
}
