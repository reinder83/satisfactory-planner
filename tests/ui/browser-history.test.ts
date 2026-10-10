// The component tests see a browser's history (#991, tests/ui/browser-history.ts): happy-dom
// fires a hashchange when history.replaceState() or pushState() changes the hash, which browsers
// never do, so those events are dropped; a link, a typed address and Back still fire one.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { followInPlace } from './setup.ts';

let heard: string[] = [];
const hear = (event: HashChangeEvent) =>
  heard.push(`${new URL(event.oldURL).hash} ${new URL(event.newURL).hash}`);
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(async () => {
  history.replaceState(null, '', '#start');
  await settle();
  heard = [];
  window.addEventListener('hashchange', hear);
});
afterEach(() => window.removeEventListener('hashchange', hear));

test('replaceState and pushState change the address without a hashchange', async () => {
  history.replaceState(null, '', '#plan');
  history.replaceState({ kept: 1 }, '', '#factories/fg-a/flow?phase=3');
  history.pushState(null, '', '#notes');
  await settle();
  assert.equal(location.hash, '#notes');
  assert.deepEqual(heard, []);
});

test('a link, a typed address and Back still fire their hashchange', async () => {
  location.hash = 'storage';
  await settle();
  followInPlace('#backup');
  await settle();
  history.back();
  await settle();
  assert.deepEqual(heard, ['#start #storage', '#storage #backup', '#backup #start']);
});

test('a replaceState in the same moment as a link drops only its own hashchange', async () => {
  // A link, and the address rewritten before its hashchange arrives (as render() does).
  location.hash = 'factories/fg-a/flow';
  history.replaceState(null, '', '#factories/fg-a/flow?phase=3');
  await settle();
  assert.deepEqual(heard, ['#start #factories/fg-a/flow']);
  assert.equal(location.hash, '#factories/fg-a/flow?phase=3');
});

test('a replaceState that leaves the hash as it is drops nothing that comes later', async () => {
  history.replaceState({ place: 1 }, '');
  history.replaceState(null, '', '#start');
  followInPlace('#plan');
  await settle();
  assert.deepEqual(heard, ['#start #plan']);
});
