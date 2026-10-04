// Leaving a factory group's flow page (#factories/<group>/flow, #894) for the factories page
// returns focus to that group's "Build order →" (#917), as closing the build-order dialog it
// replaced (#895) did: by the page's "← Factories" and by the browser's Back, with the link
// brought into view after the route change's scroll to the top. Without that link (a group
// that is gone) the factories page's heading takes focus, as for any other page change
// (#304), and focus still on the page, such as a sidebar link, stays where it is.
// The hashchange listener is the app's own (listeners.ts). The focused element is compared by
// what identifies it, never two elements with assert.equal (#287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { flowRoute, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const focused = () => document.activeElement as HTMLElement | null;
const describeFocus = () => focused()?.outerHTML.slice(0, 120) ?? 'null';
const flowLink = (groupId: string) => $(`#main [data-group-flow="${groupId}"]`);
// Follows a route the way a link or Back does: the address changes and the app's hashchange
// listener draws the page.
async function follow(hash: string) {
  location.hash = hash;
  await settle();
}

// The scrolls asked for since the test began, in order: 'top' for the window's scroll to the
// top, else the element scrolled into view. happy-dom lays nothing out, so neither moves.
let scrolls: ('top' | Element)[] = [];

beforeAll(async () => {
  page();
  // The hashchange listener is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
});

beforeEach(async () => {
  page();
  setQuery('');
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  history.replaceState(null, '', '#factories');
  go('factories');
  render();
  await settle();
  scrolls = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => void scrolls.push('top'));
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
    this: HTMLElement,
  ) {
    scrolls.push(this);
  });
});
afterEach(() => vi.restoreAllMocks());

// A group well down the page, with more than one factory, so it has "Build order →".
const target = () => {
  const ids = [...document.querySelectorAll<HTMLElement>('#main [data-group-flow]')].map(
    link => link.dataset.groupFlow!,
  );
  assert.ok(ids.length > 2, 'the default groups have build-order links: ' + ids.join(', '));
  return ids[2]!;
};

// Opens group `id`'s flow page from its "Build order →", as Enter on the focused link does.
async function openFlow(id: string) {
  flowLink(id)!.focus();
  await follow(flowRoute(id));
  assert.ok($('[data-gf-back]'), 'the flow page is shown');
}

// Focus is on group `id`'s "Build order →", brought into view after the scroll to the top.
function onFlowLink(id: string, how: string) {
  assert.equal(focused()?.dataset.groupFlow, id, how + ': ' + describeFocus());
  const link = flowLink(id)!;
  const last = scrolls.lastIndexOf(link);
  assert.ok(last >= 0, how + ': the link is scrolled into view');
  assert.ok(
    last > scrolls.lastIndexOf('top'),
    how + ': after the page’s scroll to the top, not undone by it',
  );
}

test('"← Factories" on a group’s flow page puts focus back on that group’s "Build order →"', async () => {
  const id = target();
  await openFlow(id);
  assert.equal(focused(), $('#main h1'), 'the flow page’s heading takes focus');
  $('[data-gf-back]')!.focus();
  await follow('factories');
  assert.ok($('#main [data-group-flow]'), 'the factories page is shown');
  onFlowLink(id, '← Factories');
});

test('the browser’s Back from a group’s flow page also returns focus to its "Build order →"', async () => {
  const id = target();
  await openFlow(id);
  // Back leaves focus wherever it was on the flow page: its heading here, which goes with it.
  history.back();
  await settle();
  assert.equal(location.hash, '#factories');
  onFlowLink(id, 'Back');
  // And with focus nowhere (on <body>) when Back is pressed.
  await openFlow(id);
  focused()?.blur();
  history.back();
  await settle();
  onFlowLink(id, 'Back with focus on <body>');
});

test('back from the flow page of a group that is gone, the factories page’s heading takes focus', async () => {
  await follow(flowRoute('fg-gone'));
  assert.ok($('[data-gf-missing]'), 'the flow page says there is no such group');
  $('[data-gf-back]')!.focus();
  await follow('factories');
  assert.equal(focused(), $('#main h1'), describeFocus());
  assert.equal($('#main h1')?.textContent, 'Factories');
});

test('a sidebar link followed from the flow page keeps focus, as it always has', async () => {
  const id = target();
  await openFlow(id);
  const sidebar = [...document.querySelectorAll<HTMLAnchorElement>('a[href="#factories"]')].find(
    link => !link.closest('#main'),
  );
  assert.ok(sidebar, 'the sidebar links to the factories page');
  sidebar.focus();
  await follow('factories');
  assert.equal(focused(), sidebar, describeFocus());
});

test('leaving the factories page for another page still focuses that page’s heading', async () => {
  const id = target();
  await openFlow(id);
  $('[data-gf-back]')!.focus();
  await follow('factories');
  onFlowLink(id, '← Factories');
  // From the factories page, a link inside it goes with the page: the plan's heading.
  await follow('plan');
  assert.equal(focused(), $('#main h1'), describeFocus());
});
