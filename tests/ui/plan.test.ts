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
import { acceptRoute } from '../../public/app/api.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import {
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
  HandbookDelivery,
  StoredCalculatedPlan,
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
  globalThis.confirm = () => true;
  go('plan');
});

test('the handbook plan shows the phase checklist, counters, notes and deliveries', () => {
  open({ notes: { 'phase-3': evil + '\n  second line' } });
  render();
  noMarkup();
  assert.equal($('#main h1')!.textContent, 'Phase 3 field plan');
  assert.equal($$('#main .checklist .task').length, 9);
  assert.equal(
    $('#main .stat strong')!.innerHTML,
    '0 <span class="fraction">/ 9</span>',
    'a counter tile keeps its "/ total" markup',
  );
  assert.equal($('#main .head-tools .small')!.textContent, '0% complete');
  assert.equal(
    $<HTMLTextAreaElement>('#phase-note')!.value,
    evil + '\n  second line',
    'the note keeps its text',
  );
  assert.equal($('[data-save-note="phase-3"]')!.dataset.input, 'phase-note');
  assert.equal($('.next-card .step-no')!.textContent, 'NEXT UNFINISHED STEP');
  const deliveries = handbookDeliveries('3');
  assert.equal($$('#main [data-delivery]').length, deliveries.length);
  assert.equal(
    $<HTMLInputElement>(`#delivery-${deliveries[0]!.id}`)!.value,
    String(deliveries[0]!.initial),
    'the original profile starts from the handbook counts',
  );
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
  assert.equal(
    $('#main .stat strong')!.innerHTML,
    '1 <span class="fraction">/ 9</span>',
    'the counters keep counting every step',
  );
  for (const t of planTasks()) state.checks[t.id] = true;
  render();
  await nextTick();
  assert.match($('#main .empty-state')!.textContent, /Every step of this phase is completed/);
  assert.equal($('.next-card .step-no')!.textContent, 'PHASE CHECKLIST COMPLETE');
  // The toggle is view state and stays on for the calculated plan.
  open({ calculated: generated });
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('#hide-done')!.checked, true);
  // It is remembered in this browser, never in the profile.
  assert.equal(localStorage.getItem('planner-hide-done'), 'on');
  assert.equal('hideDone' in state.settings, false);
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
  globalThis.confirm = () => false;
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

test('leaving the page or changing phase asks before dropping an unsaved phase note', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  render();
  // The page on screen is #plan (the hashchange listener in listeners.ts calls acceptRoute).
  history.replaceState(null, '', '#plan');
  assert.equal(acceptRoute(), true, 'nothing to ask without an edit');
  let asked = 0;
  globalThis.confirm = () => (asked++, false);
  const note = $<HTMLTextAreaElement>('#phase-note')!;
  note.value = 'Unsaved thought';
  // A sidebar link, a typed address or Back: kept notes put the address back.
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), false);
  assert.equal(location.hash, '#plan');
  assert.equal(asked, 1);
  // The working-phase select: kept notes leave the phase as it was, unsaved.
  const picker = $<HTMLSelectElement>('#phase-picker')!;
  picker.value = '4';
  picker.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(picker.value, '3');
  assert.equal(note.value, 'Unsaved thought');
  assert.equal(asked, 2);
  // Agreeing to drop them follows the route.
  globalThis.confirm = () => true;
  history.replaceState(null, '', '#storage');
  assert.equal(acceptRoute(), true);
  history.replaceState(null, '', '#plan');
  acceptRoute();
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

test('ticking a step keeps an unsaved phase note on both plan pages', async () => {
  for (const calculated of [false, generated]) {
    const calls = stubFetch({ '/api/update': () => state });
    open({ calculated });
    go('plan');
    render();
    await nextTick();
    const note = () => $<HTMLTextAreaElement>('#phase-note')!;
    note().value = 'Unsaved thought';
    note().dispatchEvent(new Event('input'));
    const box = $<HTMLInputElement>('#main .checklist [data-check]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    assert.equal(calls.length, 1, 'the tick was saved');
    assert.equal(note().value, 'Unsaved thought', calculated ? 'calculated' : 'handbook');
    // Another phase shows that phase's saved note.
    state.notes['phase-4'] = 'Phase 4 plans';
    state.settings.phase = '4';
    render();
    await nextTick();
    assert.equal(note().value, 'Phase 4 plans');
  }
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

test('another tab’s saved note never replaces an unsaved draft, but fills an untouched box', async () => {
  // Every save reply carries a phase note another tab saved meanwhile.
  stubFetch({
    '/api/update': () => ({ ...state, notes: { ...state.notes, 'phase-3': 'From the other tab' } }),
  });
  const tick = async () => {
    const box = $<HTMLInputElement>('#main .checklist [data-check]:not(:checked)')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };
  const note = () => $<HTMLTextAreaElement>('#phase-note')!;
  render();
  await nextTick();
  note().value = 'My draft';
  note().dispatchEvent(new Event('input'));
  await tick();
  assert.equal(note().value, 'My draft', 'the draft is kept');
  assert.match($('#toast')!.textContent!, /saved note changed while you were editing/);
  // An untouched box simply shows the newer saved note.
  page();
  open();
  stubFetch({
    '/api/update': () => ({ ...state, notes: { ...state.notes, 'phase-3': 'From the other tab' } }),
  });
  render();
  await nextTick();
  await tick();
  assert.equal(note().value, 'From the other tab');
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
  assert.match($('#main .notice')!.textContent, /Planning draft/);
  assert.match($('#main .notice')!.textContent, /at least 12 hours per phase/);
  assert.equal($$('#main .stat strong')[0]!.textContent, '1/' + planTasks().length);
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

// The handbook's Space Elevator deliveries for a phase.
const handbookDeliveries = (phase: string): HandbookDelivery[] =>
  handbook.deliveries.filter((d: HandbookDelivery) => d.phase === phase);
