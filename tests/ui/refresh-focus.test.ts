// Coming back to a tab reloads changes saved elsewhere (the visibilitychange listener in
// public/app/listeners.ts, refreshState in api.ts, #165). When that redraw takes away the control
// that had focus, such as a build-plan step another tab ticked meanwhile, which moves to
// "Done (n)", focus goes to the page's heading instead of falling to <body> (#809), as it does
// after a refused write (#722). Focus on a control the redraw keeps stays where it is.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeAll, beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, go, openMigrated, page, stubFetch } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// The step at `index` among the unfinished ones (0 is the lead).
const openStep = (index: number) =>
  $<HTMLInputElement>(`#main [data-open-steps] > .task:nth-child(${index + 1}) input[data-check]`)!;
// Another tab ticks `key`: the saved state /api/state answers from now on.
const tickedElsewhere = (key: string) => {
  const next = applyUpdate({ type: 'check', key, value: true });
  next.revision = (state.revision ?? 0) + 1;
  stubFetch({ '/api/state': next });
};
const comeBack = () => document.dispatchEvent(new Event('visibilitychange'));

beforeAll(async () => {
  page();
  openMigrated();
  // The listener is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
});

beforeEach(async () => {
  page();
  openMigrated();
  go('plan');
  render();
  await nextTick();
});

test('a step ticked in another tab moves away on coming back, and focus goes to the heading', async () => {
  const lead = openStep(0);
  lead.focus();
  tickedElsewhere(lead.dataset.check!);
  comeBack();
  await settle();
  assert.equal(state.checks[lead.dataset.check!], true, 'the change made elsewhere is shown');
  assert.equal(lead.isConnected, false, 'the step moved to Done');
  assert.equal(document.activeElement, $('#main h1'));
});

test('focus stays on a step the refresh keeps', async () => {
  const lead = openStep(0);
  lead.focus();
  tickedElsewhere(openStep(2).dataset.check!);
  comeBack();
  await settle();
  assert.equal(lead.isConnected, true);
  assert.equal(document.activeElement, lead);
});

test('focus that was nowhere stays nowhere', async () => {
  (document.activeElement as HTMLElement | null)?.blur();
  tickedElsewhere(openStep(0).dataset.check!);
  comeBack();
  await settle();
  assert.equal(document.activeElement, document.body);
});
