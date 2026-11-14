// "Open in build order" (FG-5, #1344): after the address has moved to a factory's flow page, brings
// the card of one production line into view and gives it focus. The flow page draws a line's card
// as `.gf-card[data-line="<row id>"]`; the page appears after the address changes, so this waits
// for the card, at most `wait` ms, and gives up quietly where the page has no card for the line.
export function focusFlowLine(row: string, wait = 3000): void {
  const until = Date.now() + wait;
  const find = () =>
    document.querySelector<HTMLElement>(`.gf-card[data-line="${CSS.escape(row)}"]`);
  const look = () => {
    const card = find();
    if (!card) {
      if (Date.now() < until) requestAnimationFrame(look);
      return;
    }
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
    card.scrollIntoView({ block: 'center' });
    card.focus({ preventScroll: true });
  };
  requestAnimationFrame(look);
}
