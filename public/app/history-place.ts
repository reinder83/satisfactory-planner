// The place of the current history entry in the tab's history, so that acceptRoute() in api.ts
// can take a Back or Forward the user keeps their unsaved notes against back exactly, with
// history.go(), rather than rewriting an entry (#980).
//
// Where the browser has the Navigation API, its entry index is the place: exact for every entry
// of the tab, including those an earlier release of the app made (Chrome keeps a reloaded tab's
// earlier entries as the same document, so Back reaches them with a hashchange). Elsewhere the
// app writes the place into each entry's state as it shows it (`history.state[PLACE_KEY]`),
// which the browser keeps with the entry, across a reload too: the entry it starts on is 0 unless
// it has a place already, and a new entry is the one after the page it was reached from
// (placeNewEntry). An entry without either is taken for a new address (a link, navigate() or a
// typed address), since the browser adds that straight after the page on screen.
const PLACE_KEY = 'plannerEntry';

type NavigationIndex = { navigation?: { currentEntry?: { index?: unknown } | null } };

export function entryPlace(): number | undefined {
  // The Navigation API is not in every browser, nor in the test DOM: read it as optional.
  const navigationIndex = (globalThis as NavigationIndex).navigation?.currentEntry?.index;
  if (typeof navigationIndex === 'number' && navigationIndex >= 0) return navigationIndex;
  const entryState: unknown = globalThis.history?.state;
  if (typeof entryState !== 'object' || entryState === null) return undefined;
  const stored: unknown = (entryState as Record<string, unknown>)[PLACE_KEY];
  return typeof stored === 'number' && Number.isSafeInteger(stored) ? stored : undefined;
}

// The current entry's state with `place` written in, keeping anything else it holds.
export function placedState(place: number) {
  const entryState: unknown = history.state;
  const kept = typeof entryState === 'object' && entryState !== null ? entryState : {};
  return { ...kept, [PLACE_KEY]: place };
}

// Writes `place` into the current entry, which keeps its address.
export function placeEntry(place: number) {
  history.replaceState(placedState(place), '');
}

// The place of the entry the app starts on, written into it when it has none. Without a history
// that can be written (the interface tests' stand-ins) it is 0 and nothing is touched.
export function startPlace() {
  const place = entryPlace();
  if (place !== undefined) return place;
  if (typeof globalThis.history?.replaceState === 'function') placeEntry(0);
  return 0;
}
