// A polite announcement for a screen reader when long work is done and nothing else says so
// (#1255): "Rank alternates" and the wizard's "Calculate plan" keep focus on their busy button
// while they run (app/busy.ts, #299), and the result arrives on the page without a word. The
// message goes into #announce (index.html), a visually hidden live region that is always on the
// page, so the change is read out; a page without it (a component test) gets one. The region is
// emptied first and filled a moment later, so the same message twice is read twice.
const ANNOUNCE_DELAY_MS = 100;
let announceTimer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string) {
  let region = document.querySelector<HTMLElement>('#announce');
  if (!region) {
    region = document.createElement('div');
    region.id = 'announce';
    region.className = 'visually-hidden';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const live = region;
  live.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => (live.textContent = message), ANNOUNCE_DELAY_MS);
}
