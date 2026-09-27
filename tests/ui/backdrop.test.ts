// Dismissing #detail and #confirm by a click on the backdrop (public/app/backdrop.ts, #285):
// a click on the dialog's own hazard strip or a drag that starts inside the dialog does not
// close it; a click pressed and released outside its box does.
import assert from 'node:assert/strict';
import { beforeAll, test } from 'vitest';
import { openFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { confirmAction } from '../../public/app/ui/confirm.ts';
import { $, go, open, page } from './setup.ts';

// happy-dom does no layout, so each dialog gets a box: 100..500 across, 100..400 down.
const place = (d: HTMLDialogElement) => {
  d.getBoundingClientRect = () => new DOMRect(100, 100, 400, 300);
};
const mouse = (target: Element, type: string, clientX: number, clientY: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
// A click pressed at one point and released at another, as the browser fires it: the click
// goes to the element holding both points (the <dialog> for a drag out of its content).
const click = (down: Element, from: [number, number], up: Element, to: [number, number]) => {
  mouse(down, 'mousedown', ...from);
  mouse(up, 'mouseup', ...to);
  mouse(up, 'click', ...to);
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeAll(async () => {
  page();
  open();
  // The #detail backdrop listener is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
  go('factories');
  render();
});

test('#detail stays open for a click on its strip or a drag out of it, and closes for the backdrop', async () => {
  const d = $<HTMLDialogElement>('#detail')!;
  openFactory('wire');
  place(d);
  const body = d.querySelector('.dialog-body')!;
  // The hazard strip (dialog::before) is part of the <dialog> itself, inside its box.
  click(d, [300, 103], d, [300, 103]);
  await settle();
  assert.equal(d.open, true, 'a click on the strip keeps it open');
  // Selecting text in the dialog and letting go over the backdrop.
  click(body, [200, 200], d, [50, 250]);
  await settle();
  assert.equal(d.open, true, 'a drag out of the dialog keeps it open');
  // Pressed on the backdrop, released inside: not a backdrop click either.
  click(d, [50, 250], d, [300, 103]);
  await settle();
  assert.equal(d.open, true, 'a drag into the dialog keeps it open');
  click(d, [50, 250], d, [52, 251]);
  await settle();
  assert.equal(d.open, false, 'a click on the backdrop closes it');
});

test('#confirm answers nothing for a click on its strip or a drag out of it, and Cancel for the backdrop', async () => {
  const d = $<HTMLDialogElement>('#confirm')!;
  let answer: boolean | undefined;
  void confirmAction({ title: 'Remove this?', body: 'It goes.', confirmLabel: 'Remove' }).then(
    ok => (answer = ok),
  );
  place(d);
  click(d, [300, 103], d, [300, 103]);
  click(d.querySelector('#confirm-body')!, [200, 200], d, [300, 450]);
  await settle();
  assert.equal(d.open, true);
  assert.equal(answer, undefined, 'not answered yet');
  click(d, [300, 450], d, [300, 450]);
  await settle();
  assert.equal(d.open, false);
  assert.equal(answer, false, 'the backdrop answers Cancel');
});
