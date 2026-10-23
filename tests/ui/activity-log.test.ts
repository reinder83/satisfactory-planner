// Co-op slice 5 (#1214): the Backup page's "Co-op progress" lists the recent ticks of the open
// profile, newest first ("Anna ticked <step>, Oct 21, 2:05 PM"), from the records the ticks carry
// (#1206), with a person filter once two names are in it, 50 at a time, and a link per entry that
// opens its step in the build plan, drawn whatever the plan's filters would hide. "Your name" sits
// there too, so it can be set before any factory has an owner; it is the same preference as the
// "Mine only" bar's (app/mine.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { ME_KEY, meName, reloadMine, setMeName } from '../../public/app/mine.ts';
import { phase, setHideDone, setView, state, view } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { jumpTarget } from '../../public/app/step-jump.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { tickedAt } from '../../public/app/ticked-by.ts';
import { $, $$, applyUpdate, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type { ProgressState, TickRecord, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const entries = () => $$('[data-activity-entry]');
const record = (minute: number, by?: string): TickRecord => ({
  at: new Date(Date.UTC(2026, 9, 21, 12, minute)).toISOString(),
  ...(by ? { by } : {}),
});

let phase2: string[];
let phase3: string[];
async function backup(progress: Partial<ProgressState> = {}) {
  open({ calculated: generated(), phase: '3', state: { version: 21, ...progress } });
  go('backup');
  render();
  await nextTick();
}

beforeEach(async () => {
  page();
  setMeName('');
  setHideDone(false);
  open({ calculated: generated(), phase: '3' });
  phase2 = planTasks('2').map(step => step.id);
  phase3 = planTasks('3').map(step => step.id);
  assert.ok(phase2.length >= 1 && phase3.length >= 3);
});
afterEach(() => {
  setMeName('');
  reloadMine();
  setHideDone(false);
});

test('the log lists the recorded ticks newest first, and links each to its step', async () => {
  const [a, b, c, d] = [phase3[0]!, phase3[1]!, phase3[2]!, phase2[0]!];
  await backup({
    checks: { [a]: true, [b]: true, [c]: true, [d]: true, 'calc-9-gone': true },
    tickedBy: {
      [a]: record(5, 'Anna'),
      [b]: record(30, evil.slice(0, 40)),
      [c]: record(10),
      [d]: record(20, 'Bram'),
      // A step the plan no longer lists is left out.
      'calc-9-gone': record(59, 'Anna'),
    },
  });
  const list = entries();
  assert.deepEqual(
    list.map(entry => entry.querySelector('a')!.dataset.activityStep),
    [b, d, c, a],
  );
  const title = (id: string) => planTasks(id === d ? '2' : '3').find(step => step.id === id)!.title;
  assert.equal(text(list[3]), `Anna ticked ${title(a)}, ${tickedAt(record(5).at)} · Phase 3`);
  assert.equal(text(list[1]), `Bram ticked ${title(d)}, ${tickedAt(record(20).at)} · Phase 2`);
  assert.equal(text(list[2]), `Ticked ${title(c)}, ${tickedAt(record(10).at)} · Phase 3`);
  assert.equal($('x-evil'), null, 'a hostile name stays text');
  assert.equal(text(list[3]!.querySelector('a')), title(a), 'the link is named by the step');
  // ADA restates the log, among the page's remarks.
  const remarks = Array.from({ length: 30 }, (_, i) => {
    setAdaIndex(i);
    return adaCurrent()?.text || '';
  });
  assert.ok(
    remarks.some(
      line =>
        line.startsWith('The log lists 4 ticks by ') &&
        line.includes('“Anna”') &&
        line.includes('“Bram”'),
    ),
    'ADA names the log',
  );
});

test('a person filter shows once two names are in the log', async () => {
  const [a, b, c] = [phase3[0]!, phase3[1]!, phase3[2]!];
  await backup({
    checks: { [a]: true, [b]: true },
    tickedBy: { [a]: record(5, 'Anna'), [b]: record(6) },
  });
  assert.equal($('[data-activity-person]'), null, 'one name: nothing to filter');
  await backup({
    checks: { [a]: true, [b]: true, [c]: true },
    tickedBy: { [a]: record(5, 'Anna'), [b]: record(6, 'bram'), [c]: record(7, 'anna') },
  });
  const select = $<HTMLSelectElement>('[data-activity-person]')!;
  assert.deepEqual(
    [...select.options].map(option => option.textContent),
    ['Everyone', 'anna', 'bram'],
  );
  select.value = 'anna';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  assert.deepEqual(
    entries().map(entry => entry.querySelector('a')!.dataset.activityStep),
    [c, a],
  );
  select.value = '';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  assert.equal(entries().length, 3);
});

test('the log shows 50 ticks, and Show more the next ones', async () => {
  // Each step once (a milestone can be listed in more than one phase's plan), without the biomass
  // start-up steps, which leave the plan once a power unlock is ticked.
  const ids = [
    ...new Set((['3', '4', '5'] as const).flatMap(shown => planTasks(shown).map(step => step.id))),
  ]
    .filter(id => !id.startsWith('startup-'))
    .slice(0, 60);
  assert.equal(ids.length, 60, 'the plan has 60 steps to tick');
  await backup({
    checks: Object.fromEntries(ids.map(id => [id, true])),
    tickedBy: Object.fromEntries(ids.map((id, i) => [id, record(i % 60, 'Anna')])),
  });
  assert.equal(entries().length, 50);
  const more = $<HTMLButtonElement>('[data-activity-more]')!;
  assert.equal(text(more), 'Show more (50 of 60)');
  more.focus();
  more.click();
  await settle();
  assert.equal(entries().length, 60);
  assert.equal($('[data-activity-more]'), null);
  assert.equal(document.activeElement, entries()[50]!.querySelector('a'), 'focus on the first new');
});

test('without records the log says so', async () => {
  await backup({ checks: { [phase3[0]!]: true } });
  assert.equal(entries().length, 0);
  assert.match(text($('[data-activity-empty]')), /^No ticks recorded yet\./);
});

test('an entry opens its step in the build plan, whatever Hide completed hides', async () => {
  const target = phase2[0]!;
  setHideDone(true);
  await backup({ checks: { [target]: true }, tickedBy: { [target]: record(5, 'Anna') } });
  assert.equal(phase(), '3');
  $<HTMLAnchorElement>(`[data-activity-step="${CSS.escape(target)}"]`)!.click();
  await settle();
  assert.equal(view, 'plan');
  assert.equal(location.hash, '#plan');
  assert.equal(phase(), '2', 'the step’s phase is shown');
  assert.equal(state.settings.phase, '3', 'and not saved');
  // navigate() changed the hash; the app's hashchange listener draws the page.
  setView('plan');
  render();
  await settle();
  const box = $<HTMLInputElement>(`#main input[data-check="${CSS.escape(target)}"]`);
  assert.ok(box, 'the ticked step is drawn although Hide completed is on');
  assert.equal(box.checked, true);
  assert.equal(box.closest<HTMLDetailsElement>('details.done-group')?.open, true);
  assert.ok(box.closest('.task')!.classList.contains('is-jumped'));
  assert.equal(document.activeElement, box);
  // Leaving the build plan drops it.
  go('backup');
  render();
  await settle();
  assert.equal(jumpTarget(), '');
});

test('“Your name” can be set in Co-op progress before any factory has an owner', async () => {
  await backup();
  assert.equal($('[data-mine-bar]'), null, 'no factory has an owner');
  const name = $<HTMLInputElement>('[data-coop-progress] [data-me-name]')!;
  assert.match(text($('[data-coop-name-note]')), /^Your ticks record this name\./);
  assert.equal(name.getAttribute('aria-describedby'), 'coop-name-note');
  name.value = ' Anna ';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(localStorage.getItem(ME_KEY), 'Anna');
  assert.equal(meName(), 'Anna');
  assert.equal(name.value, 'Anna');
  // A tick from now on records it, and the log lists it.
  const updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  go('plan');
  render();
  await settle();
  const box = $<HTMLInputElement>(`#main input[data-check="${CSS.escape(phase3[0]!)}"]`)!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const sent = updates.filter(([path]) => path === '/api/update').at(-1)![1];
  assert.equal((sent as Extract<UpdateOp, { type: 'check' }>).ticked?.by, 'Anna');
  go('backup');
  render();
  await settle();
  const [entry] = entries();
  assert.match(text(entry), /^Anna ticked /);
  assert.equal(state.tickedBy?.[phase3[0]!]?.by, 'Anna');
  // A blank name forgets it.
  const field = $<HTMLInputElement>('[data-coop-progress] [data-me-name]')!;
  field.value = '  ';
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(localStorage.getItem(ME_KEY), null);
});
