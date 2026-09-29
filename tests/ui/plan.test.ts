// The build plan on both profile kinds (public/app/ui/pages/PlanPage.vue and
// CalculatedPlanPage.vue, with their parts in public/app/ui/plan/), mounted through render()
// the way the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import {
  editingTask,
  planEditing,
  setHideDone,
  setQuery,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { headroomAdvice } from '../../public/app/views/calculated.ts';
import {
  answerConfirms,
  applyUpdate,
  $,
  $$,
  evil,
  generated as makeGenerated,
  go,
  handbook,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type {
  CalcRow,
  HandbookDelivery,
  StoredCalculatedPlan,
  StoredStage,
  TaskEdits,
  UpdateOp,
} from '../../public/types/index.ts';

const generated = makeGenerated();

const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
// Lets a save() round trip and the redraw after it finish.
const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};
const steps = () => $$('#main .checklist [data-check]').map(e => e.dataset.check);
const kindOf = (title: string) =>
  $$('#main .checklist .task')
    .find(t => t.querySelector('summary')!.textContent.includes(title))
    ?.querySelector<HTMLElement>('.task-icon')!.dataset.kind;

beforeEach(() => {
  page();
  open();
  setQuery('');
  setHideDone(false);
  answerConfirms(true);
  go('plan');
});

test('the handbook plan shows the phase checklist, counters, notes link and deliveries', () => {
  open({ notes: { 'phase-3': evil + '\n  second line' } });
  render();
  noMarkup();
  assert.equal($('#main h1')!.textContent, 'Phase 3 field plan');
  assert.equal($$('#main .checklist .task').length, 9);
  // SP-43: one progress indicator, the bar with "n of total done"; the tiles are one line.
  assert.equal($('[data-plan-progress]')!.textContent, '0 of 9 done');
  assert.equal($('#main .stat'), null, 'no summary tiles');
  // The phase notes moved to the Notes page (#243): the plan keeps a one-line link there.
  assert.equal($$('#main textarea').length, 0, 'no notes editor on the plan');
  assert.equal($('[data-phase-notes-link]')!.getAttribute('href'), '#notes');
  assert.equal($('[data-phase-notes-link]')!.textContent, 'Phase notes →');
  // SP-42: the next step leads the checklist; the side column no longer repeats it.
  assert.equal($('#main .task.lead .step-no')!.textContent, 'Next step');
  assert.equal($('.next-card'), null);
  const deliveries = handbookDeliveries('3');
  assert.equal($$('#main [data-delivery]').length, deliveries.length);
  assert.equal(
    $<HTMLInputElement>(`#delivery-${deliveries[0]!.id}`)!.value,
    String(deliveries[0]!.initial),
    'the original profile starts from the handbook counts',
  );
});

// SP-43 (#278): progress shows once, as the bar with "n of total done"; the four tiles became
// one summary line whose parts link to their pages.
test('the plan shows one progress bar and a summary line linking to each page (SP-43)', () => {
  const summary = () =>
    $$('#main [data-plan-summary] li').map(li => [
      li.dataset.summary,
      li.querySelector('a')?.getAttribute('href') ?? null,
      li.textContent!.trim(),
    ]);
  state.checks['phase-3-survey'] = true;
  state.checks['factory-3-wire'] = true;
  render();
  const bar = $('#main .plan-progress [role=progressbar]')!;
  assert.equal(bar.getAttribute('aria-valuenow'), '1');
  assert.equal(bar.getAttribute('aria-valuemax'), '9');
  assert.equal(bar.getAttribute('aria-valuetext'), '1 of 9 steps done');
  assert.equal(bar.querySelector('span')!.style.width, '11%');
  // (The side column's delivery counters keep their own bars.)
  assert.equal($$('#main .split > section .progress-track').length, 1, 'one checklist bar');
  assert.ok(!$('#main')!.textContent!.includes('% complete'), 'no percentage beside it');
  const s = summary();
  assert.deepEqual(
    s.map(([key, href]) => [key, href]),
    [
      ['factories', '#factories'],
      ['storage', '#storage'],
      ['power', '#resources'],
    ],
  );
  assert.match(s[0]![2]!, /^1 of \d+ factories running$/);
  assert.match(s[1]![2]!, /^0 of \d+ storage positions verified$/);
  assert.match(s[2]![2]!, / GW planned power$/);
  // The calculated plan: the same bar, its lines and buildings, storage, new power and the
  // delivery time, which has no page of its own.
  open({ calculated: generated });
  render();
  assert.ok($('#main .plan-progress [role=progressbar]'));
  assert.equal($('#main .stat'), null);
  const c = summary();
  assert.deepEqual(
    c.map(([key, href]) => [key, href]),
    [
      ['factories', '#factories'],
      ['storage', '#storage'],
      ['power', '#resources'],
      ['hours', null],
    ],
  );
  assert.match(c[0]![2]!, /^0 of \d+ production lines running, [\d,.]+ buildings$/);
  assert.match(c[3]![2]!, /^Delivery in [\d,.]+ h at steady state$/);
});

test('a duplicated or imported original profile also starts from the handbook counts', () => {
  open({ profileId: 'copy-uuid' });
  render();
  for (const d of handbookDeliveries('3'))
    assert.equal($<HTMLInputElement>(`#delivery-${d.id}`)!.value, String(d.initial));
});

test('post-game reads the Phase 5 stage and swaps deliveries for its priority note', () => {
  open({ phase: 'post' });
  render();
  assert.equal($('#main h1')!.textContent, 'Post Phase 5 field plan');
  assert.equal($$('#main [data-delivery]').length, 0);
  assert.ok($$('#main .panel h2').some(h => h.textContent === 'Post-game priority'));
});

test('the checklist can be searched and can hide completed steps', async () => {
  render();
  assert.ok($('#plan-search') && $('#hide-done'));
  $<HTMLInputElement>('#plan-search')!.value = 'steel';
  $('#plan-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.deepEqual(steps(), ['phase-3-steel']);
  assert.equal($('.checklist-tools .muted')!.textContent, '1 of 9 steps');
  $<HTMLInputElement>('#plan-search')!.value = 'no-such-step';
  $('#plan-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal($('#main .empty-state')!.textContent, 'No steps match this search.');
  $<HTMLInputElement>('#plan-search')!.value = '';
  $('#plan-search')!.dispatchEvent(new Event('input'));
  state.checks['phase-3-survey'] = true;
  $<HTMLInputElement>('#hide-done')!.checked = true;
  $('#hide-done')!.dispatchEvent(new Event('change'));
  await nextTick();
  assert.ok(!steps().includes('phase-3-survey'), 'completed steps are hidden');
  assert.ok(steps().includes('phase-3-iron'), 'unfinished steps stay visible');
  assert.equal($('.checklist-tools .muted')!.textContent, '8 of 9 steps');
  assert.equal($('[data-plan-progress]')!.textContent, '1 of 9 done', 'progress counts every step');
  for (const t of planTasks()) state.checks[t.id] = true;
  render();
  await nextTick();
  assert.match($('[data-phase-complete]')!.textContent, /Phase checklist complete/);
  assert.match($('[data-phase-complete]')!.textContent, /Untick “Hide completed”/);
  assert.equal($('#main .done-group'), null, 'hidden completed steps have no Done group');
  // The toggle is view state and stays on for the calculated plan.
  open({ calculated: generated });
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('#hide-done')!.checked, true);
  // It is remembered in this browser, never in the profile.
  assert.equal(localStorage.getItem('planner-hide-done'), 'on');
  assert.equal('hideDone' in state.settings, false);
});

// SP-42 (#277): the first unfinished step leads the list, unfolded, with Mark done and its
// factory; the other unfinished steps follow, and completed ones fold into "Done (n)".
const leadId = () => $('#main [data-open-steps] > .task.lead [data-check]')?.dataset.check;
const doneIds = () => $$('#main .done-group [data-check]').map(e => e.dataset.check);
const tick = async (box: HTMLInputElement, on: boolean) => {
  box.focus();
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};

test('the first unfinished step leads the checklist, and ticking it promotes the next (SP-42)', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const ids = planTasks().map(t => t.id);
  state.checks[ids[0]!] = true;
  render();
  await nextTick();
  assert.equal(leadId(), ids[1], 'the first step not ticked leads');
  assert.equal($$('#main .task.lead').length, 1);
  assert.equal($<HTMLDetailsElement>('#main .task.lead details')!.open, true, 'unfolded');
  assert.equal(
    $$<HTMLDetailsElement>('#main [data-open-steps] > .task:not(.lead) details').filter(d => d.open)
      .length,
    0,
    'the other steps stay folded',
  );
  assert.deepEqual(doneIds(), [ids[0]]);
  assert.equal($('#main .done-group > summary')!.textContent, 'Done (1)');
  assert.equal($<HTMLDetailsElement>('#main .done-group')!.open, false, 'Done starts folded');
  assert.deepEqual(
    $$('#main [data-open-steps] [data-check]').map(e => e.dataset.check),
    ids.slice(1),
    'the unfinished steps keep the plan order',
  );
  // Mark done ticks the lead's saved key; the next step leads, and focus goes to its Mark done.
  const mark = $('#main .task.lead [data-mark-done]')!;
  assert.equal(mark.tagName, 'BUTTON');
  mark.focus();
  mark.click();
  await settle();
  assert.equal(state.checks[ids[1]!], true);
  assert.equal(leadId(), ids[2]);
  assert.deepEqual(doneIds(), [ids[0], ids[1]]);
  assert.equal($('#main .done-group > summary')!.textContent, 'Done (2)');
  assert.equal(document.activeElement, $('#main .task.lead [data-mark-done]'));
  // Its checkbox does the same, and focus goes to the next lead's checkbox.
  await tick($<HTMLInputElement>('#main .task.lead [data-check]')!, true);
  assert.equal(leadId(), ids[3]);
  assert.equal(document.activeElement, $('#main .task.lead [data-check]'));
  // Unticked under Done, a step goes back among the unfinished ones in its place, keeping focus.
  $<HTMLDetailsElement>('#main .done-group')!.open = true;
  await tick($<HTMLInputElement>(`#main .done-group [data-check="${ids[0]}"]`)!, false);
  assert.equal(leadId(), ids[0], 'the earliest unfinished step leads again');
  assert.deepEqual(doneIds(), [ids[1], ids[2]]);
  assert.equal(document.activeElement, $(`#main [data-open-steps] [data-check="${ids[0]}"]`));
});

test('the lead step offers its factory; search, Hide completed and editing still work (SP-42)', async () => {
  open({ calculated: generated });
  render();
  await nextTick();
  const ts = planTasks(),
    ids = ts.map(t => t.id);
  const linked = ts.findIndex(t => $(`#main [data-task="${t.id}"] .task-link`));
  assert.ok(linked > 0, 'a later step links a factory');
  for (const id of ids.slice(0, linked)) state.checks[id] = true;
  render();
  await nextTick();
  assert.equal(leadId(), ids[linked]);
  const link = $('#main .task.lead .task-link')!;
  assert.match(link.textContent, /^\s*Open factory: /);
  assert.ok(!link.classList.contains('quiet'), 'a full button on the lead step');
  assert.ok($('#main .task.lead [data-mark-done]'));
  // The search looks in both groups; a completed match shows under Done.
  $<HTMLInputElement>('#plan-search')!.value = ts[0]!.title;
  $('#plan-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.ok(doneIds().includes(ids[0]));
  $<HTMLInputElement>('#plan-search')!.value = '';
  $('#plan-search')!.dispatchEvent(new Event('input'));
  // Hide completed drops the Done group and keeps the lead.
  $<HTMLInputElement>('#hide-done')!.checked = true;
  $('#hide-done')!.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal($('#main .done-group'), null);
  assert.equal(leadId(), ids[linked]);
  $<HTMLInputElement>('#hide-done')!.checked = false;
  $('#hide-done')!.dispatchEvent(new Event('change'));
  // While editing, the list is flat in the plan's order, with no lead and no Done group.
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  assert.ok($('#main .task.is-editing'));
  assert.equal($('#main .task.lead'), null);
  assert.equal($('#main .done-group'), null);
  // (The calculated plan's startup steps depend on what is ticked, so the list is read again.)
  assert.deepEqual(
    steps(),
    planTasks().map(t => t.id),
  );
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
});

test('"Hide completed" survives a page refresh', async () => {
  // A refresh loads session.ts afresh, which reads the remembered toggle.
  const fresh = async () => {
    vi.resetModules();
    return (await import('../../public/app/session.ts')).hideDone;
  };
  localStorage.setItem('planner-hide-done', 'on');
  assert.equal(await fresh(), true);
  localStorage.setItem('planner-hide-done', 'off');
  assert.equal(await fresh(), false);
  localStorage.removeItem('planner-hide-done');
  assert.equal(await fresh(), false, 'off by default');
});

test('every step carries an icon for its kind of work, or the part it makes', () => {
  // Only the edits this test needs; the plan reads the other fields as absent.
  const taskEdits: Partial<TaskEdits> = { links: { 'phase-3-steel': 'wire' } };
  open({ state: { taskEdits: taskEdits as TaskEdits } });
  render();
  assert.equal($$('#main .checklist .task-icon').length, 9);
  assert.equal(kindOf('Survey the iron site'), 'survey');
  assert.equal(kindOf('Retire the temporary power plants'), 'retire');
  assert.equal(kindOf('Deliver Phase 3'), 'delivery');
  assert.equal(kindOf('Concrete, copper'), 'build');
  const linked = $('[data-check="phase-3-steel"]')!.nextElementSibling as HTMLElement;
  assert.equal(linked.dataset.kind, 'item', 'a step linked to a factory shows its part');
  assert.equal(linked.querySelector('img')!.getAttribute('src'), './icons/wire.png');
  for (const glyph of $$('#main .task-icon svg'))
    assert.ok(glyph.innerHTML.includes('<'), 'every glyph resolves');
  open({ calculated: generated, phase: '1' });
  render();
  assert.equal(kindOf('Tier '), 'milestone', 'HUB milestones read as unlocks');
  assert.equal(kindOf('Turn leaves and wood into Biomass'), 'biomass');
  assert.equal(kindOf('Power available now'), 'power');
  assert.equal(kindOf('Connect protected storage'), 'storage');
  assert.ok(
    $$('#main .task-icon img').some(i => i.getAttribute('src') === './icons/iron-ingot.png'),
    'a calculated production step shows its own part',
  );
  assert.ok(!$('#main [data-kind="undefined"]'));
});

test('edits show on the plan, and edit mode offers tools, removed steps and the form', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  open({
    state: {
      taskEdits: {
        order: {},
        removed: ['phase-3-survey'],
        titles: { 'phase-3-iron': evil },
        bodies: {},
        links: { 'phase-3-retire-power': 'wire' },
      },
      customTasks: [{ id: 'custom-1', phase: '3', title: evil }],
    },
  });
  render();
  noMarkup();
  assert.ok(!steps().includes('phase-3-survey'), 'removed steps disappear from the plan');
  assert.equal($('[data-task="phase-3-iron"] summary')!.textContent, evil);
  assert.equal(
    $('.task-link[data-factory="wire"]')!.textContent.trim(),
    'Open factory: Wire ↗',
    'linked steps offer the factory',
  );
  assert.ok($('[data-remove="custom-1"]'), 'a personal task can be deleted');
  assert.equal($('[data-move-task]'), null);
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  assert.equal(planEditing, true);
  assert.equal($('[data-toggle-plan-edit]')!.textContent.trim(), 'Done editing');
  assert.ok($('[data-move-task="phase-3-iron"][data-dir="-1"]'));
  assert.equal($('[data-remove="custom-1"]'), null, 'edit mode removes it with Remove instead');
  assert.equal($('.removed-steps summary')!.textContent, 'Removed steps in this phase (1)');
  assert.ok($('[data-restore-task="phase-3-survey"]'));
  // Edit a step: the form shows the current wording and link.
  $('[data-edit-task="phase-3-iron"]')!.click();
  await nextTick();
  assert.equal(editingTask, 'phase-3-iron');
  const form = $<HTMLFormElement>('[data-task-edit="phase-3-iron"]')!;
  assert.equal(form.querySelector<HTMLInputElement>('[name=title]')!.value, evil);
  assert.equal(form.querySelector<HTMLSelectElement>('[name=link]')!.value, '');
  noMarkup();
  form.querySelector<HTMLInputElement>('[name=title]')!.value = 'Iron halls';
  form.querySelector<HTMLSelectElement>('[name=link]')!.value = 'wire';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(calls.at(-1), [
    '/api/update',
    { type: 'taskEdit', id: 'phase-3-iron', title: 'Iron halls', body: '', link: 'wire' },
  ]);
  assert.equal(editingTask, null, 'a saved step closes its form');
  // Move, remove and restore save the matching operations.
  $('[data-move-task="phase-3-iron"][data-dir="1"]')!.click();
  await settle();
  const order = planTasks().map(t => t.id);
  const i = order.indexOf('phase-3-iron');
  [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
  // The removed survey step keeps its slot at the top for when it is restored.
  assert.deepEqual(calls.at(-1)![1], {
    type: 'taskOrder',
    phase: '3',
    ids: ['phase-3-survey', ...order],
  });
  $('[data-remove-step="phase-3-iron"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'taskRemove', id: 'phase-3-iron' });
  $('[data-remove-step="custom-1"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'removeTask', id: 'custom-1' });
  $('[data-restore-task="phase-3-survey"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'taskRestore', id: 'phase-3-survey' });
  // Moving the first step up does nothing.
  const before = calls.length;
  $(`[data-move-task="${planTasks()[0]!.id}"][data-dir="-1"]`)!.click();
  await settle();
  assert.equal(calls.length, before);
});

test('a declined confirmation removes nothing', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  answerConfirms(false);
  open({
    state: { customTasks: [{ id: 'custom-1', phase: '3', title: 'Mine' }] },
  });
  render();
  $('[data-remove="custom-1"]')!.click();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  $('[data-remove-step="phase-3-iron"]')!.click();
  await settle();
  assert.equal(calls.length, 0);
});

test('adding a personal task saves it and empties the form', async () => {
  const calls = stubFetch<Extract<UpdateOp, { type: 'addTask' }>>({ '/api/update': () => state });
  render();
  const form = $<HTMLFormElement>('#add-task')!;
  form.querySelector('input')!.value = '  ' + evil + '  ';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  const [path, op] = calls[0]!;
  assert.equal(path, '/api/update');
  assert.equal(op.type, 'addTask');
  assert.equal(op.title, evil);
  assert.equal(op.phase, '3');
  assert.match(op.id, /^custom-[0-9a-f]{32}$/);
  assert.equal(form.querySelector('input')!.value, '');
  assert.equal(form.querySelector('button')!.disabled, false);
});

test('a delivery count must be a whole number up to the target', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  render();
  const d = handbookDeliveries('3')[0]!;
  const input = $<HTMLInputElement>(`#delivery-${d.id}`)!;
  input.value = String(d.target + 1);
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(input.value, String(d.initial), 'an invalid entry shows the saved count again');
  assert.match($('#toast')!.textContent, /whole number between 0 and/);
  input.value = '7';
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls[0]![1], { type: 'delivery', key: d.id, value: 7 });
});

test('with completed steps hidden, moving a step passes the neighbour on screen', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  open({ state: { checks: { 'phase-3-iron': true } } });
  setHideDone(true);
  render();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  const before = planTasks().map(t => t.id);
  assert.deepEqual(before.slice(0, 4), [
    'phase-3-survey',
    'phase-3-retire-power',
    'phase-3-iron',
    'phase-3-construction',
  ]);
  // The hidden (ticked) iron step sits between these two; it keeps its place.
  $('[data-move-task="phase-3-retire-power"][data-dir="1"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'taskOrder',
    phase: '3',
    ids: ['phase-3-survey', 'phase-3-iron', 'phase-3-construction', 'phase-3-retire-power'].concat(
      before.slice(4),
    ),
  });
});

test('a cleared step title restores the original, and an automatic link can be removed', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  const editStep = async (id: string) => {
    $(`[data-edit-task="${id}"]`)!.click();
    await nextTick();
    return $<HTMLFormElement>(`[data-task-edit="${id}"]`)!;
  };
  const retitled: Partial<TaskEdits> = { titles: { 'phase-3-iron': 'Iron halls' } };
  open({ state: { taskEdits: retitled as TaskEdits } });
  render();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  let form = await editStep('phase-3-iron');
  const title = form.querySelector<HTMLInputElement>('[name=title]')!;
  assert.equal(title.required, false, 'the title can be cleared');
  title.value = '';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'taskEdit',
    id: 'phase-3-iron',
    title: '',
    body: '',
    link: '',
  });
  // A calculated step links to its own row; "No linked factory" is saved as '-'.
  const row = generated.stages['3'].rows![0]!,
    id = 'calc-3-' + row.id;
  open({ calculated: generated });
  render();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  form = await editStep(id);
  form.querySelector<HTMLSelectElement>('[name=link]')!.value = '';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'taskEdit', id, title: '', body: '', link: '-' });
  // Saved like that, the step has no link and the form says so.
  const unlinked: Partial<TaskEdits> = { links: { [id]: '-' } };
  open({ calculated: generated, state: { taskEdits: unlinked as TaskEdits } });
  render();
  await nextTick();
  assert.equal(!!$(`[data-task="${id}"] .task-link`), false, 'no "Open factory" link');
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  form = await editStep(id);
  assert.equal(form.querySelector<HTMLSelectElement>('[name=link]')!.value, '');
  // Choosing its own row again goes back to the automatic link.
  form.querySelector<HTMLSelectElement>('[name=link]')!.value = row.id;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'taskEdit', id, title: '', body: '', link: '' });
});

test('reordering keeps a removed step’s place, so restoring it puts it back', async () => {
  // The /api/update stand-in applies the saved order the way the server does.
  stubFetch<UpdateOp>({
    '/api/update': (op: UpdateOp) =>
      op.type === 'taskOrder'
        ? { ...state, taskEdits: { ...state.taskEdits!, order: { [op.phase]: op.ids } } }
        : state,
  });
  const removed: Partial<TaskEdits> = { removed: ['phase-3-retire-power'] };
  open({ state: { taskEdits: removed as TaskEdits } });
  render();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  const before = planTasks().map(t => t.id);
  $('[data-move-task="phase-3-steel"][data-dir="-1"]')!.click();
  await settle();
  // Restore the removed step: it is back second, where it was, not at the end.
  state.taskEdits!.removed = [];
  const ids = planTasks().map(t => t.id);
  assert.equal(ids.indexOf('phase-3-retire-power'), 1);
  assert.equal(ids.length, before.length + 1);
});

test('a reorder keeps the saved order within its 600-id limit', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  // A saved order already full of places for steps no longer in the plan, then the real ones.
  const ghosts = Array.from({ length: 600 }, (_, i) => 'gone-' + i);
  const real = planTasks().map(t => t.id);
  const full: Partial<TaskEdits> = { order: { '3': [...ghosts, ...real] }, removed: [real[0]!] };
  open({ state: { taskEdits: full as TaskEdits } });
  render();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  $(`[data-move-task="${real[2]}"][data-dir="-1"]`)!.click();
  await settle();
  const ids = (calls.at(-1)![1] as { ids: string[] }).ids;
  assert.equal(ids.length, 600, 'within the limit the server enforces');
  for (const id of real) assert.ok(ids.includes(id), id + ' keeps its place');
  assert.equal(ids.indexOf(real[2]!) < ids.indexOf(real[1]!), true, 'the move itself is saved');
});

test('the calculated plan shows its snapshot, warnings, deliveries and assumptions', async () => {
  const plan = structuredClone(generated);
  plan.warnings = [evil];
  plan.stages['3'].feasible = false;
  plan.stages['3'].reason = evil;
  plan.stages['3'].minHours = 12;
  const row = plan.stages['3'].rows![0]!;
  open({ calculated: plan, state: { checks: { ['calc-3-' + row.id]: true } } });
  render();
  noMarkup();
  assert.equal($('#main h1')!.textContent, 'Phase 3');
  assert.equal($('#main .subtitle')!.textContent, evil);
  assert.match($('#main .notice.warn')!.textContent, /Planning draft/);
  assert.match($('#main .notice.warn')!.textContent, /at least 12 hours per phase/);
  assert.equal($('[data-plan-progress]')!.textContent, '1 of ' + planTasks().length + ' done');
  assert.equal($<HTMLInputElement>(`[data-check="calc-3-${row.id}"]`)!.checked, true);
  assert.equal(
    $$('#main .task-link[data-calc-factory]').length > 0,
    true,
    'calculated steps link to their production line',
  );
  const deliveries = Object.keys(plan.stages['3'].delivery!);
  assert.equal($$('#main [data-delivery]').length, deliveries.length);
  assert.equal(
    $$<HTMLInputElement>('#main [data-delivery]')[0]!.value,
    '0',
    'a calculated count starts at 0',
  );
  assert.ok($$('#main aside .panel p').some(p => p.textContent === evil));
  // Edit mode offers the phase's production rows as links.
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  $(`[data-edit-task="calc-3-${row.id}"]`)!.click();
  await nextTick();
  const select = $<HTMLSelectElement>(`[data-task-edit="calc-3-${row.id}"] [name=link]`)!;
  assert.equal(select.value, row.id, 'a production step links to itself');
  assert.equal(select.options.length, plan.stages['3'].rows!.length + 1);
});

test('a calculated plan saved before existing production existed still renders', () => {
  const older: StoredCalculatedPlan = structuredClone(generated);
  delete older.settings.existingSupply;
  for (const stage of Object.values(older.stages)) delete stage.supplied;
  open({ calculated: older });
  render();
  assert.ok($$('#main .checklist .task').length > 5);
});

// #331: the headroom notice ended on "Phase 1 needs biomass or existing generation." on every
// phase. It now names the phase shown and, from Phase 2 on, the generators its plan builds.
test('the power headroom notice speaks of the phase shown, on every phase', () => {
  const plan = structuredClone(generated);
  // A profile that starts in Phase 1, so the picker offers every phase.
  plan.settings.phase = '1';
  const headroom = () =>
    $$('#main .notice.warn')
      .map(n => n.textContent.replace(/\s+/g, ' ').trim())
      .find(t => /whole-building power headroom/.test(t));
  for (const phase of ['1', '2', '3', '4', '5', 'post'] as const) {
    const x = plan.stages[phase === 'post' ? '5' : phase]!;
    assert.ok(x.additionalHeadroomMW! > 0.01, `Phase ${phase} has headroom to allow`);
    for (const view of ['plan', 'factories', 'resources'] as const) {
      page();
      open({ calculated: plan, phase });
      go(view);
      render();
      const text = headroom();
      assert.ok(text, `${view} on ${phase} draws the notice`);
      const label = phase === 'post' ? 'Post Phase 5' : 'Phase ' + phase;
      if (phase === '1') {
        assert.match(text, /Phase 1 needs biomass or existing generation\.$/);
        continue;
      }
      assert.doesNotMatch(text, /Phase 1|biomass/, `${label} is not told to use biomass`);
      const machines = new Set(x.rows!.filter(r => r.generationMW > 0).map(r => r.machine));
      assert.ok(machines.size > 0, `${label} builds generators`);
      assert.ok(text.includes(label + ' plans '), `${label}: ${text}`);
      for (const m of machines) assert.ok(text.includes(m + 's'), `${label} names ${m}: ${text}`);
    }
  }
  // The handbook profile has no calculated power figures, so it draws no such notice.
  page();
  open();
  go('plan');
  render();
  assert.equal(headroom(), undefined);
});

test('the headroom advice lists every generator a stage builds, or none', () => {
  const row = (machine: string, generationMW: number) =>
    ({ ...generated.stages['3']!.rows![0]!, machine, generationMW }) as CalcRow;
  const stage = (rows: CalcRow[]): StoredStage => ({ feasible: true, rows });
  assert.equal(headroomAdvice(stage([]), '1'), 'Phase 1 needs biomass or existing generation.');
  assert.equal(
    headroomAdvice(stage([row('Smelter', 0), row('Coal Generator', 750)]), '2'),
    'Phase 2 plans Coal Generators; add generation beyond those, or count on existing spare power.',
  );
  assert.equal(
    headroomAdvice(
      stage([
        row('Fuel Generator', 500),
        row('Nuclear Power Plant', 2500),
        row('Coal Generator', 75),
        row('Fuel Generator', 250),
      ]),
      'post',
    ),
    'Post Phase 5 plans Fuel Generators, Nuclear Power Plants and Coal Generators; add generation beyond those, or count on existing spare power.',
  );
  assert.equal(
    headroomAdvice(stage([row('Smelter', 0)]), '4'),
    'Phase 4 needs generation beyond the plan, or existing spare power.',
  );
  // A stage frozen without rows (an older or infeasible snapshot).
  assert.equal(
    headroomAdvice({ feasible: false }, '3'),
    'Phase 3 needs generation beyond the plan, or existing spare power.',
  );
});

// The handbook's Space Elevator deliveries for a phase.
const handbookDeliveries = (phase: string): HandbookDelivery[] =>
  handbook.deliveries.filter((d: HandbookDelivery) => d.phase === phase);

test('a step edit refused as stale keeps what was typed while the page catches up', async () => {
  open();
  state.revision = 7;
  render();
  // The other tab retitled the same step; this tab still shows the old wording.
  const other: Partial<TaskEdits> = { titles: { 'phase-3-iron': 'Other tab title' } };
  const newer = { ...state, revision: 8, taskEdits: { ...state.taskEdits, ...other } as TaskEdits };
  globalThis.fetch = async (path: RequestInfo | URL) =>
    String(path) === '/api/state'
      ? new Response(JSON.stringify(newer))
      : new Response(JSON.stringify({ error: 'This profile was changed in another tab.' }), {
          status: 409,
        });
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  $('[data-edit-task="phase-3-iron"]')!.click();
  await nextTick();
  const type = (name: string, value: string) => {
    const el = $<HTMLInputElement>(`[data-task-edit="phase-3-iron"] [name=${name}]`)!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  type('title', 'My title');
  type('body', 'My details');
  $('[data-task-edit="phase-3-iron"]')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(state.revision, 8, 'the page took the latest state');
  assert.equal(state.taskEdits!.titles!['phase-3-iron'], 'Other tab title');
  assert.equal(editingTask, 'phase-3-iron', 'the form stays open');
  const form = $('[data-task-edit="phase-3-iron"]')!;
  assert.equal(form.querySelector<HTMLInputElement>('[name=title]')!.value, 'My title');
  assert.equal(form.querySelector<HTMLTextAreaElement>('[name=body]')!.value, 'My details');
  assert.match($('#toast')!.textContent, /changed in another tab/);
});

// A calculated build-plan step names each input and output with its own rate: a fluid in
// m³/min, a solid in /min, as the factory cards and dialogs write them (#361, #363). A no-break
// space keeps a fluid's number with its m³.
test('a calculated step writes a fluid input or output in m³/min and a solid in /min (#363)', async () => {
  open({ calculated: generated });
  render();
  await nextTick();
  const rows = generated.stages['3'].rows!;
  const body = (id: string) =>
    $(`[data-check="calc-3-${id}"]`)!
      .closest('.task')!
      .querySelector('p')!
      .textContent.replace(/ /g, ' ');
  const fuel = rows.find(r => r.id === 'Recipe_ResidualFuel_C')!;
  assert.ok(fuel, 'the default plan makes Fuel from Heavy Oil Residue');
  const text = body(fuel.id);
  assert.match(text, /Inputs: Heavy Oil Residue [\d.,]+ m³\/min\./);
  assert.match(text, /Outputs: Fuel [\d.,]+ m³\/min\./);
  assert.doesNotMatch(text, /\/min:/, 'no "Inputs /min:" heading any more');
  // A solid keeps /min.
  const iron = rows.find(r => r.id === 'Recipe_IngotIron_C')!;
  assert.match(body(iron.id), /Inputs: Iron Ore [\d.,]+\/min\. Outputs: Iron Ingot [\d.,]+\/min\./);
});

// A plan with a guide (#393, #466; a migrated handbook profile once #395 writes one) shows the
// guide's narrative steps for the phase instead of the generated ones, under their own check ids,
// with names and bodies as text. A phase the guide leaves out has no generated steps either.
test("a guided plan shows the guide's steps for the phase, under their own ids", async () => {
  const guided = {
    ...structuredClone(generated),
    guide: {
      phases: {
        '3': [
          { id: 'phase-3-survey', title: evil, body: evil },
          {
            id: 'phase-3-iron',
            title: 'Build the first three iron halls',
            body: 'Hall one first.',
          },
        ],
        post: [{ id: 'phase-post-storage-first', title: 'Storage first', body: 'Then the rest.' }],
      },
    },
  } as StoredCalculatedPlan;
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ calculated: guided, phase: '3' });
  go('plan');
  render();
  await nextTick();
  noMarkup();
  assert.deepEqual(steps(), ['phase-3-survey', 'phase-3-iron']);
  assert.ok($('#main .checklist')!.textContent!.includes(evil), 'the title and body as text');
  assert.equal(
    planTasks().some(t => t.id.startsWith('calc-')),
    false,
    'no generated steps beside the guide',
  );
  // Ticking saves the guide's own id.
  const box = $<HTMLInputElement>('#main [data-check="phase-3-survey"]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'check', key: 'phase-3-survey', value: true });
  // Post-game reads the guide's post steps; a phase it leaves out (here 4) has none.
  open({ calculated: guided, phase: 'post' });
  render();
  await nextTick();
  assert.deepEqual(steps(), ['phase-post-storage-first']);
  open({ calculated: guided, phase: '4' });
  render();
  await nextTick();
  assert.deepEqual(steps(), []);
});

// A guided plan's Build sequence intro doesn't describe the generated startup, unlock and factory
// steps it doesn't have (#479); without a guide the intro is as before.
test('the Build sequence intro follows whether the plan has a guide', async () => {
  const intro = () => $$('#main .split > section > p.small.muted').map(p => p.textContent!.trim());
  open({ calculated: generated, phase: '3' });
  go('plan');
  render();
  await nextTick();
  assert.ok(intro().some(t => t.startsWith('Start with construction stock')));
  assert.equal($('#main [data-guided-intro]'), null);
  open({
    calculated: {
      ...structuredClone(generated),
      guide: { phases: { '3': [{ id: 'phase-3-survey', title: 'Survey', body: 'Walk it.' }] } },
    } as StoredCalculatedPlan,
    phase: '3',
  });
  render();
  await nextTick();
  assert.equal(
    $('#main [data-guided-intro]')!.textContent!.trim(),
    'Work through the steps in order and tick each one as it is done.',
  );
  assert.ok(!intro().some(t => /HUB|MAM|Milestone|startup/.test(t)), JSON.stringify(intro()));
});
