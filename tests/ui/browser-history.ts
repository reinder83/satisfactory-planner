// Makes happy-dom's history behave as a browser's where the app depends on it (#991). Loaded
// before every component test file (setupFiles in vite.config.ts), so before any test or app
// module adds a hashchange listener.
//
// happy-dom fires a hashchange when history.replaceState() or pushState() changes the hash.
// Browsers never do: only a link, a typed address, setting location.hash, or a move through
// the history (Back, Forward, history.go()) fires one. The app relies on that: acceptRoute() and
// render() rewrite the address with replaceState (api.ts, shell.ts), and an extra hashchange runs
// the app's listener (listeners.ts) once more, which records the rewritten address as the page on
// screen and so hides whether the app recorded it itself (#973). So each hash change made by
// replaceState or pushState is noted, and its hashchange is stopped before any listener sees it.
// happy-dom dispatches it a moment later through window, with the change's old and new address.
//
// A test that stands in for a link, a typed address or Back without adding a history entry calls
// followInPlace(), which changes the address with the hashchange a browser fires for those.

// happy-dom's own replaceState and pushState, which fire the hashchange.
const happy = typeof History === 'undefined' ? null : History.prototype;
const happyReplaceState = happy?.replaceState;
const happyPushState = happy?.pushState;
// "<old address> <new address>" of each hash change the history API made, until its event comes.
const silent: string[] = [];

function quietly(change: () => void) {
  const oldURL = location.href;
  change();
  if (new URL(oldURL).hash !== location.hash) silent.push(`${oldURL} ${location.href}`);
}
// Not in a test file that runs in Node (app-modules.test.ts), which has no page.
if (happy && happyReplaceState && happyPushState) {
  happy.replaceState = function (
    this: History,
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    quietly(() => happyReplaceState.call(this, state, unused, url));
  };
  happy.pushState = function (
    this: History,
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    quietly(() => happyPushState.call(this, state, unused, url));
  };
  // A capturing listener on window runs before the listeners the app and the tests add there.
  window.addEventListener(
    'hashchange',
    event => {
      const index = silent.indexOf(`${event.oldURL} ${event.newURL}`);
      if (index < 0) return;
      silent.splice(index, 1);
      event.stopImmediatePropagation();
    },
    true,
  );
}

// Changes the address to `url` the way a link, a typed address or Back does, with its hashchange
// (the app's listener then draws the page), but in place: no history entry is added, as the
// tests used to do through replaceState. `state` is the entry's new state (a link's is null).
// route-history.test.ts uses it under its model of a whole session history.
export function followInPlace(url: string, state: unknown = null) {
  happyReplaceState?.call(history, state, '', url);
}
