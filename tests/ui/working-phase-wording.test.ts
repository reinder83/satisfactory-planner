// The phase picker names the working phase as the notices below it do (#992). It always shows the
// phase on screen; picking one only shows it, and "Work on Phase N" saves it as the working phase
// (#1053). While that is the working phase its label is "Working on"; while the tab shows another
// (one picked, or the phase a profile opened on, #570, a milestone-only phase included, #759) it
// is "Showing". Both the select and the phase track are named after the working phase, as "You
// are working on Phase 3" is, and the track marks its segment for screen readers. Before #1053
// they were named "Working phase" with the working phase shown, and its segment was not marked.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { phase, setOpenedPhase, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { Phase } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';

beforeEach(() => {
  page();
  setQuery('');
});

// What the top bar says about the phase on screen.
const picker = () => ({
  label: text($('[data-phase-picker-label]')),
  selectName: $('#phase-picker')!.getAttribute('aria-label'),
  trackName: $('[data-phase-track]')!.getAttribute('aria-label'),
  value: $<HTMLSelectElement>('#phase-picker')!.value,
  // The track segment marked as the working phase for screen readers, if any.
  marked: $('[data-working-phase]')?.closest('[data-phase-seg]')?.getAttribute('data-phase-seg'),
});

// A Phase 3 profile (the planner's default), saved on `saved`, showing `shown`.
async function show(saved: Phase, shown: Phase) {
  open({ calculated: generated(), phase: saved });
  if (shown !== saved) setOpenedPhase({ saved, phase: shown });
  go('plan');
  render();
  await settle();
}

test('the picker says "Working on" while the working phase is shown', async () => {
  await show('3', '3');
  assert.deepEqual(picker(), {
    label: 'Working on',
    selectName: 'Showing phase, working on Phase 3',
    trackName: 'Showing phase, working on Phase 3',
    value: '3',
    marked: '3',
  });
  assert.equal($('[data-work-on-phase]'), null, 'nothing to save');
});

test('on a milestone-only phase the profile opened on, the picker says "Showing" and names the working phase', async () => {
  await show('3', '1');
  assert.equal(phase(), '1');
  assert.deepEqual(picker(), {
    label: 'Showing',
    selectName: 'Showing phase, working on Phase 3',
    trackName: 'Showing phase, working on Phase 3',
    value: '1',
    marked: '3',
  });
  assert.equal(text($('[data-phase-seg="3"] [data-working-phase]')), ', working phase');
  // The notice below names the same phase as the one worked on.
  assert.match(text($('[data-milestone-only]')), /^You are working on Phase 3\./);
});

test('on an earlier planned phase the profile opened on, the picker names the saved phase', async () => {
  await show('4', '3');
  assert.deepEqual(picker(), {
    label: 'Showing',
    selectName: 'Showing phase, working on Phase 4',
    trackName: 'Showing phase, working on Phase 4',
    value: '3',
    marked: '4',
  });
  assert.match(text($('[data-opened-earlier]')), /You are working on Phase 4\./);
});

test('picking a phase only shows it; "Work on Phase 2" saves it, and the picker says "Working on" again', async () => {
  await show('3', '1');
  const calls = stubFetch<{ type: string; value: string }>({ '/api/update': applyUpdate });
  const select = $<HTMLSelectElement>('#phase-picker')!;
  select.value = '2';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(calls, [], 'picking only shows the phase');
  assert.equal(phase(), '2');
  assert.equal(picker().label, 'Showing');
  const work = $<HTMLButtonElement>('[data-work-on-phase]')!;
  assert.equal(text(work), 'Work on Phase 2');
  work.click();
  await settle();
  await settle();
  assert.deepEqual(calls.at(-1), ['/api/update', { type: 'phase', value: '2' }]);
  assert.equal(state.settings.phase, '2', 'saved as the working phase');
  assert.deepEqual(picker(), {
    label: 'Working on',
    selectName: 'Showing phase, working on Phase 2',
    trackName: 'Showing phase, working on Phase 2',
    value: '2',
    marked: '2',
  });
  assert.equal($('[data-work-on-phase]'), null);
});

test('the Notes page calls the shown phase "Showing" and the working phase "Working on"', async () => {
  await show('3', '1');
  go('notes');
  render();
  await settle();
  assert.match(text($('[data-phase-notes="1"] summary')), /Phase 1 · Showing/);
  assert.match(text($('[data-phase-notes="3"] summary')), /Phase 3 · Working on/);
  await show('3', '3');
  go('notes');
  render();
  await settle();
  assert.match(text($('[data-phase-notes="3"] summary')), /Phase 3 · Working on/);
  assert.match(text($('[data-phase-notes="1"] summary')), /Phase 1 · Empty/);
});
