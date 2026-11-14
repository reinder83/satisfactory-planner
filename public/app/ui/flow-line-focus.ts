// "Open in build order" (FG-5, #1344): after the address has moved to a factory's flow page, brings
// the card of one production line into view and gives it focus. The flow page (GroupFlowPage.vue,
// BO-1) draws only the open step as a card, `.gf-card[data-line="<row id>"]`; the others are rows
// (`[data-step-row]`) and a step list (`[data-step-nav]`), whose buttons open a step and focus its
// card. So this waits, at most `wait` ms, for the page to draw; presses the line's row (or its
// entry in the step list) when it has no card yet; then scrolls to the card and focuses it. It
// gives up quietly where the page has nothing for the line.
export function focusFlowLine(row: string, wait = 3000): void {
  const until = Date.now() + wait;
  const id = CSS.escape(row);
  let pressed = false;
  const look = () => {
    const card = document.querySelector<HTMLElement>(`.gf-card[data-line="${id}"]`);
    if (card) {
      if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
      card.scrollIntoView({ block: 'center' });
      card.focus({ preventScroll: true });
      return;
    }
    const opener = pressed
      ? null
      : document.querySelector<HTMLElement>(`[data-step-row="${id}"], [data-step-nav="${id}"]`);
    if (opener) {
      pressed = true;
      opener.click();
    }
    if (Date.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
