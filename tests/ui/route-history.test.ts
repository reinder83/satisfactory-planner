// Keeping unsaved work against a Back, a Forward or a new address leaves the browser's history as
// it was (#980). The hashchange listener asks first (acceptRoute in api.ts); when the user keeps
// a "Made on site" choice that is not saved (#930), the app steps back to the page still on
// screen with history.go(), by the places of the two entries (history-place.ts), instead of
// rewriting the entry the user tried to reach. So Forward still reaches it, Back goes one page
// back in one press, and that step brings no second question, redraw or scroll to the top.
//
// happy-dom's own history differs from a browser's where this matters: setting location.hash
// copies the current entry's state into the new entry, replaceState drops the entries after the
// current one, and a replaceState that changes the hash fires a hashchange (which
// browser-history.ts drops for every component test, #991). So the tests run on
// a browser's session history (browserHistory below): a list of entries with their state, where
// a link or typed address (setting location.hash) adds an entry after the current one and fires
// a hashchange, pushState and replaceState fire none, and go(), back() and forward() move a
// moment later and fire a hashchange when the hash changes. Each hashchange runs the app's own
// listener (listeners.ts). happy-dom has no Navigation API, so the places come from
// history.state here; the real-browser check in the pull request covers both.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test, vi } from 'vitest';
import { entryPlace, placeEntry, startPlace } from '../../public/app/history-place.ts';
import { setFactoryEditing, setFactoryFilter, setQuery, view } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  answerConfirms,
  applyUpdate,
  followInPlace,
  generated,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

// Puts a browser's session history over happy-dom's (see above). The address on screen is set
// through happy-dom's own replaceState (followInPlace), whose hashchange is let through for a
// link, typed address or move through the history and dropped for pushState and replaceState,
// which fire none in a browser. Returns `idle`, true while no move or hashchange is on its way, and `restore`.
function browserHistory() {
  const entries: { url: string; state: unknown }[] = [{ url: location.href, state: history.state }];
  let current = 0;
  const hashProperty = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(location), 'hash')!;
  const dispatch = window.dispatchEvent;
  const silent: string[] = [];
  let underway = 0;
  const arrived = new WeakSet<Event>();
  const show = (url: string, quiet: boolean) => {
    const oldURL = location.href;
    followInPlace(url);
    if (location.hash === new URL(oldURL).hash) return;
    if (quiet) silent.push(`${oldURL} ${location.href}`);
    else underway++;
  };
  const add = (url: string, state: unknown, quiet: boolean) => {
    entries.splice(current + 1, Infinity, { url, state });
    current++;
    show(url, quiet);
  };
  const absolute = (url?: string | URL | null) => (url ? new URL(url, location.href).href : null);
  const go = (steps = 0) => {
    underway++;
    setTimeout(() => {
      underway--;
      const entry = entries[current + steps];
      if (!steps || !entry) return;
      current += steps;
      show(entry.url, false);
    });
  };
  const own = {
    state: { configurable: true, get: () => entries[current]!.state },
    length: { configurable: true, get: () => entries.length },
    pushState: {
      configurable: true,
      value: (state: unknown, _unused: string, url?: string | URL | null) =>
        add(absolute(url) ?? location.href, structuredClone(state), true),
    },
    replaceState: {
      configurable: true,
      value: (state: unknown, _unused: string, url?: string | URL | null) => {
        const href = absolute(url);
        entries[current] = { url: href ?? entries[current]!.url, state: structuredClone(state) };
        if (href) show(href, true);
      },
    },
    go: { configurable: true, value: go },
    back: { configurable: true, value: () => go(-1) },
    forward: { configurable: true, value: () => go(1) },
  };
  Object.defineProperties(history, own);
  Object.defineProperty(location, 'hash', {
    configurable: true,
    get: () => hashProperty.get!.call(location),
    set: (hash: string) => {
      const url = new URL(location.href);
      url.hash = hash;
      if (url.hash !== new URL(location.href).hash) add(url.href, null, false);
    },
  });
  window.dispatchEvent = function (event: Event) {
    const change = event instanceof HashChangeEvent ? `${event.oldURL} ${event.newURL}` : null;
    const index = change === null ? -1 : silent.indexOf(change);
    // happy-dom passes an event through dispatchEvent once per phase: count it once.
    if (change !== null && index < 0 && !arrived.has(event)) {
      arrived.add(event);
      underway--;
    }
    if (index < 0) return dispatch.call(window, event);
    silent.splice(index, 1);
    return true;
  };
  return {
    idle: () => underway === 0,
    restore() {
      for (const name of Object.keys(own)) Reflect.deleteProperty(history, name);
      Reflect.deleteProperty(location, 'hash');
      window.dispatchEvent = dispatch;
    },
  };
}

const MOTORS = 'fg-motors1';
const groups: FactoryGroups = {
  groups: [{ id: MOTORS, name: 'Motors' }],
  assignments: {
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: MOTORS, rate: null }],
  },
};
const pause = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
let browser: ReturnType<typeof browserHistory>;
// Waits for a move and what follows it: its hashchange, the question, and the step back or
// forward the app takes in answer, each a moment later, until nothing is on its way twice over.
const settle = async () => {
  for (let quiet = 0, rounds = 0; quiet < 2; rounds++) {
    assert.ok(rounds < 100, 'the history comes to rest');
    await pause();
    quiet = browser.idle() ? quiet + 1 : 0;
  }
};
const wire = () =>
  $<HTMLInputElement>(`[data-on-site-picker="${MOTORS}"] [data-on-site-item="Wire"]`);
const discard = () => $<HTMLButtonElement>(`[data-on-site-discard="${MOTORS}"]`);
// A link, a typed address, Back and Forward, each followed by the app's hashchange listener.
async function follow(route: string) {
  location.hash = route;
  await settle();
}
async function back() {
  history.back();
  await settle();
}
async function forward() {
  history.forward();
  await settle();
}
// Where the tab is: the address and the page drawn.
const at = () => [location.hash, view];

let sent: UpdateOp[] = [];

beforeAll(async () => {
  page();
  // The hashchange listener is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
  browser = browserHistory();
});
afterAll(() => browser.restore());

// The history ends …, Backup, Notes, Factories, Build plan, with Factories on screen (Build plan
// is the entry Forward reaches) in edit mode, nothing unsaved yet. Backup first, so each test
// starts from a page it never ends on.
beforeEach(async () => {
  page();
  setQuery('');
  setFactoryFilter('all');
  open({ calculated: generated(), state: { factoryGroups: structuredClone(groups) } });
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  for (const route of ['backup', 'notes', 'factories', 'plan']) await follow(route);
  await back();
  assert.deepEqual(at(), ['#factories', 'factories']);
  setFactoryEditing(true);
  render();
  await settle();
});

afterEach(async () => {
  discard()?.click();
  await settle();
  setFactoryEditing(false);
  vi.restoreAllMocks();
});

// Ticks Wire under Motors: a choice only Save stores, so leaving asks first.
async function tickWire() {
  const box = wire()!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  assert.ok(discard(), 'the choice is not saved yet');
}

test('a cancelled Forward keeps the entry it tried to reach, and Back goes one page back', async () => {
  await tickWire();
  const length = history.length;
  const asked = answerConfirms(false);
  await forward();
  assert.equal(asked.length, 1, 'Forward asks first');
  assert.deepEqual(at(), ['#factories', 'factories'], 'kept: the page and its address stay');
  assert.equal(history.length, length, 'no entry is added');
  assert.ok(wire()!.checked, 'the choice is still there to save');
  // Forward still reaches the build plan's entry, and asks again while the choice is unsaved.
  await forward();
  assert.equal(asked.length, 2, 'Forward asks again: the entry is still there');
  assert.deepEqual(at(), ['#factories', 'factories']);
  // Nothing unsaved any more: Forward goes there without a question, and Back comes back.
  discard()!.click();
  await settle();
  await forward();
  assert.deepEqual(at(), ['#plan', 'plan'], 'Forward reaches the build plan');
  await back();
  assert.deepEqual(at(), ['#factories', 'factories']);
  // Back goes one page back in one press: the entries are as they were.
  await back();
  assert.deepEqual(at(), ['#notes', 'notes'], 'one Back reaches the page before');
  await back();
  assert.deepEqual(at(), ['#backup', 'backup']);
  assert.equal(asked.length, 2);
  assert.deepEqual(sent, [], 'nothing is saved by itself');
});

test('a cancelled Back keeps the page the user came from', async () => {
  await tickWire();
  const length = history.length;
  const asked = answerConfirms(false);
  await back();
  assert.equal(asked.length, 1, 'Back asks first');
  assert.deepEqual(at(), ['#factories', 'factories'], 'kept: the page and its address stay');
  assert.equal(history.length, length);
  assert.ok(wire()!.checked);
  // Back after the cancel goes to the page before, in one press: asked again, and left anyway.
  answerConfirms(true);
  await back();
  assert.deepEqual(at(), ['#notes', 'notes'], 'Back reaches the page the user came from');
  await back();
  assert.deepEqual(at(), ['#backup', 'backup']);
  // Forward walks the same entries again.
  for (const route of ['notes', 'factories', 'plan']) {
    await forward();
    assert.deepEqual(at(), ['#' + route, route]);
  }
  assert.equal(history.length, length);
  assert.deepEqual(sent, []);
});

test('Leave without saving goes to the entry asked for, adding none', async () => {
  await tickWire();
  const length = history.length;
  const agreed = answerConfirms(true);
  await forward();
  assert.equal(agreed.length, 1);
  assert.deepEqual(at(), ['#plan', 'plan'], 'the build plan is drawn');
  assert.equal(history.length, length, 'no entry is added');
  assert.deepEqual(sent, [], 'the choice is not saved');
  await back();
  assert.deepEqual(at(), ['#factories', 'factories'], 'Back returns to the page left');
  assert.equal(wire()!.checked, false, 'the saved choice is shown again');
  await back();
  assert.deepEqual(at(), ['#notes', 'notes']);
});

test('Leave without saving pressed after the step back has arrived goes there too', async () => {
  await tickWire();
  const length = history.length;
  // No answer is set up: the question waits, as for a person reading it.
  await forward();
  const dialog = $<HTMLDialogElement>('#confirm')!;
  assert.ok(dialog.open, 'the question is open');
  assert.deepEqual(at(), ['#factories', 'factories'], 'meanwhile the step back has arrived');
  $<HTMLButtonElement>('#confirm [data-confirm-ok]')!.click();
  await settle();
  assert.deepEqual(at(), ['#plan', 'plan']);
  assert.equal(history.length, length);
  await back();
  assert.deepEqual(at(), ['#factories', 'factories']);
  assert.deepEqual(sent, []);
});

test('a link or typed address kept against leaves no duplicate entry: it becomes the next one', async () => {
  await tickWire();
  const length = history.length;
  const asked = answerConfirms(false);
  // A new address from Factories replaces the entries after it (Build plan) with itself.
  await follow('resources');
  assert.equal(asked.length, 1);
  assert.deepEqual(at(), ['#factories', 'factories'], 'kept: the page and its address stay');
  assert.equal(history.length, length, 'the new entry took the place of Build plan');
  discard()!.click();
  await settle();
  await back();
  assert.deepEqual(at(), ['#notes', 'notes'], 'one Back reaches the page before: no duplicate');
  await forward();
  assert.deepEqual(at(), ['#factories', 'factories']);
  await forward();
  assert.deepEqual(at(), ['#resources', 'resources'], 'the address asked for is the next entry');
  assert.equal(asked.length, 1);
});

// The step back brings a hashchange of its own, which the app passes over: no redraw, no scroll
// to the top (#925) and no focus moved (#917); the question's Cancel puts focus back.
test('the step back moves neither the scroll position nor the focus (#925, #917)', async () => {
  await tickWire();
  const scrolledTop = vi.spyOn(window, 'scrollTo');
  wire()!.focus();
  const asked = answerConfirms(false);
  await back();
  assert.equal(asked.length, 1);
  assert.deepEqual(at(), ['#factories', 'factories']);
  assert.equal(scrolledTop.mock.calls.length, 0, 'the page is not scrolled to the top');
  assert.equal(document.activeElement, wire(), 'focus is back on the box it was on');
});

// An entry an earlier release made has no place in its state. Without the Navigation API (here,
// and in browsers that lack it) the app takes it for a new address: it steps back past it to the
// entry before, asks again there, and steps back to the page on screen by that entry's place. No
// error and no endless loop; nothing is lost and the history is as it was. With the Navigation
// API (the real-browser check) every entry has its index, and the question comes once.
test('an entry without a place, reached by Back, ends on the page on screen as well', async () => {
  await back();
  history.replaceState(null, '');
  await forward();
  assert.deepEqual(at(), ['#factories', 'factories']);
  await tickWire();
  const length = history.length;
  const asked = answerConfirms(false);
  await back();
  assert.deepEqual(at(), ['#factories', 'factories'], 'the page and its address stay');
  assert.equal(asked.length, 2, 'asked again from the entry before it');
  assert.equal(history.length, length);
  discard()!.click();
  await settle();
  await back();
  assert.deepEqual(at(), ['#notes', 'notes'], 'the entry is still there');
  await back();
  assert.deepEqual(at(), ['#backup', 'backup']);
});

describe('history places (history-place.ts)', () => {
  const navigation = (index: unknown) =>
    vi.stubGlobal('navigation', { currentEntry: index === null ? null : { index } });
  // Each test changes the place of the entry on screen: put it back.
  let kept: unknown;
  beforeEach(() => void (kept = history.state));
  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(kept, '');
  });

  test('the Navigation API’s entry index wins, else the place written in the entry', () => {
    placeEntry(7);
    assert.equal(entryPlace(), 7, 'written in the entry, which a reload keeps');
    navigation(3);
    assert.equal(entryPlace(), 3);
    for (const unusable of [-1, '3', undefined, null]) {
      navigation(unusable);
      assert.equal(entryPlace(), 7, `index ${String(unusable)}: the written place`);
    }
  });

  test('an entry without a place, or with a malformed one, has none', () => {
    for (const entryState of [null, 'text', 4, {}, { plannerEntry: '2' }, { plannerEntry: 1.5 }]) {
      history.replaceState(entryState, '');
      assert.equal(entryPlace(), undefined, JSON.stringify(entryState));
    }
  });

  test('the app starts on an entry’s own place (a reload), else writes 0, keeping other state', () => {
    history.replaceState({ plannerEntry: 4 }, '');
    assert.equal(startPlace(), 4);
    history.replaceState({ other: 'kept' }, '');
    assert.equal(startPlace(), 0);
    assert.deepEqual(history.state, { other: 'kept', plannerEntry: 0 });
  });
});
