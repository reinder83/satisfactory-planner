// Dismissing a modal <dialog> by a click on its backdrop (#285), for #detail (listeners.ts)
// and #confirm (ui/confirm.ts). A click on the backdrop reaches the <dialog> element itself,
// but so does a click on the dialog's own parts that are not a child element, such as the
// hazard strip on top (dialog::before in style.css): only a click outside the dialog's box
// is on the backdrop. A drag that starts inside the dialog (selecting text) and ends on the
// backdrop also fires a click on the <dialog>, so the press must have started there too.

// Whether a mouse event landed on the backdrop: on the <dialog> itself, outside its box.
function onBackdrop(dialog: HTMLDialogElement, event: MouseEvent) {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

// Calls `dismiss` for a click that was both pressed and released on the dialog's backdrop.
export function onBackdropClick(dialog: HTMLDialogElement, dismiss: () => void) {
  let pressedOnBackdrop = false;
  dialog.addEventListener('mousedown', event => {
    pressedOnBackdrop = onBackdrop(dialog, event);
  });
  dialog.addEventListener('click', event => {
    const pressed = pressedOnBackdrop;
    pressedOnBackdrop = false;
    if (pressed && onBackdrop(dialog, event)) dismiss();
  });
}
