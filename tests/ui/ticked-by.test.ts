// Co-op slice 3 (#1206): who ticked a step and when. A ticked build-plan step (and a storage
// step) says it quietly under its title, "Ticked by Anna, 21 Oct", from the record `tickedBy`
// keeps for its check key; a tick made before the records has none and says nothing. Every tick the
// page saves carries this device's "Your name" (app/mine.ts) and the time (save() in api.ts):
// a step's own checkbox, a factory's "Mark all running" and an unlock group's tick, the bulk ones
// the same record for each step. Unticking sends no record and the step's words go. The co-op
// merge sends the file's records, never this device's.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { setExpertMode } from '../../public/app/expert.ts';
import { reloadMine, setMeName } from '../../public/app/mine.ts';
import { TICKS_FORMAT } from '../../public/app/progress-merge.ts';
import {
  setFactoryEditing,
  setFactoryFilter,
  setHideDone,
  setQuery,
  setRequiredOnly,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { tickedWords } from '../../public/app/ticked-by.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  evil,
  generated,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { TickRecord, UpdateOp } from '../../public/types/index.ts';

const ANNA: TickRecord = { at: '2026-10-21T12:15:00.000Z', by: 'Anna' };
const HOSTILE: TickRecord = { at: '2026-10-20T12:00:00.000Z', by: evil.slice(0, 40) };
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (id: string) => $(`#main [data-task="${CSS.escape(id)}"] [data-step-ticked-by]`);
const box = (id: string) => $<HTMLInputElement>(`#main input[data-check="${CSS.escape(id)}"]`)!;
async function click(input: HTMLInputElement) {
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

let updates: [string, UpdateOp][];
const sent = () => updates.filter(([path]) => path === '/api/update').map(([, body]) => body);
async function show(view: 'plan' | 'factories', progress: object = {}) {
  open({ calculated: generated(), phase: '3', state: { version: 21, ...progress } });
  go(view);
  render();
  await nextTick();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
}

beforeEach(() => {
  page();
  setMeName('');
  setQuery('');
  setHideDone(false);
  setRequiredOnly(false);
  setFactoryFilter('all');
  setFactoryEditing(false);
  setExpertMode(false);
});
afterEach(() => {
  setMeName('');
  reloadMine();
  setExpertMode(false);
});

test('a ticked step says who ticked it and when; a tick from before says nothing', async () => {
  await show('plan');
  const [a, b, c, d] = planTasks().map(step => step.id);
  assert.ok(a && b && c && d);
  await show('plan', {
    checks: { [a]: true, [b]: true, [c]: false, [d]: true },
    // c's record is stale (its step is unticked); b was ticked before the records were kept.
    tickedBy: { [a]: ANNA, [c]: ANNA, [d]: HOSTILE },
  });
  assert.equal(text(note(a)), tickedWords(ANNA));
  assert.match(text(note(a)), /^Ticked by Anna, /);
  assert.equal(note(b), null, 'a tick from before has no record');
  assert.equal(note(c), null, 'an unticked step says nothing');
  assert.equal(text(note(d)), tickedWords(HOSTILE));
  assert.equal($('x-evil'), null, 'a hostile name stays text');
  // It sits in the step's summary, beside the title of a done step.
  assert.ok(note(a)!.closest('summary'));
});

test('ticking a step records this device’s name and the time; unticking drops it', async () => {
  setMeName(' Anna ');
  await show('plan');
  const first = planTasks()[0]!.id;
  await click(box(first));
  const update = sent().at(-1) as Extract<UpdateOp, { type: 'check' }>;
  assert.equal(update.value, true);
  assert.equal(update.ticked?.by, 'Anna');
  assert.ok(Math.abs(Date.parse(update.ticked!.at) - Date.now()) < 60000);
  assert.deepEqual(state.tickedBy?.[first], update.ticked);
  assert.equal(state.version, 21);
  assert.equal(text(note(first)), tickedWords(update.ticked!));
  // Unticked: no record is sent, the stored one goes and so do the words.
  await click(box(first));
  assert.deepEqual(sent().at(-1), { type: 'check', key: first, value: false });
  assert.equal(state.tickedBy, undefined);
  assert.equal(note(first), null);
  // Without a name the tick still says when.
  setMeName('');
  await click(box(first));
  const nameless = (sent().at(-1) as Extract<UpdateOp, { type: 'check' }>).ticked!;
  assert.equal('by' in nameless, false);
  assert.match(text(note(first)), /^Ticked \d|^Ticked [A-Z]/);
});

test('Mark all running records the same who and when for each line it ticks', async () => {
  setMeName('Bram');
  const plan = generated();
  const ids = plan.stages['3']!.rows!.slice(0, 3).map(row => row.id);
  const key = (id: string) => 'calc-3-' + id;
  open({
    calculated: plan,
    phase: '3',
    state: {
      version: 21,
      checks: { [key(ids[0]!)]: true },
      tickedBy: { [key(ids[0]!)]: ANNA },
      factoryGroups: {
        groups: [{ id: 'fg-alpha', name: 'Alpha' }],
        assignments: Object.fromEntries(ids.map(id => [id, [{ group: 'fg-alpha', rate: null }]])),
      },
    },
  });
  go('factories');
  render();
  await nextTick();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  $<HTMLButtonElement>('#main [data-group-running="fg-alpha"]')!.click();
  await settle();
  const update = sent().at(-1) as Extract<UpdateOp, { type: 'checks' }>;
  assert.deepEqual(update.keys, [key(ids[1]!), key(ids[2]!)]);
  assert.equal(update.ticked?.by, 'Bram');
  assert.deepEqual(state.tickedBy, {
    [key(ids[0]!)]: ANNA,
    [key(ids[1]!)]: update.ticked,
    [key(ids[2]!)]: update.ticked,
  });
});

test('an unlock group’s tick records the same who and when for each unlock', async () => {
  setMeName('Bram');
  setExpertMode(true);
  await show('plan');
  const group = $<HTMLInputElement>('#main [data-unlock-group-tick]');
  assert.ok(group, 'the plan has a tier of unlocks');
  await click(group);
  const update = sent().at(-1) as Extract<UpdateOp, { type: 'checks' }>;
  assert.equal(update.value, true);
  assert.equal(update.ticked?.by, 'Bram');
  for (const id of update.keys) assert.deepEqual(state.tickedBy?.[id], update.ticked, id);
});

test('a storage step says who ticked it too', async () => {
  const storage = async (progress: object) => {
    open({ calculated: generated(), phase: '3', state: { version: 21, ...progress } });
    go('storage');
    render();
    await nextTick();
  };
  await storage({});
  const id = $<HTMLInputElement>('#main .checklist input[data-check]')!.dataset.check!;
  await storage({ checks: { [id]: true }, tickedBy: { [id]: ANNA } });
  assert.equal(text(note(id)), tickedWords(ANNA));
});

test('the merge sends the file’s records of who ticked, never this device’s', async () => {
  setMeName('Bram');
  open({ calculated: generated(), phase: '1' });
  const steps = planTasks().map(step => step.id);
  go('backup');
  render();
  await nextTick();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  answerConfirms(true);
  const input = $<HTMLInputElement>('#merge-progress')!;
  const file = {
    format: TICKS_FORMAT,
    version: 1,
    exportedAt: '2026-10-21T13:00:00.000Z',
    saveName: 'Coop world',
    profileName: 'Anna',
    ticks: [steps[0], steps[1]],
    tickedBy: { [steps[0]!]: ANNA },
  };
  Object.defineProperty(input, 'files', {
    value: [new File([JSON.stringify(file)], 'anna.json')],
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => assert.match($('#toast')!.textContent || '', /^Merged/));
  assert.deepEqual(sent(), [
    { type: 'checks', keys: [steps[0], steps[1]], value: true, tickedBy: { [steps[0]!]: ANNA } },
  ]);
  assert.deepEqual(state.tickedBy, { [steps[0]!]: ANNA });
  assert.equal(state.checks[steps[1]!], true, 'ticked, without a record');
  assert.equal($$('x-evil').length, 0);
});
